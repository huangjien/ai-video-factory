#!/usr/bin/env python3
"""Bilibili 投稿（非官方 stream_gears 路径）.

Usage:
  scripts/bilibili-upload.py <project>            # 读 bilibili/package.yaml 上传投稿
  scripts/bilibili-upload.py <project> --dry-run  # 只打印将要提交的字段
  scripts/bilibili-upload.py --login              # 扫码登录，Cookie 写入 ~/.config/secrets/

依赖: ~/.venvs/biliup（python3 -m venv ~/.venvs/biliup && pip install biliup pyyaml qrcode）
风险: B 站非官方内部接口，无契约；Cookie 约 30 天过期需 --login 重扫。

exit codes: 0 成功 / 1 参数或包缺失 / 2 登录态缺失（先 --login） / 3 上传或投稿失败
"""
import argparse
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
VENV_PY = Path.home() / ".venvs/biliup/bin/python"
if VENV_PY.exists() and str(VENV_PY) != sys.executable:
    os.execv(str(VENV_PY), [str(VENV_PY), __file__, *sys.argv[1:]])

import yaml  # noqa: E402

COOKIE = Path.home() / ".config/secrets/biliup-cookies.json"

# 常用分区名 → tid（B 站分区树会变，未命中时用 --tid 显式指定）
TIDS = {
    # The current Bilibili zone tree (2025-11): the numbers moved. 人文历史
    # was 202 and is 228 now (202 is 资讯), 科技 was 122 and is 188, 短片 was
    # 181 and is 85, 计算机技术 was 122 and is 231. A zone the uploader
    # cannot name is refused rather than guessed — a video filed under the
    # wrong zone is worse than one the human picks from the form.
    "知识": 36,
    "科学科普": 201,
    "社科·法律·心理": 124,
    "人文历史": 228,
    "财经商业": 207,
    "校园学习": 208,
    "职业职场": 209,
    "职场就业": 124,  # 归入社科·法律·心理（职场沟通类）
    "设计·创意": 229,
    "野生技能协会": 122,
    "野生技术协会": 122,
    "科技": 188,
    "数码": 95,
    "软件应用": 230,
    "计算机技术": 231,
    "工业·工程·机械": 232,
    "极客DIY": 233,
    "军事": 179,
    "影视杂谈": 182,
    "影视剪辑": 183,
    "短片": 85,
    "预告·资讯": 184,
    "音乐": 3,
    "生活": 160,
    "搞笑": 138,
    "手工": 161,
    "绘画": 162,
    "日常": 21,
    "美食": 211,
    "动物圈": 217,
    "喵星人": 218,
    "汪星人": 219,
    "野生动物": 221,
    "爬宠": 222,
    "大熊猫": 220,
    "动物综合": 75,
    "运动": 234,
    "健身": 164,
    "娱乐": 5,
    "综艺": 71,
    "明星综合": 137,
    "时尚": 155,
    "汽车": 223,
    "汽车生活": 176,
    "汽车价格": 248,
    "摩托车": 240,
    "购车攻略": 227,
    "国创": 167,
    "国产动画": 153,
    "舞蹈": 129,
    "宅舞": 20,
    "鬼畜": 119,
    "音MAD": 26,
    "鬼畜剧场": 216,
    "纪录片": 177,
    "人文·历史": 37,
    "科学·探索·自然": 178,
    "社会·美食·旅行": 180,
    "番剧": 13,
    "电视剧": 11,
    "电影": 23,
}


