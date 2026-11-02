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
    "科学科普": 201,
    "社科·法律·心理": 124,
    "职场就业": 124,  # 归入社科·法律·心理（职场沟通类）
    "人文历史": 202,
    "财经商业": 207,
    "校园学习": 208,
    "野生技术协会": 122,
    "人工智能": 233,
    "编程开发": 239,
    "计算机技术": 122,
    "科技": 122,
    "数码": 95,
    "影视杂谈": 182,
    "影视剪辑": 183,
    "短片": 181,
    "生活": 160,
    "知识": 36,
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

    t0 = time.time()
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
    print(f"投稿成功（{time.time() - t0:.0f}s）— BV 号请看上方 ResponseData 日志，或在创作中心查看")
    return 0


if __name__ == "__main__":
    sys.exit(main())
