from playwright.sync_api import sync_playwright
import re, time

URL = "http://127.0.0.1:3080"

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    cons = []
    errors = []
    page.on("console", lambda m: cons.append(f"[{m.type}] {m.text[:300]}"))
    page.on("pageerror", lambda e: errors.append(str(e)[:600]))

    page.goto(URL)
    page.wait_for_load_state("networkidle", timeout=45000)
    page.wait_for_timeout(2000)
    page.locator("text=创建团队群聊讨论插件逻辑").first.click(timeout=5000)
    page.wait_for_timeout(3000)

    btn = page.locator("button.dshgc-trigger")
    btn.first.click(timeout=5000)
    page.wait_for_timeout(1000)

    # 1) 输入任务
    ta = page.locator("textarea.dshgc-textarea")
    print("textarea count:", ta.count())
    ta.first.fill("设计一个小学生学习打卡工具的 MVP 方案（功能与激励设计）")
    page.screenshot(path="/tmp/gc_panel_filled.png")

    # 2) 点击生成角色团队
    page.locator("button:has-text('生成角色团队')").first.click(timeout=5000)
    print("clicked generate; waiting roles...")
    page.wait_for_selector(".dshgc-role", timeout=90000)
    roles = page.locator(".dshgc-role")
    print("roles count:", roles.count())
    for i in range(roles.count()):
        print("  role:", roles.nth(i).inner_text()[:60].replace("\n", " | "))
    page.screenshot(path="/tmp/gc_roles.png")

    # 3) 开始讨论
    start = page.locator("button:has-text('开始讨论')")
    print("start btn count:", start.count())
    start.first.click(timeout=5000)
    print("clicked start; waiting messages...")
    page.wait_for_selector(".dshgc-msg", timeout=30000)
    time.sleep(3)
    print("messages after 3s:", page.locator(".dshgc-msg").count())

    # 4) 等讨论完成（phase badge 变 已完成/出错，或总结出现）
    print("waiting discuss...")
    for _ in range(120):
        page.wait_for_timeout(5000)
        msgs = page.locator(".dshgc-msg").count()
        summary = page.locator(".dshgc-summary").count()
        badge = page.locator(".dshgc-badge").first.inner_text() if page.locator(".dshgc-badge").count() else "?"
        print(f"  msgs={msgs} summary={summary} badge={badge!r}")
        if summary > 0 or badge in ("已完成", "出错"):
            break

    summary = page.locator(".dshgc-summary")
    print("=== summary count:", summary.count())
    if summary.count():
        print("summary head:", summary.first.inner_text()[:180].replace("\n", " | "))
    page.screenshot(path="/tmp/gc_done.png")

    # 5) 导出 MD
    exp = page.locator("button:has-text('导出 MD')")
    print("export btn count:", exp.count())
    if exp.count():
        exp.first.click(timeout=5000)
        page.wait_for_timeout(4000)
        path_el = page.locator(".dshgc-path")
        if path_el.count():
            print("mdPath:", path_el.first.inner_text())
        page.screenshot(path="/tmp/gc_exported.png")

    print("--- pageerrors ---")
    for e in errors:
        print(e)
    browser.close()
