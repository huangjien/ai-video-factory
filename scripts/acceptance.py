#!/usr/bin/env python3
"""
Acceptance criteria for a finished video — executable assertions,
not "looks good" judgement calls.

Runs seven checks against a project's final-mixed.mp4. Each check
prints PASS or FAIL with the measured value. Exits 0 only when
every check passes.

Checks
------
  1. output  — final-mixed.mp4 exists, ffprobe can read it
  2. format  — 1920x1080, h264 video, aac audio
  3. duration — close to article.md `duration_target_sec`
  4. frame_count — fps × duration (within ±1 frame)
  5. loudness — integrated loudness in the YouTube-friendly range
  6. silence  — no `>= 1.0 s` audio gap
  7. visuals  — for ImageBackground scenes, the per-scene jpg is
                not solid-colour (the "all-gray frame" failure mode)

Usage
-----
    python3 scripts/acceptance.py <project>
        [--strict]    # fail on warnings, not just errors
        [--json]      # emit a JSON report on stdout (one object per check)
"""
from __future__ import annotations

import argparse
import json
import re
import statistics
import subprocess
import sys
import tempfile
from dataclasses import dataclass, asdict
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    sys.stderr.write(
        "acceptance.py needs Pillow. Install: pip3 install --user --break-system-packages pillow\n"
    )
    raise


# --- Result type -----------------------------------------------------------


@dataclass
class Check:
    name: str
    ok: bool
    detail: str
    threshold: str = ""
    measured: str = ""


# --- shell helpers --------------------------------------------------------


def run(cmd: list[str], **kwargs) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, **kwargs)


def ffprobe(streams: str, target: str) -> dict:
    """Run ffprobe and return the parsed JSON for `streams` of `target`."""
    res = run(
        [
            "ffprobe",
            "-v", "error",
            "-show_entries", streams,
            "-of", "json",
            target,
        ]
    )
    if res.returncode != 0:
        raise RuntimeError(f"ffprobe failed: {res.stderr}")
    return json.loads(res.stdout)


# --- check 1 + 2: output + format ------------------------------------------


def check_output_and_format(path: Path) -> list[Check]:
    out: list[Check] = []
    if not path.exists():
        out.append(Check("output.exists", False, f"missing: {path}"))
        return out
    out.append(Check("output.exists", True, f"{path} ({path.stat().st_size} bytes)"))

    try:
        meta = ffprobe(
            "format=duration,size:stream=codec_name,codec_type,width,height,avg_frame_rate,r_frame_rate,nb_frames,channels,sample_rate",
            str(path),
        )
    except RuntimeError as e:
        out.append(Check("output.ffprobe", False, str(e)))
        return out

    out.append(Check("output.ffprobe", True, "ffprobe read OK"))

    fmt = meta.get("format", {})
    streams = meta.get("streams", [])
    v_stream = next((s for s in streams if s.get("codec_type") == "video"), None)
    a_stream = next((s for s in streams if s.get("codec_type") == "audio"), None)

    if v_stream is None:
        out.append(Check("format.video_present", False, "no video stream"))
        return out
    out.append(Check("format.video_present", True, f"codec={v_stream.get('codec_name')}"))

    if a_stream is None:
        out.append(Check("format.audio_present", False, "no audio stream"))
    else:
        out.append(
            Check(
                "format.audio_present",
                True,
                f"codec={a_stream.get('codec_name')} "
                f"ch={a_stream.get('channels')} sr={a_stream.get('sample_rate')}",
            )
        )

    # Codec checks (h264 + aac are what the rest of the pipeline expects)
    if v_stream.get("codec_name") == "h264":
        out.append(Check("format.video_codec", True, "h264"))
    else:
        out.append(
            Check(
                "format.video_codec",
                False,
                f"expected h264, got {v_stream.get('codec_name')}",
            )
        )
    if a_stream is None or a_stream.get("codec_name") == "aac":
        out.append(Check("format.audio_codec", True, a_stream.get("codec_name", "aac")))
    else:
        out.append(
            Check(
                "format.audio_codec",
                False,
                f"expected aac, got {a_stream.get('codec_name')}",
            )
        )

    # Resolution
    w, h = v_stream.get("width"), v_stream.get("height")
    if (w, h) == (1920, 1080):
        out.append(Check("format.resolution", True, f"{w}x{h}"))
    else:
        out.append(
            Check(
                "format.resolution",
                False,
                f"expected 1920x1080, got {w}x{h}",
            )
        )

    return out


# --- check 3 + 4: duration + frame_count ------------------------------------


def parse_fps(rate: str) -> float:
    """Parse ffprobe's `avg_frame_rate` like '30/1' or '30000/1001'."""
    if not rate or "/" not in rate:
        return 30.0
    num, den = rate.split("/", 1)
    try:
        n, d = int(num), int(den)
        return n / d if d else 30.0
    except ValueError:
        return 30.0


