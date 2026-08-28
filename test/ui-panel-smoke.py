from playwright.sync_api import sync_playwright
import re

URL = "http://127.0.0.1:3080"

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    cons = []
    errors = []
    page.on("console", lambda m: cons.append(f"[{m.type}] {m.text[:400]}"))
    page.on("pageerror", lambda e: errors.append(str(e)[:600]))

    page.goto(URL)
    page.wait_for_load_state("networkidle", timeout=45000)
    page.wait_for_timeout(2000)
    page.locator("text=创建团队群聊讨论插件逻辑").first.click(timeout=5000)
    page.wait_for_timeout(3000)

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
    page.screenshot(path="/tmp/gc_post_click.png")

    print("--- console tail 15 ---")
    for line in cons[-15:]:
        print(line)
    print("--- pageerrors ---")
    for e in errors:
        print(e)

    browser.close()
