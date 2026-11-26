import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  buildFallbackPackage,
  clampChars,
  deriveTopics,
  verticalFilter,
  DouyinPackageSchema,
  DOUYIN_DESCRIPTION_MAX,
  DOUYIN_TITLE_MAX,
  DOUYIN_TOPIC_MAX,
  DOUYIN_TOPICS_MAX,
} from "./index.js";
import {
  DouyinUploadError,
  exchangeCodeForToken,
  uploadDouyin,
} from "./uploader.js";
import { renderChecklist } from "./checklist.js";

const ARTICLE = `---
project: demo
language: zh-CN
duration_target_sec: 180
---

# 面部重建：一张脸有多少是证据

> **Hook** (≤20s): 一张流传千年的肖像，可能比一具真实头骨更能骗人。

## 1. 颅骨能给出什么

考古学家用面部重建从骨骼标志点开始，颅骨形态能确定大比例关系。

## 2. 软组织只是估计

鼻唇耳的形态只能给到中等把握，发色瞳色几乎全靠创作补全。

## Scenes

\`\`\`yaml
scenes:
  - id: scene_1
    visual: 颅骨模型
\`\`\`
`;

describe("clampChars", () => {
  it("counts characters, not bytes", () => {
    expect([...clampChars("一二三四五", 3)].length).toBe(3);
  });

  it("does not split a surrogate pair at the cut", () => {
    const out = clampChars("👩‍🚀🚀", 2);
    expect(out).not.toContain("�");
  });
});

describe("deriveTopics", () => {
  it("picks terms from the subject matter", () => {
    const topics = deriveTopics(ARTICLE);
    expect(topics).toContain("考古");
    expect(topics).toContain("面部重建");
  });

  it("respects Douyin's count cap", () => {
    const many = Array.from({ length: 40 }, (_, i) => `词${i}`).join(" ");
    expect(deriveTopics(many).length).toBeLessThanOrEqual(DOUYIN_TOPICS_MAX);
  });
});

describe("buildFallbackPackage", () => {
  it("produces a package that satisfies the schema", () => {
    const pkg = buildFallbackPackage({ article: ARTICLE });
    expect(() => DouyinPackageSchema.parse(pkg)).not.toThrow();
  });

  it("takes the title from the article H1", () => {
    const pkg = buildFallbackPackage({ article: ARTICLE });
    expect(pkg.title.startsWith("面部重建")).toBe(true);
  });

  it("never exceeds Douyin's field limits", () => {
    const long = `# ${"长".repeat(300)}\n\n${"正文".repeat(3000)}`;
    const pkg = buildFallbackPackage({ article: long });
    expect([...pkg.title].length).toBeLessThanOrEqual(DOUYIN_TITLE_MAX);
    expect([...pkg.description].length).toBeLessThanOrEqual(
      DOUYIN_DESCRIPTION_MAX,
    );
    for (const topic of pkg.topics) {
      expect([...topic].length).toBeLessThanOrEqual(DOUYIN_TOPIC_MAX);
    }
  });

  it("leaves out the Scenes YAML block", () => {
    const pkg = buildFallbackPackage({ article: ARTICLE });
    expect(pkg.description).not.toContain("scene_1");
  });

  it("stays valid for an article with no hook and no prose", () => {
    const pkg = buildFallbackPackage({ article: "# 只有标题" });
    expect(() => DouyinPackageSchema.parse(pkg)).not.toThrow();
  });
});

