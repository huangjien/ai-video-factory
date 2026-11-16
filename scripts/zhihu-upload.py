#!/usr/bin/env python3
"""Zhihu 视频投稿（Playwright 驱动真实上传页 — 知乎无公开 API）.

⚠️⚠️ 状态：已擞置，发布流程不可用（2026-11-15）。登录（--login）与字段
解析（--dry-run）可用，但投稿永远失败：知乎上传器在选文件后静默不发上传
请求（详见 ~/.agents 或 skill 内的搁置记录；取证在
projects/<id>/bilibili/zhihu-debug/）。保留此文件作未来重试的参考，勿直接信任。

Usage:
  scripts/zhihu-upload.py <project>            # 读 bilibili/package.yaml 上传投稿
  scripts/zhihu-upload.py <project> --dry-run  # 只打印将要提交的字段
  scripts/zhihu-upload.py --login              # 打开浏览器登录，Profile 持久化
  scripts/zhihu-upload.py --standalone --video … --title … --desc … --tag … [--cover …]

依赖: ~/.venvs/zhihu（python3 -m venv ~/.venvs/zhihu
      && ~/.venvs/zhihu/bin/pip install playwright pyyaml
      && ~/.venvs/zhihu/bin/playwright install chromium）
风险: 无官方 API，驱动真实网页；知乎改版会破坏选择器。任何一步失败都会把
      截图 + HTML 存到 projects/<id>/bilibili/zhihu-debug/ 供修选择器。
      登录态存 ~/.config/secrets/zhihu-profile，账号敏感数据，勿入库、勿外传。

exit codes: 0 成功 / 1 参数或包缺失 / 2 登录态缺失（先 --login） / 3 上传或投稿失败
"""
import argparse
import json
import os
import re
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
VENV_PY = Path.home() / ".venvs/zhihu/bin/python"
if VENV_PY.exists() and str(VENV_PY) != sys.executable:
    os.execv(str(VENV_PY), [str(VENV_PY), __file__, *sys.argv[1:]])

import yaml  # noqa: E402

PROFILE = Path.home() / ".config/secrets/zhihu-profile"  # legacy dir, unused
STATE = Path.home() / ".config/secrets/zhihu-state.json"
# z_c0 是会话 cookie（无过期时间）—— persistent profile 重启即丢，实测
# 2026-11-15。登录后把 storage_state 存成 JSON，投稿时注入新 context，
# 会话随文件存活，不随浏览器进程存活。
CREATOR_URL = "https://www.zhihu.com/creator"
VIDEO_CREATE_URL = "https://www.zhihu.com/videos/create"


def debug_dir_for(project: str) -> Path:
    d = REPO / "projects" / project / "bilibili" / "zhihu-debug"
    d.mkdir(parents=True, exist_ok=True)
    return d


def login() -> int:
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(str(PROFILE), headless=False)
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.goto("https://www.zhihu.com/signin", timeout=60_000)
        print("在打开的浏览器窗口登录知乎（扫码/验证码均可）…")
        # 登录成功的唯一可靠信号是 z_c0 会话 cookie（d_c0 人人都有）。
        # 自动轮询，出现即收尾 — 不依赖人回终端按 Enter（后台运行时
        # stdin 是关的，input() 会直接 EOF）。
        print("等待 z_c0 会话 cookie（最长 5 分钟）…")
        ok = False
        for _ in range(150):
            time.sleep(2)
            cookies = ctx.cookies("https://www.zhihu.com")
            if any(c["name"] == "z_c0" for c in cookies):
                ok = True
                break
        if ok:
            # 会话 cookie 不落盘 — 必须导出 storage_state 才能跨进程存活
            STATE.write_text(json.dumps(ctx.storage_state(), ensure_ascii=False))
            os.chmod(STATE, 0o600)
        ctx.close()
    if not ok:
        print("5 分钟内未检测到登录（z_c0 未出现）— 重跑本命令再试", file=sys.stderr)
        return 3
    print("登录成功，storage_state 已存入", STATE)
    return 0


