"""group-chat 面板 web 版冒烟（迁移到 /api 通道后的回归）。

验证三件事：
  1. client bundle 加载成功（dshgc-trigger / 面板 DOM 存在，无 pageerror）
  2. 面板 API 走同源 /api/group-chat/*（页面上下文 fetch 返回 200 且为快照 JSON）
  3. 点击群聊按钮 → 面板打开
"""
import os
import sys
from playwright.sync_api import sync_playwright

URL = os.environ.get("DSH_WEB_URL", "http://127.0.0.1:3080")
TOKEN = os.environ.get("DSH_WEB_TOKEN", "")

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(viewport={"width": 1440, "height": 900})
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)[:400]))

    page.goto(URL + ("/?token=" + TOKEN if TOKEN else ""))
    page.wait_for_load_state("networkidle", timeout=60000)
    page.wait_for_timeout(2500)

    # 1) client bundle 是否加载（悬浮按钮/会话头按钮由 client 半注册）
    print("dshgc-trigger count:", page.locator("button.dshgc-trigger").count())

    # 2) 页面上下文同源 fetch 面板 API（与桌面版同一条 connection 路由）
    result = page.evaluate("""async () => {
      const res = await fetch('/api/group-chat/state', { cache: 'no-store' })
      const text = await res.text()
      return { status: res.status, head: text.slice(0, 160) }
    }""")
    print("page fetch /api/group-chat/state:", result)
    ok_api = result["status"] == 200 and '"phase"' in result["head"]
    print("API OK:", ok_api)

    # 3) 打开一个会话 → 点击群聊按钮 → 面板出现
    opened = False
    for sel in ["text=New Session", "text=新会话"]:
        loc = page.locator(sel)
        if loc.count() > 0:
            loc.first.click(timeout=5000)
            opened = True
            break
    page.wait_for_timeout(2500)
    btn = page.locator("button.dshgc-trigger")
    print("trigger after session open:", btn.count())
    panel_ok = False
    if btn.count() > 0:
        btn.first.click(timeout=5000)
        page.wait_for_timeout(2000)
        panel = page.locator(".dshgc-panel")
        panel_ok = panel.count() > 0 and panel.first.is_visible()
        print("panel count:", panel.count(), "visible:", panel_ok)
        page.screenshot(path="/tmp/gc_api_migration.png")

    print("pageerrors:", errors[:5])
    browser.close()
    print("RESULT:", "PASS" if (ok_api and panel_ok and not errors) else "CHECK")
