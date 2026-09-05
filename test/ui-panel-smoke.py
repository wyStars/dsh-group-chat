from playwright.sync_api import sync_playwright
import re

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
    page.on("console", lambda m: cons.append(f"[{m.type}] {m.text[:400]}"))
    page.on("pageerror", lambda e: errors.append(str(e)[:600]))

    page.goto(URL)
    page.wait_for_load_state("networkidle", timeout=45000)
    page.wait_for_timeout(2000)

    # 打开一个会话（header actions 仅在对话视图挂载）：优先已知会话标题，回退首个会话项
    opened = False
    for sel in ["text=升级群聊版主设计与实施计划", "text=创建团队群聊讨论插件逻辑"]:
        loc = page.locator(sel)
        if loc.count() > 0:
            loc.first.click(timeout=5000)
            opened = True
            break
    if not opened:
        page.locator("text=New Session").first.click(timeout=5000).catch()
        opened = True
    page.wait_for_timeout(2500)

    # 精确定位 class=dshgc-trigger 的按钮
    btn = page.locator("button.dshgc-trigger")
    print("dshgc-trigger count:", btn.count())
    if btn.count() == 0:
        print("NOT FOUND")
        browser.close()
        raise SystemExit

    print("visible:", btn.first.is_visible())
    print("disabled:", btn.first.is_disabled())
    box = btn.first.bounding_box()
    print("bbox:", box)

    page.screenshot(path="/tmp/gc_pre_click.png")
    print("--- 点击 ---")
    try:
        btn.first.click(timeout=5000)
        print("clicked OK")
    except Exception as ex:
        print("click error:", str(ex)[:300])
    page.wait_for_timeout(2500)

    panel = page.locator(".dshgc-panel")
    overlay = page.locator(".dshgc-overlay")
    print("panel count:", panel.count(), "| visible:", panel.count() and panel.first.is_visible())
    print("overlay count:", overlay.count(), "| visible:", overlay.count() and overlay.first.is_visible())
    if panel.count() > 0:
        print("panel text head:", panel.first.inner_text()[:200].replace("\n", " | "))

    # 收起 → 左上方悬浮按钮（状态样式）
    close = page.locator("button.dshgc-close")
    if close.count():
        close.first.click(timeout=5000)
        page.wait_for_timeout(1200)
        fl = page.locator("button.dshgc-float")
        print("float button count (expect 1):", fl.count())
        if fl.count():
            print("float class:", fl.first.get_attribute("class"))
            print("float bbox:", fl.first.bounding_box())
            if fl.first.bounding_box() is None:
                print("FAIL: float not visible")
        else:
            print("FAIL: float button missing")

    # 设置区：无轮数输入 + 有深度推理开关
    cfg = page.locator("button[title*='设置']")
    if cfg.count():
        cfg.first.click(timeout=5000)
        page.wait_for_timeout(400)
        number_inputs = page.locator(".dshgc-settings input[type=number]").count()
        deep_toggle = page.locator(".dshgc-settings input[type=checkbox]").count()
        print("settings number inputs (expect 0):", number_inputs)
        print("settings checkbox (expect >=1):", deep_toggle)
        if number_inputs != 0 or deep_toggle < 1:
            print("FAIL: settings assertion")
    page.screenshot(path="/tmp/gc_post_click.png")

    print("--- console tail 15 ---")
    for line in cons[-15:]:
        print(line)
    print("--- pageerrors ---")
    for e in errors:
        print(e)

    browser.close()
