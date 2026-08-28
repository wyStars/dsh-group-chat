#!/bin/bash
# dsh-group-chat 构建：
#   1. junction 依赖（注入器工具链 tsdown/rolldown + 部署侧运行期包）
#   2. host 侧 lib/*.js 语法校验 + 导入链检查（纯 ESM JS，无编译步骤）
#   3. client 侧 tsdown 打包（lib/client.js，ModuleLoader.load 注册）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# 部署目录的 node_modules（DSH 已编译包所在处）；可用 DSH_DEPLOY_MODULES 覆盖。
DEPLOY_MODULES="${DSH_DEPLOY_MODULES:-/usr/local/lib/node_modules/@deepseek-ai/dsh/node_modules}"
# 注入器自身 node_modules：内含 tsdown / rolldown / typescript 工具链及其传递依赖。
INJECTOR_NM="${DSH_INJECTOR_NM:-/projects/dsh/dsh-routing-suite/injector/node_modules}"

if [ ! -d "$DEPLOY_MODULES" ]; then
  echo "build: deploy node_modules not found at $DEPLOY_MODULES" >&2
  exit 1
fi
if [ ! -d "$INJECTOR_NM" ]; then
  echo "build: injector node_modules not found at $INJECTOR_NM（可改用已安装的 tsdown）" >&2
  exit 1
fi

echo "=== Linking build toolchain + deps ==="
node - "$DEPLOY_MODULES" "$INJECTOR_NM" <<'EOF'
const fs = require('fs')
const path = require('path')
const [deploy, injector] = process.argv.slice(2)

function link(linkPath, target) {
  const lp = path.resolve(linkPath)
  const t = path.resolve(target)
  try {
    if (fs.lstatSync(lp).isSymbolicLink() && fs.readlinkSync(lp) === t) return
  } catch { /* missing → create */ }
  fs.rmSync(lp, { recursive: true, force: true })
  fs.mkdirSync(path.dirname(lp), { recursive: true })
  fs.symlinkSync(t, lp, process.platform === 'win32' ? 'junction' : 'dir')
}

// 注入器工具链（tsdown + rolldown + typescript 及全部传递依赖，整体链接）
for (const entry of fs.readdirSync(injector)) {
  if (entry === '.' || entry === '..' || entry.startsWith('.') || entry === '.bin') continue
  link(path.join('node_modules', entry), path.join(injector, entry))
}
link(path.join('node_modules', '.bin'), path.join(injector, '.bin'))

// 部署侧运行期/类型依赖
const topLevel = ['cordis', 'cosmokit', 'schemastery', 'zod', '@standard-schema', '@types/node']
for (const pkg of topLevel) {
  if (fs.existsSync(path.join(deploy, pkg))) link(path.join('node_modules', pkg), path.join(deploy, pkg))
}
const deepseek = ['dsh-tools', 'dsh-llm', 'dsh-system-prompt', 'dsh-client-ui-slots', 'dsh-client-runtime', 'dsh-session', 'dsh-timeout']
for (const pkg of deepseek) {
  if (fs.existsSync(path.join(deploy, '@deepseek-ai', pkg))) {
    link(path.join('node_modules', '@deepseek-ai', pkg), path.join(deploy, '@deepseek-ai', pkg))
  }
}
EOF

echo "=== Syntax check lib/index.js ==="
node --check lib/index.js

echo "=== Import chain check ==="
node --input-type=module -e "import('./lib/index.js').then(m => console.log('  plugin import OK:', m.name)).catch(e => { console.error('  FAIL:', e.message); process.exit(1) })"

echo "=== Building client (tsdown → lib/client.js) ==="
if [ -f tsdown.config.ts ]; then
  npm run build:client
else
  echo "build: tsdown.config.ts missing, skipping client bundle" >&2
  exit 1
fi

echo "=== Build complete ==="
