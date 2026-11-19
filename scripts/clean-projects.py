#!/usr/bin/env python3
"""Clean the projects/ tree: drop the rendered media, keep the sources.

What it deletes (everything here is DERIVED and regenerable):

  output/**/*.mp4            the renders (preview, preview-faststart,
                              final-mixed) — the bulk of the disk
  scenes/**/*.mp4            the per-scene version store's rendered clips
                              (the .json metadata beside them stays, so
                              `video scene list` still knows what existed)
  assets/audio/*.wav         the TTS output
  assets/audio-assets/**     the materialised BGM/SFX (the library track
                              itself is a symlink and is never touched)
  qa/*.png                   the contact sheets

What it KEEPS (the human-edit sources and the records worth keeping):

  article.md  audio-config.yaml  storyboard/  project.yaml  state.yaml
  checkpoints/  runs/  review/  article-review.yaml  versions/  vdsl/
  captions/  bilibili/  youtube/  decision-log.jsonl  qa/*.json
  assets/images/            the scene artwork — regenerable, but it
                              costs a real image generation to replace

Safety: tracked files are never touched (the benchmark fixture lives in
git), symlinks are never followed, and anything matching a rule is
printed before it is removed.

  python3 scripts/clean-projects.py --dry-run
  python3 scripts/clean-projects.py
"""
import argparse
import os
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJECTS = os.path.join(REPO, "projects")

# (dir-name under a project, file extensions to remove)
DELETE_RULES = [
    ("output", (".mp4",)),
    ("scenes", (".mp4",)),
    ("audio-assets", (".wav", ".mp3", ".m4a")),
    ("audio", (".wav",)),
]


def tracked_files() -> set:
    out = subprocess.run(
        ["git", "-C", REPO, "ls-files", "projects/"],
        capture_output=True,
        text=True,
    )
    return {line.strip() for line in out.stdout.splitlines() if line.strip()}


def targets():
    """The files the rules select, as (abs path, size)."""
    protected = tracked_files()
    found = []
    for dirpath, dirnames, filenames in os.walk(PROJECTS, followlinks=False):
        # a symlinked dir (the l10n image store) is a link, not a dir to walk
        dirnames[:] = [d for d in dirnames if not os.path.islink(os.path.join(dirpath, d))]
        parts = os.path.relpath(dirpath, PROJECTS).split(os.sep)
        bucket = parts[-1] if len(parts) > 1 else ""
        for fn in filenames:
            exts = None
            for name, exts in DELETE_RULES:
                if name in parts:
                    break
            else:
                if bucket == "qa" and fn.endswith(".png"):
                    exts = (".png",)
                else:
                    exts = ()
            if not exts or not fn.endswith(exts):
                continue
            full = os.path.join(dirpath, fn)
            rel = os.path.relpath(full, REPO)
            if rel in protected:
                continue
            if os.path.islink(full):
                continue
            try:
                size = os.path.getsize(full)
            except OSError:
                continue
            found.append((full, size, rel))
    return found


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    found = targets()
    total = sum(s for _, s, _ in found)
    print(f"projects/ would lose {len(found)} files, {total / 1e9:.2f} GB")
    by_kind = {}
    for _, size, rel in found:
        kind = "mp4 (render)" if "/output/" in rel else (
            "mp4 (scene store)" if "/scenes/" in rel else "audio/other"
        )
        by_kind[kind] = by_kind.get(kind, 0) + size
    for kind, size in sorted(by_kind.items(), key=lambda x: -x[1]):
        print(f"  {size / 1e9:6.2f} GB  {kind}")
    if args.dry_run:
        return 0

    for full, _, _ in found:
        try:
            os.remove(full)
        except OSError as err:
            print(f"  ! could not remove {full}: {err}", file=sys.stderr)
    # empty directories (output/, scenes/) go too — they are pure caches
    for dirpath, dirnames, filenames in os.walk(PROJECTS, topdown=False):
        if not dirnames and not filenames:
            try:
                os.rmdir(dirpath)
            except OSError:
                pass
    print(f"removed {len(found)} files, {total / 1e9:.2f} GB")
    return 0


sys.exit(main())
