# Demo 2 — AI Concept (60 s, hand-drawn canvas)

Plan §35 Demo 2: "How a neural network learns" — six 10 s scenes drawn
entirely in code on canvas (T4.4 `DoodleScene`), exercising the
javascript-animation skill contract: every frame is a pure function of the
frame number, seeded wobble, no assets, no network.

**Beat-sync**: every scene sets `bpm: 100` (0.6 s grid); stroke onsets are
quantized to the beat — verified mechanically in
`packages/video-components/src/components/doodleLogic.test.ts` and by the
end-to-end render in `packages/cli/src/demo-ai-concept.test.ts`.

## Scenes

1. data (circle + noisy zigzag) → 2. neurons (three circles + wires) →
3. prediction (star) → 4. error (truth circle + red gap) → 5. training
loop (spiral) → 6. hit (green star + check).

## Run it for real

```bash
pnpm build
node packages/cli/dist/index.js new ai-concept
cp examples/ai-concept/storyboard.yaml projects/ai-concept/storyboard/
cp examples/ai-concept/captions/zh-CN.srt projects/ai-concept/captions/
for i in 01 02 03 04 05 06; do
  ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=mono -t 10 projects/ai-concept/assets/audio/scene-$i.wav
done
node packages/cli/dist/index.js approve storyboard --cwd projects/ai-concept
node packages/cli/dist/index.js preview --cwd projects/ai-concept
node packages/cli/dist/index.js approve review --cwd projects/ai-concept
node packages/cli/dist/index.js final --cwd projects/ai-concept
```
