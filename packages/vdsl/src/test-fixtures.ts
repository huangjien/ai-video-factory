/** The §21.1 sample (doc lines 889-922), two scenes for duplicate-id tests. */
export const validStoryboardYaml = `schema_version: "0.1"

project:
  id: ai-cot
  language: zh-CN
  fps: 30
  width: 1920
  height: 1080

style:
  theme: dark-tech

scenes:
  - id: scene-01
    duration: 8
    narration:
      text: "AI Agent 为什么需要 Memory？"
      audio: assets/audio/scene-01.wav
    visual:
      component: Title
      props:
        text: "AI Agent 为什么需要 Memory？"
    animation:
      entrance: fade
      emphasis: none
      exit: none
    captions:
      source: narration
      text: "AI Agent 为什么需要 Memory？"
    transition:
      in: fade
      out: cut
  - id: scene-02
    duration: 6
    visual:
      component: Paragraph
      props:
        text: "因为上下文会丢失。"
    animation:
      entrance: slide
    captions:
      source: narration
`;
