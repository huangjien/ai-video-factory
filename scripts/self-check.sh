#!/usr/bin/env bash
# self-check.sh — fixed-action frame extraction for finished videos.
#
# Pulls 6 frames at deterministic timestamps (start, 10%, 33%, 66%, 90%,
# end-1-frame) from a project's final-mixed.mp4 and writes them to
# projects/<project>/qa/self-check/. Then runs scripts/acceptance.py
# against the video and prints the result.
#
# Per project rule #6: this is a fixed step after every compose, not an
# emergency measure. The bug-density this catches is the highest of
# any single check.
#
# Usage:
#   bash scripts/self-check.sh <project>
#
# Exit code matches acceptance.py: 0 if every check passes, 1 otherwise.
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: bash scripts/self-check.sh <project>" >&2
  exit 2
fi

PROJECT="$1"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="$REPO_ROOT/projects/$PROJECT/output/final-mixed.mp4"
QA_DIR="$REPO_ROOT/projects/$PROJECT/qa/self-check"

if [[ ! -f "$TARGET" ]]; then
  echo "self-check: $TARGET missing — has 'video make' run?" >&2
  exit 1
fi

mkdir -p "$QA_DIR"

# Resolve six timestamps: t=0, t=10%, t=33%, t=66%, t=90%, and one frame
# from the end. Use ffprobe to get the duration so the percentages are
# exact rather than guessed.
DURATION="$(ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "$TARGET" | awk '{print $1}')"
if [[ -z "$DURATION" || "$DURATION" == "N/A" ]]; then
  echo "self-check: could not read duration of $TARGET" >&2
  exit 1
fi
FPS="$(ffprobe -v error -select_streams v -show_entries stream=avg_frame_rate -of default=noprint_wrappers=1:nokey=1 "$TARGET" | awk -F/ '{ if ($2) printf "%.6f\n", $1/$2; else print $1 }')"
LAST_FRAME_OFFSET="$(awk -v fps="$FPS" 'BEGIN { if (fps > 0) print 1.0/fps; else print 0.04 }')"
END_OFFSET="$(awk -v d="$DURATION" -v o="$LAST_FRAME_OFFSET" 'BEGIN { v = d - o; if (v < 0) v = d/2; print v }')"

# Compute sample timestamps in seconds.
T_START=0
T_10="$(awk -v d="$DURATION" 'BEGIN { printf "%.3f\n", d * 0.10 }')"
T_33="$(awk -v d="$DURATION" 'BEGIN { printf "%.3f\n", d * 0.33 }')"
T_66="$(awk -v d="$DURATION" 'BEGIN { printf "%.3f\n", d * 0.66 }')"
T_90="$(awk -v d="$DURATION" 'BEGIN { printf "%.3f\n", d * 0.90 }')"

echo "self-check: $TARGET  duration=${DURATION}s  fps=${FPS}"
echo "self-check: extracting 6 frames → $QA_DIR"
extract() {
  local label="$1"
  local t="$2"
  ffmpeg -hide_banner -loglevel error -y -ss "$t" -i "$TARGET" -frames:v 1 \
    "$QA_DIR/${label}_t${t}.jpg" >/dev/null
}
extract frame_01_start  "$T_START"
extract frame_02_10pct  "$T_10"
extract frame_03_33pct  "$T_33"
extract frame_04_66pct  "$T_66"
extract frame_05_90pct  "$T_90"
extract frame_06_end    "$END_OFFSET"

echo "self-check: running acceptance.py"
echo
cd "$REPO_ROOT"
python3 scripts/acceptance.py "$PROJECT"