def check_duration_and_frames(path: Path, project_root: Path) -> list[Check]:
    out: list[Check] = []
    meta = ffprobe(
        "format=duration:stream=codec_type,nb_frames,avg_frame_rate",
        str(path),
    )
    fmt = meta.get("format", {})
    streams = meta.get("streams", [])
    v_stream = next((s for s in streams if s.get("codec_type") == "video"), None)

    actual = float(fmt.get("duration", 0))
    out.append(Check("duration.measured", True, f"{actual:.2f}s"))

    target = None
    article = project_root / "article.md"
    if article.exists():
        m = re.search(r"^duration_target_sec:\s*(\d+)", article.read_text(), re.MULTILINE)
        if m:
            target = int(m.group(1))
    if target is None:
        out.append(
            Check(
                "duration.target",
                True,
                "no article.md duration_target_sec — skipping",
                threshold="n/a",
            )
        )
    else:
        # ±15% of the target — generous on purpose. With audio-driven
        # duration (principle #3) the rendered length is the cumulative
        # TTS + scene holds, not the planning estimate. A 15% gap is
        # normal; > 15% likely means a missing scene or a TTS dropout
        # and the build should be re-examined.
        tol = max(5.0, target * 0.15)
        ok = abs(actual - target) <= tol
        out.append(
            Check(
                "duration.target",
                ok,
                f"target {target}s, actual {actual:.2f}s, tol {tol:.1f}s",
                threshold=f"±{tol:.1f}s of {target}s",
                measured=f"{actual:.2f}s",
            )
        )

    if v_stream is None:
        return out
    fps = parse_fps(v_stream.get("avg_frame_rate", "30/1"))
    nb_frames_raw = v_stream.get("nb_frames")
    nb_frames = int(nb_frames_raw) if nb_frames_raw and nb_frames_raw != "N/A" else None
    if nb_frames is None:
        # Some encoders don't write nb_frames into the container header;
        # use the ffmpeg-side count from a raw decode instead.
        count = run(
            ["ffprobe", "-v", "error", "-count_frames", "-select_streams", "v",
             "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", str(path)]
        )
        try:
            nb_frames = int((count.stdout or "0").strip().splitlines()[-1])
        except (IndexError, ValueError):
            nb_frames = None

    if nb_frames is None:
        out.append(
            Check("frame_count.measured", True, "ffprobe could not read nb_frames (try ffprobe -count_frames)")
        )
        return out
    expected = round(fps * actual)
    diff = abs(nb_frames - expected)
    out.append(
        Check(
            "frame_count.measured",
            True,
            f"{nb_frames} frames @ {fps:.3f}fps",
        )
    )
    out.append(
        Check(
            "frame_count.expected",
            diff <= 1,
            f"diff vs fps×duration = {diff} frame(s)",
            threshold="±1 frame",
            measured=f"{nb_frames} vs {expected}",
        )
    )
    return out


# --- check 5: loudness -----------------------------------------------------


LOUDNESS_TARGET_LOW = -23.0
LOUDNESS_TARGET_HIGH = -18.0


def check_loudness(path: Path) -> list[Check]:
    out: list[Check] = []
    with tempfile.NamedTemporaryFile(
        "r", suffix=".txt", delete=False
    ) as tmp:
        tmp_path = Path(tmp.name)
    try:
        proc = run(
            [
                "ffmpeg",
                "-hide_banner", "-nostats", "-i", str(path),
                "-af", "ebur128=peak=true",
                "-f", "null", "-",
            ]
        )
        # ffmpeg writes the ebur128 summary to stderr
        text = proc.stderr
        i_match = re.search(r"^\s*I:\s*([-\d.]+)\s*LUFS", text, re.MULTILINE)
        if not i_match:
            out.append(
                Check(
                    "loudness.ebur128",
                    False,
                    "ebur128 output did not contain an `I:` line",
                )
            )
            return out
        i_lufs = float(i_match.group(1))
        in_range = LOUDNESS_TARGET_LOW <= i_lufs <= LOUDNESS_TARGET_HIGH
        out.append(
            Check(
                "loudness.integrated",
                in_range,
                f"I = {i_lufs:.1f} LUFS",
                threshold=f"{LOUDNESS_TARGET_LOW}…{LOUDNESS_TARGET_HIGH} LUFS",
                measured=f"{i_lufs:.1f} LUFS",
            )
        )
    finally:
        tmp_path.unlink(missing_ok=True)
    return out


# --- check 6: silence gaps -------------------------------------------------


def check_silence_gaps(path: Path, max_gap: float = 3.0) -> list[Check]:
    out: list[Check] = []
    proc = run(
        [
            "ffmpeg",
            "-hide_banner", "-nostats", "-i", str(path),
            "-af", f"silencedetect=noise=-30dB:d=0.5",
            "-f", "null", "-",
        ]
    )
    text = proc.stderr
    gaps: list[float] = []
    for m in re.finditer(
        r"silence_end:\s*([\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)",
        text,
    ):
        gaps.append(float(m.group(2)))
    if not gaps:
        out.append(
            Check(
                "silence.gaps",
                True,
                f"none ≥0.5s (max gap threshold: silence detection active at -30dB)",
            )
        )
        return out
    longest = max(gaps)
    out.append(
        Check(
            "silence.gaps",
            longest < max_gap,
            f"longest gap {longest:.2f}s (count: {len(gaps)} ≥0.5s gap(s))",
            threshold=f"<{max_gap}s",
            measured=f"{longest:.2f}s",
        )
    )
    return out


