#!/usr/bin/env node
/**
 * 桌面版兼容离线校验（真值校验，非规则移植）。
 *
 * 直接 import 官方 apps/desktop 的 `linkDesktopHostPackages` 与
 * `validateDesktopPluginGraph`，在临时目录里按桌面版契约重建：
 *
 *   runtime/node_modules/<共享包>        ← 第一方生产依赖闭包（junction 到本机安装）
 *   profile/node_modules/<共享包>        ← 官方 linkDesktopHostPackages 生成
 *   profile/node_modules/<插件>          ← npm 发布产物解包后的真实目录（非 symlink）
 *
 * 然后跑官方校验，等价于桌面版启动时对"已启用插件"做的依赖图校验：
 *   - 共享包出现在 dependencies → FAIL（必须声明为 peer）
 *   - peer 版本范围不满足 → FAIL（注意 semver 预发布元组规则）
 *   - peer 声明了 profile 无法解析的包 → FAIL（requires missing）
 *   - 插件自带共享包副本/别名 → FAIL（duplicate or aliased host package）
 *   - 链接的私有包/越界包 → FAIL
 *
 * 用法：
 *   node scripts/desktop-compat-check.mjs                    # 校验当前仓库
 *   node scripts/desktop-compat-check.mjs --pack <tgz>       # 校验 npm pack 产物
 *   node scripts/desktop-compat-check.mjs --plugin <dir> --harness <官方仓库> --dsh <dsh 包根>
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const args = process.argv.slice(2)
const opt = (name, fallback) => {
  const index = args.indexOf(name)
  return index === -1 ? fallback : args[index + 1]
}

const harnessRoot = resolve(opt('--harness', process.env.DSH_HARNESS_SOURCE ?? '/mnt/d/projects/deepseek-harness'))
const dshRoot = resolve(opt('--dsh', process.env.DSH_DEPLOY_ROOT ?? '/usr/local/lib/node_modules/@deepseek-ai/dsh'))
const pluginDir = resolve(opt('--plugin', process.cwd()))
const packFile = opt('--pack', undefined)
const keep = args.includes('--keep')

const failures = []
const passes = []
const fail = (message) => failures.push(message)
const pass = (message) => passes.push(message)

function readJSON(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

/** 按 Node 的 node_modules 查找链定位包目录（与官方 packageFrom 同语义，不读 exports 映射）。 */
function locatePackage(require, name) {
  for (const modules of require.resolve.paths(name) ?? []) {
    const dir = join(modules, name)
    if (existsSync(join(dir, 'package.json'))) return realpathSync(dir)
  }
  return undefined
}

/** 桌面版共享包 = dsh 生产依赖闭包（含 dsh 自身）；与 apps/desktop 打包时的 packageSet 同源。 */
function collectSharedPackages() {
  const require = createRequire(join(dshRoot, 'package.json'))
  const shared = new Map()
  const visit = (name) => {
    if (shared.has(name)) return
    const dir = locatePackage(require, name)
    if (dir === undefined) return // 本机未安装：桌面版由 release 提供，跳过
    const manifest = readJSON(join(dir, 'package.json'))
    shared.set(name, { name, version: manifest.version, dir })
    for (const dep of Object.keys({ ...manifest.dependencies, ...manifest.optionalDependencies })) visit(dep)
  }
  visit('@deepseek-ai/dsh')
  return shared
}

function materializeRuntime(root, shared) {
  for (const entry of shared.values()) {
    const target = join(root, 'node_modules', ...entry.name.split('/'))
    mkdirSync(dirname(target), { recursive: true })
    if (!existsSync(target)) symlinkSync(realpathSync(entry.dir), target, 'dir')
  }
}

function materializePlugin(profile, pluginName, sourceDir) {
  const target = join(profile, 'node_modules', ...pluginName.split('/'))
  mkdirSync(dirname(target), { recursive: true })
  cpSync(sourceDir, target, { recursive: true, dereference: false })
  return target
}

function unpackPack(tgz, into) {
  mkdirSync(into, { recursive: true })
  execFileSync('tar', ['-xzf', tgz, '-C', into], { stdio: 'pipe' })
  return join(into, 'package')
}

