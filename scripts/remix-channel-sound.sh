#!/usr/bin/env bash
# Re-mix the earlier films with the channel sound system:
#   brand motif [0-12s] → body track → brand motif [last 12s]
# Only the mix step changes: TTS, images and scene renders all stay cached.
set -u
cd /Users/huangjien/workspace/ai-video-factory

BRAND="epic-the-epic-hero"

# project | body track (topic family per docs/channel-sound-system.md)
PLAN=(
  "把软件团队也看做系统|inspiring-flowing-energy"
  "软件架构和实现|classical-gymnopedie-no-3"
  "领域建模-设计软件的骨相|ambient-take-your-pick"
  "从伍什到班排的历史演变|medieval-adventure-beyond"
  "扁平化组织与任务式指挥|electronic-nekozilla"
)

patch_config() {  # <config path> <body track> <duration sec>
  local cfg="$1" body="$2" dur="$3"
  python3 - "$cfg" "$body" "$dur" "$BRAND" <<'PY'
import re, sys
cfg_path, body, dur, brand = sys.argv[1], sys.argv[2], float(sys.argv[3]), sys.argv[4]
body_end = int(round(dur)) - 12
t = open(cfg_path, encoding="utf-8").read()
t = re.sub(r'^bgm:.*$', '', t, flags=re.M)              # bgm_tracks supersedes it
t = re.sub(r'^bgm_tracks:.*?(?=\n\S)', '', t, flags=re.M | re.S)
t = re.sub(r'\n{3,}', '\n\n', t).strip()
tracks = ("bgm_tracks:\n"
          "  - { track: %s, until_sec: 12 }\n" % brand +
          "  - { track: %s, until_sec: %d }\n" % (body, body_end) +
          "  - { track: %s }\n" % brand)
t = t.replace("bgm_fade_in_sec", tracks + "bgm_fade_in_sec", 1)
open(cfg_path, "w", encoding="utf-8").write(t + "\n")
print("  body=%s until_sec=%d" % (body, body_end))
PY
}

for entry in "${PLAN[@]}"; do
  proj="${entry%%|*}"; body="${entry##*|}"
  for lang in zh en; do
    if [ "$lang" = "zh" ]; then
      root="projects/$proj"; cfg="$root/audio-config.yaml"; vid="$root/output/final-mixed.mp4"; args=("$proj")
    else
      root="projects/$proj/l10n/en-US"; cfg="$root/audio-config.yaml"; vid="$root/output/final-mixed.mp4"; args=("$proj" --lang en-US)
    fi
    [ -f "$cfg" ] || { echo "SKIP (no config): $root"; continue; }
    dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$vid" 2>/dev/null)
    [ -n "$dur" ] || { echo "SKIP (no film): $root"; continue; }
    echo "=== $proj [$lang] dur=${dur}s body=$body"
    patch_config "$cfg" "$body" "$dur"
    video make "${args[@]}" 2>&1 | grep -E "bgm timeline|make: done|✗ mix" | sed 's/^/  /'
  done
done
echo "ALL REMIXES DONE"
