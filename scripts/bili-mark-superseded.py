#!/usr/bin/env python3
"""Mark a superseded Bilibili upload, through the creator center.

**Why a browser and not the API.** The uploader's cookie set reaches the
legacy web API (`/x/vu/web/add` submits fine), but the edit endpoint
(`/x/vu/web/edit`) answers `21001 参数错误` for every payload shape, and
the modern creator-center endpoints are not reachable with those cookies
(16 candidate paths, all 404). The creator center itself works: the
cookies are a valid session, so the editor page loads and saves.

**What it does.** For each target it opens 稿件管理, finds the row by its
submission timestamp, opens 编辑, prefixes the title with
`【旧版·已重拍】` and prepends a marker paragraph to the intro that
points at the replacement video. Nothing else is touched — the cover,
the tags, the category and the declaration stay as they are.

**Usage**

    ~/.venvs/zhihu/bin/python scripts/bili-mark-superseded.py

The playwright venv is the one the (shelved) Zhihu uploader uses:

    python3 -m venv ~/.venvs/zhihu && ~/.venvs/zhihu/bin/pip install playwright
    ~/.venvs/zhihu/bin/playwright install chromium

`TARGETS` below carries the rows to mark; edit it for the next
re-upload. A row is identified by its submission timestamp, because the
title is exactly what this script changes.
"""
import json
import os
import sys

from playwright.sync_api import sync_playwright

COOKIE = os.path.expanduser("~/.config/secrets/biliup-cookies.json")
FRAME = "https://member.bilibili.com/platform/upload/video/frame"

# (bvid, the submission timestamp that identifies the row, title prefix, intro prefix)
TARGETS = [
    (
        "BV1hksK6NERx",
        "2026年11月17日 06:09:09",
        "【旧版·已重拍】",
        "【旧版 · 已重拍】This cut was re-shot with new artwork and re-uploaded. "
        "Watch the NEW version instead: https://www.bilibili.com/video/BV15Zsz6PEFS "
        "— this upload is kept only as an archive.\n",
    ),
    (
        "BV1aksK6NEh5",
        "2026年11月17日 06:08:37",
        "【旧版·已重拍】",
        "【旧版 · 已重拍】本片已用新画面重拍并重新上传，新版："
        "https://www.bilibili.com/video/BV1TBsu6vEwd 。旧版仅作存档，请看新版。\n",
    ),
]


def open_editor(page, timestamp):
    """Open 稿件管理 and click 编辑 on the row with this timestamp."""
    page.goto(FRAME, wait_until="domcontentloaded")
    page.wait_for_timeout(5000)
    page.get_by_text("内容管理", exact=True).click()
    page.wait_for_timeout(1200)
    page.get_by_text("稿件管理", exact=True).click()
    page.wait_for_timeout(6000)
    ts = page.get_by_text(timestamp, exact=False).first
    ts_box = ts.bounding_box()
    edits = page.get_by_text("编辑", exact=True)
    best, bestd = None, 1e9
    for i in range(edits.count()):
        box = edits.nth(i).bounding_box()
        if not box:
            continue
        d = abs(box["y"] + box["height"] / 2 - (ts_box["y"] + ts_box["height"] / 2))
        if d < bestd:
            bestd, best = d, i
    edits.nth(best).click()
    page.wait_for_timeout(9000)
    return page.url


def main() -> int:
    cookies = [
        {
            "name": c["name"],
            "value": c["value"],
            "domain": ".bilibili.com",
            "path": "/",
        }
        for c in json.load(open(COOKIE))["cookie_info"]["cookies"]
    ]
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        for bvid, timestamp, title_prefix, intro_prefix in TARGETS:
            ctx = browser.new_context(viewport={"width": 1600, "height": 1000})
            ctx.add_cookies(cookies)
            page = ctx.new_page()
            url = open_editor(page, timestamp)
            print(f"{bvid}: editor at {url}")
            if bvid not in url:
                print("  ! wrong row — aborting this one")
                ctx.close()
                continue
            title_input = page.get_by_placeholder("请输入稿件标题")
            title_input.fill(title_prefix + title_input.input_value())
            intro = page.locator("[contenteditable=true]").first
            intro.click()
            page.keyboard.press("Meta+ArrowUp")
            page.keyboard.type(intro_prefix)
            page.wait_for_timeout(500)
            page.screenshot(path=f"/tmp/bili-mark-{bvid}.png")
            page.get_by_text("立即投稿", exact=True).click()
            page.wait_for_timeout(4000)
            confirm = page.get_by_text("确认", exact=True)
            if confirm.count():
                confirm.first.click()
                page.wait_for_timeout(5000)
            page.screenshot(path=f"/tmp/bili-done-{bvid}.png")
            print(f"  marked; screenshot: /tmp/bili-done-{bvid}.png")
            ctx.close()
        browser.close()
    return 0


sys.exit(main())