def resolve_fields(args, ap) -> dict:
    """Project mode reads bilibili/package.yaml — fields carry to Zhihu
    unchanged (same rationale as the skill's companion rule); standalone
    mode takes everything from flags. Returns {video,title,desc,tags,cover}."""
    if args.standalone:
        for need in (args.video, args.title, args.desc, args.tag):
            if not need:
                ap.error("--standalone 需要 --video --title --desc --tag 全部给出")
        return {
            "video": Path(args.video),
            "title": args.title,
            "desc": args.desc,
            "tags": [t for t in args.tag.split(",") if t.strip()],
            "cover": args.cover,
        }
    if not args.project:
        ap.error("需要项目名，或用 --login / --standalone")
    pkg_path = REPO / "projects" / args.project / "bilibili" / "package.yaml"
    if not pkg_path.exists():
        print(f"缺 {pkg_path} — 先运行 `video bilibili {args.project}` 生成包", file=sys.stderr)
        sys.exit(1)
    pkg = yaml.safe_load(pkg_path.read_text())
    video = Path(args.video) if args.video else REPO / "projects" / args.project / "output" / "final-mixed.mp4"
    cover = args.cover or str(REPO / "projects" / args.project / "youtube" / "thumbnail.jpg")
    return {
        "video": video,
        "title": pkg["title"],
        "desc": pkg["description"],
        "tags": pkg.get("tags", [])[:10],
        "cover": cover if Path(cover).exists() else None,
    }


def dump_debug(page, debug_dir: Path, note: str) -> None:
    """页面改版时的取证：截图 + HTML + 当前 URL，修选择器全靠它。"""
    try:
        page.screenshot(path=str(debug_dir / f"{note}.png"), full_page=True)
        (debug_dir / f"{note}.html").write_text(page.content(), encoding="utf-8")
        print(f"调试已存 {debug_dir}/{note}.png|.html（当前 URL: {page.url}）", file=sys.stderr)
    except Exception as err:  # noqa: BLE001 — 取证失败不掩盖原始错误
        print(f"调试取证失败: {err}", file=sys.stderr)