def login() -> int:
    import qrcode
    import stream_gears

    ret = stream_gears.get_qrcode()
    url = json.loads(ret)["data"]["url"]
    qr = qrcode.QRCode(border=1)
    qr.add_data(url)
    qr.make(fit=True)
    qr.print_ascii(invert=True)
    print("URL:", url)
    print("用 B 站 App 扫一扫上方二维码，3 分钟内在手机上点「确认登录」…")
    info = stream_gears.login_by_qrcode(ret, file=str(COOKIE))
    print("登录成功，Cookie 写入", COOKIE)
    print(str(info)[:200])
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("project", nargs="?", help="projects/ 下的项目名")
    ap.add_argument("--dry-run", action="store_true", help="只打印提交字段，不投稿")
    ap.add_argument("--tid", type=int, help="分区 id（覆盖 package 的 suggested_category 映射）")
    ap.add_argument("--login", action="store_true", help="扫码登录")
    ap.add_argument("--standalone", action="store_true", help="无项目模式：--video/--title/--desc/--tag/--tid/--cover 全部显式")
    ap.add_argument("--video", help="视频文件路径（覆盖项目默认 output/final-mixed.mp4）")
    ap.add_argument("--title", help="standalone 标题")
    ap.add_argument("--desc", help="standalone 简介")
    ap.add_argument("--tag", help="standalone 标签（英文逗号分隔）")
    ap.add_argument("--cover", help="封面图片路径（默认 youtube/thumbnail.jpg）")
    args = ap.parse_args()

    if args.login:
        return login()
    if args.standalone:
        for need in (args.video, args.title, args.desc, args.tag, args.tid):
            if not need:
                ap.error("--standalone 需要 --video --title --desc --tag --tid 全部给出")
        if not COOKIE.exists():
            print("缺登录态 — 先运行 scripts/bilibili-upload.py --login", file=sys.stderr)
            return 2
        print(json.dumps({"video": args.video, "title": args.title, "tid": args.tid,
                          "tag": args.tag, "cover": args.cover or ""}, ensure_ascii=False))
        # --dry-run must gate here too: the project branch returns before
        # importing stream_gears, but this branch used to import and upload
        # regardless of the flag (2026-11-04: a --dry-run verification run
        # submitted for real).
        if args.dry_run:
            return 0
        import stream_gears
        if len(args.title) > 80:
            print(f"标题 {len(args.title)} 字符超 B 站上限 80，截断", file=sys.stderr)
            args.title = args.title[:79] + "…"
        stream_gears.upload([args.video], str(COOKIE), title=args.title, tid=args.tid,
                            tag=args.tag, copyright=1, desc=args.desc, cover=args.cover or "")
        print("投稿成功 — BV 号见上方 ResponseData")
        return 0
    if not args.project:
        ap.error("需要项目名，或用 --login")

    pkg_path = REPO / "projects" / args.project / "bilibili" / "package.yaml"
    if not pkg_path.exists():
        print(f"缺 {pkg_path} — 先运行 `video bilibili {args.project}` 生成包", file=sys.stderr)
        return 1
    pkg = yaml.safe_load(pkg_path.read_text())
    video = REPO / "projects" / args.project / "output" / "final-mixed.mp4"
    if args.video:
        video = Path(args.video)
    cover = args.cover or str(REPO / "projects" / args.project / "youtube" / "thumbnail.jpg")
    tid = args.tid or TIDS.get(pkg.get("suggested_category", ""))
    if tid is None:
        print(
            f"分区「{pkg.get('suggested_category')}」未映射 tid，用 --tid 显式指定（scripts 内置映射可查）",
            file=sys.stderr,
        )
        return 1
    if not video.exists():
        print(f"缺成片 {video}", file=sys.stderr)
        return 1
    if not COOKIE.exists():
        print("缺登录态 — 先运行 scripts/bilibili-upload.py --login", file=sys.stderr)
        return 2

    fields = {
        "video": str(video),
        "title": pkg["title"],
        "tid": tid,
        "tag": ",".join(pkg.get("tags", [])[:10]),
        "copyright": 1,  # 自制
        "desc": pkg["description"],
        "cover": cover if Path(cover).exists() else "",
    }
    if len(fields["title"]) > 80:
        print(f"标题 {len(fields['title'])} 字符超 B 站上限 80，截断", file=sys.stderr)
        fields["title"] = fields["title"][:79] + "…"
    print(json.dumps({**fields, "video_size": Path(fields["video"]).stat().st_size}, ensure_ascii=False, indent=1))
    if args.dry_run:
        return 0

    import stream_gears

    # The BV 号 only appears in the uploader's log line, and a piped or
    # truncated output loses it — the id was unrecoverable once the
    # upload finished. Tee the uploader's output into the project and
    # pull the id out of it.
    log_dir = REPO / "projects" / args.project / "bilibili"
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / "upload.log"
    saved_out, saved_err = os.dup(1), os.dup(2)
    log_fd = os.open(str(log_path), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o644)
    os.dup2(log_fd, 1)
    os.dup2(log_fd, 2)
    t0 = time.time()
    try:
        stream_gears.upload(
            [fields["video"]],
            str(COOKIE),
            title=fields["title"],
            tid=fields["tid"],
            tag=fields["tag"],
            copyright=fields["copyright"],
            desc=fields["desc"],
            cover=fields["cover"],
        )
    finally:
        os.dup2(saved_out, 1)
        os.dup2(saved_err, 2)
        os.close(saved_out)
        os.close(saved_err)
        os.close(log_fd)
    elapsed = time.time() - t0
    bvid = ""
    m = re.search(r"(BV[0-9A-Za-z]{10})", log_path.read_text(errors="replace"))
    if m:
        bvid = m.group(1)
        (log_dir / "bvid.txt").write_text(bvid + "\n", encoding="utf-8")
    if bvid:
        print(f"投稿成功（{elapsed:.0f}s）— {bvid}  https://www.bilibili.com/video/{bvid}")
    else:
        print(f"投稿成功（{elapsed:.0f}s）— BV 号见 {log_path}，或在创作中心查看")
    return 0


if __name__ == "__main__":
    sys.exit(main())
