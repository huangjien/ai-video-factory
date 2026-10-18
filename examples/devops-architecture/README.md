# Demo 3 — DevOps Architecture (90 s, FlowChart + canvas)

Plan §35 Demo 3: a deployment-pipeline explainer in six 15 s diagram
scenes, exercising §35's acceptance list end to end:

- **Diagram** — five `FlowChart` scenes (commit → build → test → 3-way
  prod deploy → monitor), with the hand-drawn `DoodleScene` closer
- **Transitions** — `cut` between stages, `fade` in/out at the ends
- **Timeline** — the fifth scene is a hand-drawn canvas scene; the
  diagram scenes carry their own choreography

## Run it for real

```bash
pnpm build
node packages/cli/dist/index.js new devops-architecture
cp examples/devops-architecture/storyboard.yaml projects/devops-architecture/storyboard/
cp examples/devops-architecture/captions/zh-CN.srt projects/devops-architecture/captions/
for i in 01 02 03 04 05 06; do
  ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=mono -t 15 projects/devops-architecture/assets/audio/scene-$i.wav
done
node packages/cli/dist/index.js approve storyboard --cwd projects/devops-architecture
node packages/cli/dist/index.js preview --cwd projects/devops-architecture
node packages/cli/dist/index.js qa devops-architecture
node packages/cli/dist/index.js approve review --cwd projects/devops-architecture
node packages/cli/dist/index.js final --cwd projects/devops-architecture
```