/** 用 npm pack 产出真实发布契约（files 白名单生效，node_modules 不入包）。 */
function packPlugin(dir, into) {
  mkdirSync(into, { recursive: true })
  const stdout = execFileSync('npm', ['pack', '--pack-destination', into, '--silent'], {
    cwd: dir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const file = stdout.trim().split('\n').filter(Boolean).pop()
  if (file === undefined) throw new Error(`npm pack 未产出文件名（cwd=${dir}）`)
  return join(into, file)
}

async function main() {
  for (const [label, path] of [['官方仓库', harnessRoot], ['dsh 包根', dshRoot], ['插件目录', pluginDir]]) {
    if (!existsSync(path)) {
      console.error(`desktop-compat-check: ${label}不存在: ${path}`)
      process.exit(2)
    }
  }
  const validateModule = join(harnessRoot, 'apps/desktop/src/profile-packages.ts')
  if (!existsSync(validateModule)) {
    console.error(`desktop-compat-check: 找不到官方校验模块 ${validateModule}（--harness 应指向 deepseek-harness 仓库根）`)
    process.exit(2)
  }
  const { linkDesktopHostPackages, validateDesktopPluginGraph } = await import(pathToFileURL(validateModule).href)

  // 插件来源：npm 发布产物（发布契约）优先——本地 node_modules 是构建期产物，
  // 桌面版安装的是打包后的 tgz，因此校验对象必须是 pack 产物。
  const temp = mkdtempSync(join(tmpdir(), 'dsh-desktop-compat-'))
  let sourceDir
  try {
    if (packFile !== undefined) {
      sourceDir = unpackPack(resolve(packFile), join(temp, 'pack'))
      pass(`指定 npm pack 产物解包成功: ${resolve(packFile)}`)
    } else {
      const tgz = packPlugin(pluginDir, join(temp, 'pack'))
      sourceDir = unpackPack(tgz, join(temp, 'pack'))
      pass(`npm pack 产物解包成功: ${tgz.split('/').pop()}`)
    }
    const pluginManifest = readJSON(join(sourceDir, 'package.json'))
    const pluginName = pluginManifest.name
    if (typeof pluginName !== 'string' || pluginName === '') {
      fail('package.json 缺少合法的 name')
      return report()
    }

    // 发布产物不得夹带 node_modules（桌面版会判定为共享包副本/嵌套副本）。
    if (existsSync(join(sourceDir, 'node_modules'))) {
      const entries = readJSON(join(sourceDir, 'package.json')).files ?? []
      if (!entries.includes('node_modules')) pass('发布产物无嵌套 node_modules 声明')
      else fail('files 声明包含 node_modules（桌面版禁止嵌套第一方包副本）')
    } else {
      pass('产物无嵌套 node_modules')
    }

    // dsh.bundle.patch 契约：桌面版/CLI 靠它装配 host 半。
    const bundlePatch = pluginManifest.dsh?.bundle?.patch
    if (typeof bundlePatch === 'string') {
      if (existsSync(join(sourceDir, bundlePatch))) pass(`dsh.bundle.patch 存在: ${bundlePatch}`)
      else fail(`dsh.bundle.patch 指向的文件不存在: ${bundlePatch}`)
    } else {
      fail('缺少 dsh.bundle.patch —— 安装后 host 半不会被装配')
    }

    // client 半声明：platform 必须存在，inject 必须是数组。
    const clientDecl = pluginManifest.dsh?.client
    if (clientDecl !== undefined) {
      if (clientDecl.platform === 'web') pass('dsh.client.platform = web（桌面版同款，Electron 加载同一 web 前端）')
      else fail(`dsh.client.platform 非 web: ${JSON.stringify(clientDecl.platform)}`)
      if (clientDecl.inject !== undefined && !Array.isArray(clientDecl.inject)) fail('dsh.client.inject 必须是数组')
    }

    const shared = collectSharedPackages()
    const root = join(temp, 'runtime')
    mkdirSync(root, { recursive: true })
    materializeRuntime(root, shared)

    const runtime = {
      schemaVersion: 1,
      release: { version: readJSON(join(dshRoot, 'package.json')).version, nodeVersion: process.versions.node },
      platform: process.platform,
      arch: process.arch,
      sharedPackages: [...shared.values()]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((entry) => ({ name: entry.name, version: entry.version, path: `node_modules/${entry.name}` })),
      files: [],
    }

    const profile = join(temp, 'profile')
    mkdirSync(profile, { recursive: true })
    linkDesktopHostPackages(profile, root, runtime) // 官方函数：建立共享包 junction
    materializePlugin(profile, pluginName, sourceDir)

    validateDesktopPluginGraph(profile, root, runtime, [pluginName])
    pass(`validateDesktopPluginGraph 通过（activePlugins=[${pluginName}]）`)
    return report()
  } finally {
    if (!keep) rmSync(temp, { recursive: true, force: true })
    else console.error(`desktop-compat-check: 保留临时目录 ${temp}`)
  }
}

function report() {
  console.log('')
  for (const line of passes) console.log(`  PASS  ${line}`)
  for (const line of failures) console.log(`  FAIL  ${line}`)
  console.log('')
  if (failures.length === 0) {
    console.log('desktop-compat-check: PASS（桌面版契约等价校验全部通过）')
    process.exit(0)
  }
  console.log(`desktop-compat-check: FAIL（${failures.length} 项）`)
  process.exit(1)
}

await main().catch((error) => {
  console.log('')
  for (const line of passes) console.log(`  PASS  ${line}`)
  console.log(`  FAIL  ${error instanceof Error ? error.message : String(error)}`)
  console.log('')
  console.log('desktop-compat-check: FAIL（官方校验抛出异常）')
  process.exit(1)
})