def publish(fields: dict, debug_dir: Path) -> str:
    """驱动 creator.zhihu.com 发布视频，返回发布后的链接（拿不到则空串）。

    硬失败步骤：传片/标题/发布；软失败步骤（记 stderr 后继续）：简介、
    话题、封面、原创声明 — 页面结构不确定的部分宁可少填也不要卡死。
    任何异常先存取证再抛出，选择器修复全靠 zhihu-debug/ 里的截图。"""
    from playwright.sync_api import sync_playwright

    page = None
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        ctx = browser.new_context(storage_state=str(STATE) if STATE.exists() else None,
                                  viewport={"width": 1440, "height": 900})
        try:
            # 登录态判定用 z_c0 会话 cookie（URL 检查只是辅证：SPA 可能
            # 在 /creator 上内联渲染登录页而不改 URL，2026-11-15 实测过）
            cookies = ctx.cookies("https://www.zhihu.com")
            if not any(c["name"] == "z_c0" for c in cookies):
                print("登录态失效（无 z_c0）— 先运行 scripts/zhihu-upload.py --login", file=sys.stderr)
                sys.exit(2)
            page = ctx.pages[0] if ctx.pages else ctx.new_page()
            page.goto(CREATOR_URL, timeout=60_000)
            page.wait_for_load_state("networkidle", timeout=30_000)
            if "signin" in page.url or "signup" in page.url:
                print("登录态失效 — 先运行 scripts/zhihu-upload.py --login", file=sys.stderr)
                sys.exit(2)
            # 创作中心首页 → 视频发布入口（文案驱动，改版容忍度最高）；
            # 文案找不到就直接走 /videos/create 直达页
            entry = page.get_by_text("发布视频", exact=False).first
            if entry.count() == 0:
                entry = page.locator("a:has-text('视频'), button:has-text('视频')").first
            try:
                entry.click(timeout=10_000)
                page.wait_for_load_state("networkidle", timeout=30_000)
            except Exception:  # noqa: BLE001 — 文案入口未命中，改走直达页
                page.goto(VIDEO_CREATE_URL, timeout=60_000)
                page.wait_for_load_state("networkidle", timeout=30_000)
            dump_debug(page, debug_dir, "1-video-entry")
            # 传片：上传区的 input[type=file]
            file_input = page.locator("input[type='file']").first
            file_input.set_input_files(str(fields["video"]), timeout=30_000)
            print("视频已提交上传，等待转码完成（最长 20 分钟）…")
            page.wait_for_selector("text=重新上传", timeout=1_200_000)
            print("上传完成，填表单…")
            dump_debug(page, debug_dir, "2-after-upload")
            # 标题（硬步骤）
            title_box = page.locator(
                "input[placeholder*='标题'], textarea[placeholder*='标题']"
            ).first
            title_box.fill(fields["title"], timeout=15_000)
            # 简介（软步骤 — placeholder 文案不确定）
            try:
                desc_box = page.locator(
                    "textarea[placeholder*='简介'], textarea[placeholder*='说明'],"
                    " textarea[placeholder*='描述']"
                ).first
                desc_box.fill(fields["desc"], timeout=15_000)
            except Exception as err:  # noqa: BLE001
                print(f"简介未填上: {err}", file=sys.stderr)
            # 话题：逐个输入回车；失败只警告
            for tag in fields["tags"][:5]:
                try:
                    tag_box = page.locator(
                        "input[placeholder*='话题'], input[placeholder*='搜索']"
                    ).first
                    tag_box.fill(tag, timeout=8_000)
                    page.keyboard.press("Enter")
                    page.wait_for_timeout(400)
                except Exception as err:  # noqa: BLE001
                    print(f"话题「{tag}」未填上: {err}", file=sys.stderr)
                    break
            # 封面（软步骤）：入口文案 + 二级文件输入 + 确认
            if fields["cover"]:
                try:
                    page.get_by_text("上传封面", exact=False).first.click(timeout=8_000)
                    page.locator("input[type='file']").last.set_input_files(
                        fields["cover"], timeout=15_000
                    )
                    page.wait_for_timeout(2_000)
                    page.locator("button:has-text('确定'), button:has-text('完成')").last.click(
                        timeout=8_000
                    )
                except Exception as err:  # noqa: BLE001
                    print(f"封面未设置（知乎可能默认取视频首帧）: {err}", file=sys.stderr)
            # 原创声明（软步骤）
            try:
                page.get_by_text("声明原创", exact=False).first.click(timeout=5_000)
            except Exception:
                pass
            dump_debug(page, debug_dir, "3-form-filled")
            page.locator("button:has-text('发布')").last.click(timeout=15_000)
            page.wait_for_load_state("networkidle", timeout=60_000)
            page.wait_for_timeout(3_000)
            dump_debug(page, debug_dir, "4-after-publish")
            # 成功链接：知乎视频页 /zvideo/<id> 或 /video/<id>
            m = re.search(r"https?://www\.zhihu\.com/(?:zvideo|video)/\d+", page.content())
            return m.group(0) if m else ""
        except SystemExit:
            raise
        except Exception as err:  # noqa: BLE001 — 先取证再抛出
            if page is not None:
                dump_debug(page, debug_dir, "X-error")
            print(f"投稿失败: {err}", file=sys.stderr)
            raise
        finally:
            ctx.close()
            browser.close()
    return ""


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("project", nargs="?", help="projects/ 下的项目名")
    ap.add_argument("--dry-run", action="store_true", help="只打印提交字段，不投稿")
    ap.add_argument("--login", action="store_true", help="打开浏览器登录知乎，Profile 持久化")
    ap.add_argument("--standalone", action="store_true", help="无项目模式：--video/--title/--desc/--tag 全部显式")
    ap.add_argument("--video", help="视频文件路径（覆盖项目默认 output/final-mixed.mp4）")
    ap.add_argument("--title", help="standalone 标题")
    ap.add_argument("--desc", help="standalone 简介")
    ap.add_argument("--tag", help="standalone 标签（英文逗号分隔）")
    ap.add_argument("--cover", help="封面图片路径（默认 youtube/thumbnail.jpg）")
    args = ap.parse_args()

    if args.login:
        return login()

    fields = resolve_fields(args, ap)
    if not fields["video"].exists():
        print(f"缺成片 {fields['video']}", file=sys.stderr)
        return 1
    project = args.project or "standalone"
    fields_out = {**fields, "video_size": fields["video"].stat().st_size}
    print(json.dumps(fields_out, ensure_ascii=False, indent=1, default=str))
    if args.dry_run:
        return 0
    if not STATE.exists():
        print("缺登录态 — 先运行 scripts/zhihu-upload.py --login", file=sys.stderr)
        return 2

    debug_dir = debug_dir_for(project)
    url = publish(fields, debug_dir)
    if url:
        print(f"投稿成功 — {url}")
    else:
        print("投稿已提交 — 未从页面捕获链接，请到 creator.zhihu.com 内容管理确认")
    return 0


if __name__ == "__main__":
    sys.exit(main())
