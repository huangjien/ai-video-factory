# Demo 1 — MCP Explainer (45 s, 5 scenes)

Plan §17/§35 Demo 1: diagram + whiteboard explainer of how the Model
Context Protocol works, built deterministically (no LLM, no network) so
the integration test can render it end to end.

## What it exercises

| Scene | Component family | Pipeline feature |
|---|---|---|
| 1 — MCP title | `Title` (remotion) | entrance animation, narration WAV |
| 2 — Agent → MCP Client | `SvgScene` (svg) | T4.3 diagram draw-on |
| 3 — Client → MCP Server | `SvgScene` (svg) | explicit `animations[]` (draw + highlight) |
| 4 — Server hub | `SvgScene` (svg) | staggered arrow draws, 4-node hub |
| 5 — structured result | `DoodleScene` (canvas) | T4.4 hand-drawn ink |

Plus: duration sync against real narration WAVs, captions, scene
versioning, the QA report/gate, and Excalidraw asset generation.

## Run it for real

```bash
pnpm build
node packages/cli/dist/index.js new mcp-explainer
cp examples/mcp-explainer/storyboard.yaml projects/mcp-explainer/storyboard/
cp examples/mcp-explainer/captions/zh-CN.srt projects/mcp-explainer/captions/
# 9s silent narration per scene (or generate real TTS with `vf audio`)
for i in 01 02 03 04 05; do
  ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=mono -t 9 projects/mcp-explainer/assets/audio/scene-$i.wav
done
node packages/cli/dist/index.js approve storyboard --cwd projects/mcp-explainer
node packages/cli/dist/index.js preview --cwd projects/mcp-explainer
node packages/cli/dist/index.js excalidraw mcp-explainer
node packages/cli/dist/index.js qa mcp-explainer
node packages/cli/dist/index.js approve review --cwd projects/mcp-explainer
node packages/cli/dist/index.js final --cwd projects/mcp-explainer --mix   # --mix needs BGM, see vf audio-asset
```

The committed integration test (`packages/cli/src/demo-mcp.test.ts`) runs
this exact sequence against a temp project.
