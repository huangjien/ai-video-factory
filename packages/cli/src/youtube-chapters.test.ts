import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runYouTube } from "./youtube-command.js";

/** Article whose DECLARED durations deliberately disagree with the rendered
 *  storyboard. Chapter timestamps are cumulative offsets into the finished
 *  MP4, so they must be summed from the durations the renderer used. */
function articleMd(declared: number[]): string {
  const scenes = declared
    .map(
      (d, i) => `  - id: scene_${i + 1}
    duration: ${d}
    caption: 标题${i + 1}
    visual: 清单 (要点)
    narration: |
      第${i + 1}句旁白。`,
    )
    .join("\n");
  return `---
project: demo
language: zh-CN
duration_target_sec: ${declared.reduce((a, b) => a + b, 0)}
voice: zh-CN-YunjianNeural
---

# 演示

## 一段正文。

## Scenes

\`\`\`yaml
scenes:
${scenes}
\`\`\`
`;
}

function storyboardYaml(durations: number[]): string {
  const scenes = durations
    .map(
      (d, i) => `  - id: scene-${String(i + 1).padStart(2, "0")}
    duration: ${d}
    narration:
      text: 第${i + 1}句旁白。
    visual:
      component: Title
      props:
        text: t${i + 1}`,
    )
    .join("\n");
  return `schema_version: "0.1"
project:
  id: demo
  language: zh-CN
  fps: 30
  width: 1920
  height: 1080
scenes:
${scenes}
`;
}

const goodYaml = `title: "标题"
description: |
  描述。
chapters:
  - timestamp: "00:00"
    title: 开场
thumbnail_prompt: "A person leaning toward camera · warm side-light · cozy room at dawn"
shorts_hook: "A hand lifts a card · clear voice · morning light · curious tone"`;

describe("youtube packaging uses the RENDERED scene durations", () => {
  let server: Server;
  let baseUrl: string;
  const sent: string[] = [];

  beforeAll(async () => {
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      let body = "";
      req.on("data", (c) => {
        body += c;
      });
      req.on("end", () => {
        sent.push(body);
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            choices: [
              {
                message: { content: "```yaml\n" + goodYaml + "\n```" },
                index: 0,
                finish_reason: "stop",
              },
            ],
            usage: { prompt_tokens: 350, completion_tokens: 220 },
          }),
        );
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${addr.port}`;
    process.env["MINIMAX_API_KEY"] = "test-key-do-not-leak";
    process.env["MINIMAX_API_HOST"] = baseUrl;
  });

  afterAll(async () => new Promise<void>((r) => server.close(() => r())));

  function seed(root: string, declared: number[], rendered?: number[]) {
    mkdirSync(path.join(root, "storyboard"), { recursive: true });
    writeFileSync(path.join(root, "article.md"), articleMd(declared));
    if (rendered) {
      writeFileSync(
        path.join(root, "storyboard", "storyboard.yaml"),
        storyboardYaml(rendered),
      );
    }
  }

  /** The `## Storyboard (VDSL)` block only — the research echo carries the
   *  raw article, so a bare substring check would match the declared values. */
  function storyboardBlock(): string {
    const all = sent.join("\n");
    const start = all.indexOf("## Storyboard (VDSL)");
    const end = all.indexOf("## Script (Markdown)");
    return start === -1 ? "" : all.slice(start, end === -1 ? undefined : end);
  }

  it("sends the storyboard.yaml durations, not the article's declared ones", async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "video-yt-ch-"));
    seed(path.join(cwd, "projects", "demo"), [20, 20], [10.5, 9.5]);
    sent.length = 0;

    expect(await runYouTube({ project: "demo", cwd, model: "minimax" })).toBe(
      0,
    );

    const sb = storyboardBlock();
    expect(sb).toContain("duration: 10.5");
    expect(sb).toContain("duration: 9.5");
    expect(sb).not.toContain("duration: 20");
  });

  it("falls back to declared durations when the rendered scene count differs", async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "video-yt-ch-"));
    // Three rendered scenes against two article scenes — the index→scene
    // mapping is unknown, so the declared values are the safer input.
    seed(path.join(cwd, "projects", "demo2"), [20, 20], [10.5, 9.5, 3]);
    sent.length = 0;

    expect(await runYouTube({ project: "demo2", cwd, model: "minimax" })).toBe(
      0,
    );

    const sb = storyboardBlock();
    expect(sb).toContain("duration: 20");
    expect(sb).not.toContain("duration: 10.5");
  });

  it("falls back to declared durations when no storyboard.yaml exists", async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "video-yt-ch-"));
    const root = path.join(cwd, "projects", "demo3");
    seed(root, [20, 20]);
    // resolveProjectDir recognises a project by storyboard.yaml or state.yaml;
    // with the former deliberately absent, mark it with the latter.
    writeFileSync(path.join(root, "state.yaml"), "status: DRAFT\n");
    sent.length = 0;

    expect(await runYouTube({ project: "demo3", cwd, model: "minimax" })).toBe(
      0,
    );

    expect(storyboardBlock()).toContain("duration: 20");
  });
});