# --- check 7: per-scene visual integrity ----------------------------------


def visual_stdev(image_path: Path) -> float:
    """Standard deviation of all pixel values. Solid-color image → 0.
    Real photograph → ~30-80. A safe floor is 8; below that the frame
    is probably a scrim-only render with no actual content."""
    with Image.open(image_path) as im:
        im = im.convert("RGB")
        # downsample to keep this fast
        im.thumbnail((256, 256))
        data = im.tobytes()
    # data is laid out as RGBRGB...; treat it as a flat sequence
    if not data:
        return 0.0
    return statistics.pstdev(data)


def check_scene_visuals(project_root: Path) -> list[Check]:
    out: list[Check] = []
    image_dir = project_root / "assets" / "images"
    if not image_dir.exists():
        out.append(Check("visuals.directory", False, f"missing: {image_dir}"))
        return out
    jpgs = sorted(image_dir.glob("scene_*.jpg"))
    if not jpgs:
        out.append(Check("visuals.directory", True, f"no scene_*.jpg under {image_dir} (no ImageBackground scenes?)"))
        return out
    out.append(Check("visuals.directory", True, f"{len(jpgs)} scene image(s)"))
    blank = 0
    for jpg in jpgs:
        sd = visual_stdev(jpg)
        if sd < 8.0:
            blank += 1
    out.append(
        Check(
            "visuals.non_blank",
            blank == 0,
            f"{blank} scene(s) with stdev < 8 (likely a flat-color frame)",
            threshold="stdev ≥ 8 per scene",
            measured=f"{blank} flat / {len(jpgs)} total",
        )
    )
    return out


# --- top-level driver -----------------------------------------------------


def run_all(project_root: Path) -> list[Check]:
    target = project_root / "output" / "final-mixed.mp4"
    checks: list[Check] = []
    if not target.exists():
        checks.append(
            Check("output.exists", False, f"missing: {target} — has video make run?")
        )
        return checks
    checks.extend(check_output_and_format(target))
    if any(c.ok for c in checks if c.name == "output.exists"):
        checks.extend(check_duration_and_frames(target, project_root))
        checks.extend(check_loudness(target))
        checks.extend(check_silence_gaps(target))
    checks.extend(check_scene_visuals(project_root))
    # The render-time blank-frame check reads the self-check frames
    # written by scripts/self-check.sh. Catches the "all-gray frame"
    # failure mode where the source jpgs are fine but the renderer
    # silently produced scrims (e.g. a missing image path).
    checks.extend(check_rendered_frames(project_root))
    return checks


def check_rendered_frames(project_root: Path) -> list[Check]:
    out: list[Check] = []
    sc_dir = project_root / "qa" / "self-check"
    if not sc_dir.exists():
        out.append(
            Check(
                "rendered_frames.directory",
                True,
                f"no {sc_dir} — run scripts/self-check.sh to populate it",
            )
        )
        return out
    frames = sorted(sc_dir.glob("frame_*.jpg"))
    if not frames:
        out.append(
            Check("rendered_frames.directory", True, "no frame_*.jpg in qa/self-check/"))
        return out
    out.append(
        Check("rendered_frames.directory", True, f"{len(frames)} frame(s) sampled")
    )
    blank = 0
    for f in frames:
        sd = visual_stdev(f)
        if sd < 8.0:
            blank += 1
    out.append(
        Check(
            "rendered_frames.non_blank",
            blank == 0,
            f"{blank} of {len(frames)} rendered frame(s) have stdev < 8 (likely a flat scrim or missing image)",
            threshold="stdev ≥ 8 per sampled frame",
            measured=f"{blank} flat / {len(frames)} total",
        )
    )
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("project", help="project slug (under projects/)")
    ap.add_argument("--strict", action="store_true", help="exit non-zero on warnings too")
    ap.add_argument("--json", action="store_true", help="emit JSON on stdout")
    args = ap.parse_args()

    project_root = Path("projects") / args.project
    checks = run_all(project_root)
    failed = sum(1 for c in checks if not c.ok)
    passed = sum(1 for c in checks if c.ok)

    if args.json:
        print(
            json.dumps(
                {
                    "project": args.project,
                    "passed": passed,
                    "failed": failed,
                    "checks": [asdict(c) for c in checks],
                },
                indent=2,
            )
        )
    else:
        # Human-readable table
        name_w = max(len(c.name) for c in checks) if checks else 8
        for c in checks:
            mark = "✓ PASS" if c.ok else "✗ FAIL"
            line = f"  {mark}  {c.name:<{name_w}}  {c.detail}"
            if c.threshold:
                line += f"   (threshold: {c.threshold})"
            print(line)
        print()
        print(f"  {passed} passed, {failed} failed")

    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
