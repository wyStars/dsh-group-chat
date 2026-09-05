from playwright.sync_api import sync_playwright
import re, time

import os
URL = os.environ.get("DSH_WEB_URL", "http://127.0.0.1:3080")

def load_cookies(path="/tmp/dsh-gc.cookies"):
    """读取 dsh web 认证 cookie（本地凭证），注入浏览器上下文。"""
    import os
    cookies = []
    if os.path.exists(path):
        with open(path, encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                parts = line.split("\t")
                if len(parts) >= 7:
                    cookies.append({
                        "name": parts[5], "value": parts[6],
                        "domain": parts[0], "path": parts[2],
                        "expires": int(parts[4]), "secure": False,
                    })
    return cookies


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(viewport={"width": 1440, "height": 900})
    context.add_cookies(load_cookies())
    page = context.new_page()
    cons = []
    errors = []
    page.on("console", lambda m: cons.append(f"[{m.type}] {m.text[:300]}"))
    page.on("pageerror", lambda e: errors.append(str(e)[:600]))

    page.goto(URL)
    page.wait_for_load_state("networkidle", timeout=45000)
    page.wait_for_timeout(2000)
    # 打开一个会话（header actions 仅在对话视图挂载）
    for sel in ["text=升级群聊版主设计与实施计划", "text=创建团队群聊讨论插件逻辑"]:
        loc = page.locator(sel)
        if loc.count() > 0:
            loc.first.click(timeout=5000)
            break
    page.wait_for_timeout(3000)

    btn = page.locator("button.dshgc-trigger")
    if btn.count() == 0:
        print("NOT FOUND dshgc-trigger")
        browser.close()
        raise SystemExit
    btn.first.click(timeout=5000)
    page.wait_for_timeout(1000)

    # 0) 展开设置区（任务 textarea 在设置区内）
    cfg = page.locator("button[title*='设置']")
    if cfg.count():
        cfg.first.click(timeout=5000)
        page.wait_for_timeout(500)

    # 1) 输入任务
    ta = page.locator("textarea.dshgc-textarea")
    print("textarea count:", ta.count())
    ta.first.fill("设计一个小学生学习打卡工具的 MVP 方案（功能与激励设计）")
    page.screenshot(path="/tmp/gc_panel_filled.png")

    # 1.5) 设置区检查：无轮数控件 + 有深度推理开关
    number_inputs = page.locator(".dshgc-settings input[type=number]").count()
    deep_toggle = page.locator(".dshgc-settings input[type=checkbox]").count()
    print("settings number inputs (should be 0):", number_inputs)
    print("settings deep-reasoning checkbox (should be >=1):", deep_toggle)
    if number_inputs != 0:
        raise SystemExit("FAIL: rounds input still present")
    if deep_toggle < 1:
        raise SystemExit("FAIL: deep-reasoning toggle missing")
        page.wait_for_timeout(300)

    # 2) 点击生成角色团队
    page.locator("button:has-text('生成角色团队')").first.click(timeout=5000)
    print("clicked generate; waiting roles...")
    page.wait_for_selector(".dshgc-roleChip", timeout=90000)
    roles = page.locator(".dshgc-roleChip")
    host_chip = page.locator(".dshgc-hostChip")
    print("roles count:", roles.count())
    print("host chip count (should be >=1):", host_chip.count())
    if host_chip.count() < 1:
        raise SystemExit("FAIL: host badge missing")
    for i in range(min(roles.count(), 10)):
        print("  chip:", roles.nth(i).inner_text()[:60].replace("\n", " | "))
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
        typing = page.locator(".dshgc-typing").count()
        print(f"  msgs={msgs} summary={summary} badge={badge!r} typing={typing}")
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