describe("verticalFilter", () => {
  it("keeps the whole frame in inset mode", () => {
    const graph = verticalFilter("inset", 1080, 1920, 40);
    // The backdrop is the frame scaled to COVER and blurred...
    expect(graph).toContain("force_original_aspect_ratio=increase");
    expect(graph).toContain("gblur=sigma=40");
    // ...and the foreground is the frame scaled to FIT, centred on top.
    expect(graph).toContain("scale=1080:-2");
    expect(graph).toContain("overlay=(W-w)/2:(H-h)/2");
  });

  it("crops in crop mode", () => {
    const graph = verticalFilter("crop", 1080, 1920, 40);
    expect(graph).toContain("crop=ih*9/16:ih");
    expect(graph).not.toContain("overlay");
  });

  it("labels its output so the caller can map it", () => {
    expect(verticalFilter("inset", 1080, 1920, 40)).toContain("[v]");
  });
});

describe("renderChecklist", () => {
  it("names every field the creator form asks for", () => {
    const pkg = buildFallbackPackage({ article: ARTICLE });
    const text = renderChecklist({
      pkg,
      videoPath: "/tmp/video.mp4",
      uploadBlocker: "no DOUYIN_ACCESS_TOKEN",
    });
    expect(text).toContain("抖音投稿清单");
    expect(text).toContain("## 标题");
    expect(text).toContain("## 文案");
    expect(text).toContain("## 话题");
    expect(text).toContain("## 封面");
    expect(text).toContain("DOUYIN_ACCESS_TOKEN");
  });
});

describe("uploadDouyin", () => {
  function fixture(): string {
    const dir = mkdtempSync(path.join(tmpdir(), "douyin-upload-"));
    const file = path.join(dir, "video.mp4");
    writeFileSync(file, "not really a video");
    return file;
  }

  const pkg = {
    title: "标题",
    description: "文案",
    topics: ["考古"],
    cover_prompt: "a scene",
  };

  it("creates, uploads and commits", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      calls.push(u);
      if (u.includes("/video/create/")) {
        return new Response(
          JSON.stringify({
            data: {
              video: {
                video_id: "v-1",
                upload_url: "https://upload.example/put",
              },
            },
          }),
          { status: 200 },
        );
      }
      if (u === "https://upload.example/put") {
        expect(init?.body).toBeInstanceOf(FormData);
        return new Response("", { status: 200 });
      }
      return new Response(JSON.stringify({ data: { item_id: "item-1" } }), {
        status: 200,
      });
    }) as unknown as typeof fetch;

    const result = await uploadDouyin({
      videoPath: fixture(),
      pkg,
      accessToken: "token-1",
      fetchImpl,
    });
    expect(result.item_id).toBe("item-1");
    expect(calls[0]).toContain("access_token=token-1");
    expect(calls.some((c) => c.includes("/video/upload/"))).toBe(true);
  });

  it("reports the API's own reason when the create call fails", async () => {
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({
          error_code: 4001,
          description: "capability not approved",
        }),
        { status: 400 },
      )) as unknown as typeof fetch;

    await expect(
      uploadDouyin({
        videoPath: fixture(),
        pkg,
        accessToken: "token-1",
        fetchImpl,
      }),
    ).rejects.toThrow(/capability not approved/);
    await expect(
      uploadDouyin({
        videoPath: fixture(),
        pkg,
        accessToken: "token-1",
        fetchImpl,
      }),
    ).rejects.toBeInstanceOf(DouyinUploadError);
  });
});

describe("exchangeCodeForToken", () => {
  it("returns the access token the API hands back", async () => {
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({ data: { access_token: "tok", open_id: "oid" } }),
        { status: 200 },
      )) as unknown as typeof fetch;
    const out = await exchangeCodeForToken({
      clientKey: "k",
      clientSecret: "s",
      code: "c",
      fetchImpl,
    });
    expect(out.accessToken).toBe("tok");
    expect(out.openId).toBe("oid");
  });

  it("throws with the API's message when the code is refused", async () => {
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({ error_code: 28001, description: "invalid code" }),
        { status: 400 },
      )) as unknown as typeof fetch;
    await expect(
      exchangeCodeForToken({
        clientKey: "k",
        clientSecret: "s",
        code: "c",
        fetchImpl,
      }),
    ).rejects.toThrow(/invalid code/);
  });
});
