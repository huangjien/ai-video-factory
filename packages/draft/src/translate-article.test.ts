import { describe, expect, it } from "vitest";
import { loadPrompt } from "@video/prompts";
import { existsSync, readFileSync, statSync } from "node:fs";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  TranslateArticleError,
  canonicalLanguage,
  captionsSourceFor,
  hasL10n,
  translateArticle,
} from "./translate-article.js";
import type { Provider } from "@video/llm";

const CANONICAL = `---
project: 测试项目
language: zh-CN
duration_target_sec: 60
voice: narrator-zh
image_style: editorial
---

# 测试项目

## Scenes

\`\`\`yaml
scenes:
  - id: scene_1
    duration: 10
    caption: 标题场景
    visual: 深蓝会议桌上的一份提案卡片，冷白顶灯
    narration: |
      第一段的旁白内容。
  - id: scene_2
    duration: 12
    caption: 第二场景
    visual: 一本摊开的技术书，细金线串起光点
    narration: |
      第二段的旁白内容。
\`\`\`
`;

const AUDIO_CONFIG = `voice: zh-CN-YunjianNeural
bgm: calm
sfx: {}
`;

/** Fake provider: returns a canned "translation" with the visual lines
 *  MANGLED — the module must pin them back to canonical byte-for-byte. */
function fakeProvider(response: () => string): Provider {
  return {
    name: "fake",
    chat: async () => ({ content: response(), usage: { input: 1, output: 1 } }),
  };
}

const TRANSLATED = (visualOverride?: (v: string) => string): string => `---
project: 测试项目
language: zh-CN
duration_target_sec: 60
voice: narrator-zh
---

# Test project

## Scenes

\`\`\`yaml
scenes:
  - id: scene_1
    duration: 10
    caption: Title scene
    visual: ${(visualOverride ?? ((v) => v))("深蓝会议桌上的一份提案卡片，冷白顶灯")}
    narration: |
      Narration for the first scene.
  - id: scene_2
    duration: 12
    caption: Second scene
    visual: ${(visualOverride ?? ((v) => v))("一本摊开的技术书，细金线串起光点")}
    narration: |
      Narration for the second scene.
\`\`\`
`;

async function makeProject(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "vidtranslate-"));
  await writeFile(path.join(root, "article.md"), CANONICAL, "utf8");
  await writeFile(path.join(root, "audio-config.yaml"), AUDIO_CONFIG, "utf8");
  await mkdir(path.join(root, "assets", "images"), { recursive: true });
  return root;
}

/** A canonical article with `n` scenes — the fixture a long film needs
 *  (the batching test needs more than one batch of overflow). */
function canonicalWithScenes(n: number): string {
  const scenes = Array.from({ length: n }, (_, i) => {
    const id = i + 1;
    return `  - id: scene_${id}
    duration: 10
    caption: 标题${id}
    visual: 视觉描述${id}
    narration: |
      第${id}段的旁白内容。`;
  }).join("\n");
  return `---
project: 测试项目
language: zh-CN
duration_target_sec: ${n * 10}
voice: narrator-zh
image_style: editorial
---

# 测试项目

## Scenes

\`\`\`yaml
scenes:
${scenes}
\`\`\`
`;
}

/** The English translation of that article — every narration over the
 *  caption budget, which is what forces the condensation call. */
function translatedWithScenes(n: number, long: (i: number) => string): string {
  const scenes = Array.from({ length: n }, (_, i) => {
    const id = i + 1;
    return `  - id: scene_${id}
    duration: 10
    caption: Title ${id}
    visual: 视觉描述${id}
    narration: |
      ${long(id)}`;
  }).join("\n");
  return `---
project: 测试项目
language: zh-CN
duration_target_sec: ${n * 10}
voice: narrator-zh
---

# Test project

## Scenes

\`\`\`yaml
scenes:
${scenes}
\`\`\`
`;
}

async function makeProjectWithScenes(n: number): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "vidtranslate-"));
  await writeFile(
    path.join(root, "article.md"),
    canonicalWithScenes(n),
    "utf8",
  );
  await writeFile(path.join(root, "audio-config.yaml"), AUDIO_CONFIG, "utf8");
  await mkdir(path.join(root, "assets", "images"), { recursive: true });
  return root;
}

describe("translate prompt — name localization rule", () => {
  it("instructs the model to localize placeholder names, never transliterate", () => {
    const prompt = loadPrompt("translate-article");
    expect(prompt).toContain("PLACEHOLDER PERSONAL NAMES");
    expect(prompt).toContain("never transliterate");
    expect(prompt).toContain("小王");
    expect(prompt).toContain("Elon Musk");
  });

  it("pins the caption-budget rule and the condensation contract", () => {
    expect(loadPrompt("translate-article")).toContain("caption block");
    const condense = loadPrompt("translate-condense");
    expect(condense).toContain("scene_id:");
    expect(condense).toContain("185");
    expect(condense).toContain("{{SCENES_JSON}}");
  });
});

describe("translateArticle", () => {
  it("creates an l10n workdir with pinned visuals, rewritten frontmatter, swapped voice, and a shared images symlink", async () => {
    const root = await makeProject();
    await writeFile(
      path.join(root, "assets", "images", "scene_1.cache.json"),
      '{"cacheKey":"sha256:sentinel"}',
      "utf8",
    );
    try {
      const res = await translateArticle({
        projectRoot: root,
        targetLang: "en-US",
        provider: fakeProvider(() => TRANSLATED()),
        voice: "en-US-ChristopherNeural",
      });
      const article = readFileSync(res.articlePath, "utf8");
      // Pinned visuals survive a hostile translation.
      expect(article).toContain("visual: 深蓝会议桌上的一份提案卡片，冷白顶灯");
      expect(article).toContain("visual: 一本摊开的技术书，细金线串起光点");
      // Frontmatter rewrite. The caption source is NOT switched for
      // English: the label is already on screen (the Pillow banner at
      // the top), so burning it again at the bottom repeated the frame
      // and left no subtitle. A translation burns the narration.
      expect(article).toContain("language: en-US");
      expect(article).not.toContain("captions_source");
      // Structure preserved.
      expect(article).toContain("id: scene_1");
      expect(article).toContain("id: scene_2");
      expect(article).toContain("Narration for the first scene.");
      // audio-config voice swapped, other lines untouched.
      const cfg = readFileSync(
        path.join(res.l10nRoot, "audio-config.yaml"),
        "utf8",
      );
      expect(cfg).toContain("voice: en-US-ChristopherNeural");
      expect(cfg).toContain("bgm: calm");
      // Images symlink resolves into the canonical store — a sentinel
      // sidecar in the shared dir is readable through the link.
      const link = path.join(res.l10nRoot, "assets", "images");
      expect(statSync(link).isDirectory()).toBe(true);
      expect(
        readFileSync(path.join(link, "scene_1.cache.json"), "utf8"),
      ).toContain("sentinel");
      // Project-root markers so resolveProjectDir / make accept the workdir.
      expect(existsSync(path.join(res.l10nRoot, "state.yaml"))).toBe(true);
      expect(hasL10n(root, "en-US")).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("pins a visual value the model wrapped across several lines", async () => {
    // A long visual line comes back from the model as a wrapped multi-line
    // plain scalar. A line-based pin replaces only the first physical line,
    // leaving the continuation lines behind — the pinned text then parses
    // back to a DIFFERENT visual and the structure check rejects it.
    const root = await makeProject();
    const wrapped = `---
project: 测试项目
language: zh-CN
duration_target_sec: 60
voice: narrator-zh
---

# Test project

## Scenes

\`\`\`yaml
scenes:
  - id: scene_1
    duration: 10
    caption: Title scene
    visual: 深蓝会议桌上的一份提案卡片
      ，冷白顶灯从上方落下，桌面反射出微弱的光斑
    narration: |
      Narration for the first scene.
  - id: scene_2
    duration: 12
    caption: Second scene
    visual: 一本摊开的技术书，细金线串起光点
    narration: |
      Narration for the second scene.
\`\`\`
`;
    try {
      const res = await translateArticle({
        projectRoot: root,
        targetLang: "en-US",
        provider: fakeProvider(() => wrapped),
        voice: "en-US-ChristopherNeural",
      });
      const article = readFileSync(res.articlePath, "utf8");
      // The whole wrapped scalar collapsed back to the canonical one-liner.
      expect(article).toContain("visual: 深蓝会议桌上的一份提案卡片，冷白顶灯");
      expect(article).not.toContain("，冷白顶灯从上方落下");
      expect(article).toContain("visual: 一本摊开的技术书，细金线串起光点");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("restores a visual key the model dropped", async () => {
    const root = await makeProject();
    const dropped = `---
project: 测试项目
language: zh-CN
duration_target_sec: 60
voice: narrator-zh
---

# Test project

## Scenes

\`\`\`yaml
scenes:
  - id: scene_1
    duration: 10
    caption: Title scene
    narration: |
      Narration for the first scene.
  - id: scene_2
    duration: 12
    caption: Second scene
    visual: 一本摊开的技术书，细金线串起光点
    narration: |
      Narration for the second scene.
\`\`\`
`;
    try {
      const res = await translateArticle({
        projectRoot: root,
        targetLang: "en-US",
        provider: fakeProvider(() => dropped),
        voice: "en-US-ChristopherNeural",
      });
      const article = readFileSync(res.articlePath, "utf8");
      expect(article).toContain("visual: 深蓝会议桌上的一份提案卡片，冷白顶灯");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("translates a reasoning-model reply that leads with a <think> block", async () => {
    // MiniMax (and other reasoning providers) answer with a leading
    // `<think>…</think>` block. Before the strip, the frontmatter check
    // failed and every scene read as "missing from translation" — a
    // provider wrapper, not a bad translation, threw the whole thing away.
    const root = await makeProject();
    const thinking = fakeProvider(() =>
      `<think>\n\nLet me translate each scene.\n</think>\n\n${TRANSLATED()}`,
    );
    try {
      const res = await translateArticle({
        projectRoot: root,
        targetLang: "en-US",
        provider: thinking,
        voice: "en-US-ChristopherNeural",
      });
      const article = readFileSync(res.articlePath, "utf8");
      expect(article).not.toContain("<think>");
      expect(article).toContain("Narration for the first scene.");
      expect(article).toContain("language: en-US");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects translating to the canonical language", async () => {
    const root = await makeProject();
    try {
      await expect(
        translateArticle({
          projectRoot: root,
          targetLang: "zh-CN",
          provider: fakeProvider(() => TRANSLATED()),
          voice: "zh-CN-YunjianNeural",
        }),
      ).rejects.toThrow(TranslateArticleError);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("refuses to overwrite without --force", async () => {
    const root = await makeProject();
    try {
      const opts = {
        projectRoot: root,
        targetLang: "en-US",
        provider: fakeProvider(() => TRANSLATED()),
        voice: "en-US-ChristopherNeural",
      };
      await translateArticle(opts);
      await expect(translateArticle(opts)).rejects.toThrow(/--force/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails with violations when the translation breaks structure", async () => {
    const root = await makeProject();
    try {
      // Dropping a scene → scene-count violation, unrecoverable.
      const broken = TRANSLATED().replace(
        /  - id: scene_2[\s\S]*?\n```/,
        "```",
      );
      await expect(
        translateArticle({
          projectRoot: root,
          targetLang: "en-US",
          provider: fakeProvider(() => broken),
          voice: "en-US-ChristopherNeural",
          maxAttempts: 1,
        }),
      ).rejects.toThrow(/scene count/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("condenses over-budget narrations instead of a full rewrite", async () => {
    const root = await makeProject();
    // A Latin translation of the same content needs ~1.6x the characters
    // of the source, so a faithful translation overflows the four-line
    // caption block. The loop must re-ask ONLY for the over-budget
    // narration (condensation call) and splice the shorter text back.
    const overlong = TRANSLATED().replace(
      "Narration for the first scene.",
      "In the occupations most exposed to automation, employment for people aged twenty-two to twenty-five runs about nineteen percent below the baseline the trend would predict, according to research based on United States payroll records.",
    );
    const condensation =
      "scene_1: Employment for people aged twenty-two to twenty-five runs nineteen percent below trend, per US payroll research.";
    let calls = 0;
    try {
      const res = await translateArticle({
        projectRoot: root,
        targetLang: "en-US",
        provider: fakeProvider(() => {
          calls += 1;
          return calls === 1 ? overlong : condensation;
        }),
        voice: "en-US-ChristopherNeural",
        maxAttempts: 2,
      });
      expect(calls).toBe(2);
      const article = readFileSync(res.articlePath, "utf8");
      expect(article).toContain(
        "Employment for people aged twenty-two to twenty-five runs nineteen percent below trend",
      );
      expect(article).not.toContain(
        "according to research based on United States payroll records",
      );
      // The untouched scene survives byte-for-byte.
      expect(article).toContain("Narration for the second scene.");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("trims a scene the model refuses to shorten instead of failing the film", async () => {
    // One stubborn scene must not cost the whole translation: when even
    // a single-scene ask will not fit the caption block, the narration
    // is cut at a clause boundary and the trim is reported.
    const root = await makeProject();
    const overlong = TRANSLATED().replace(
      "Narration for the first scene.",
      "In the occupations most exposed to automation, employment for people aged twenty-two to twenty-five runs about nineteen percent below the baseline the trend would predict, according to research based on United States payroll records.",
    );
    const stillOverlong =
      "scene_1: In the occupations most exposed to automation, employment for people aged twenty-two to twenty-five runs about nineteen percent below the baseline the trend would predict, according to research based on United States payroll records.";
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (msg: string) => {
      warnings.push(String(msg));
    };
    let calls = 0;
    try {
      const res = await translateArticle({
        projectRoot: root,
        targetLang: "en-US",
        provider: fakeProvider(() => {
          calls += 1;
          return calls === 1 ? overlong : stillOverlong;
        }),
        voice: "en-US-ChristopherNeural",
        maxAttempts: 1,
      });
      const article = readFileSync(res.articlePath, "utf8");
      // The trimmed narration fits the caption block and the loss is
      // reported, never silent.
      expect(article).not.toContain(
        "according to research based on United States payroll records",
      );
      expect(warnings.join("\n")).toContain("trimmed");
      expect(warnings.join("\n")).toContain("scene_1");
    } finally {
      console.warn = originalWarn;
      await rm(root, { recursive: true, force: true });
    }
  });

  it("names the real cause when the model returns empty content", async () => {
    const root = await makeProject();
    try {
      await expect(
        translateArticle({
          projectRoot: root,
          targetLang: "en-US",
          provider: fakeProvider(() => ""),
          voice: "en-US-ChristopherNeural",
          maxAttempts: 1,
        }),
      ).rejects.toThrow(/came back empty/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("batches the condensation call so a long film cannot exhaust the reasoning budget", async () => {
    // 20 over-budget narrations in ONE condensation call made the model
    // reason for 250k chars and never close its <think> block — the
    // answer came back empty and the translation failed. The ask must
    // be split: one call per batch of scenes.
    const root = await makeProjectWithScenes(20);
    const long = (n: number) =>
      `In the occupations most exposed to automation, employment for people aged twenty-two to twenty-five runs about nineteen percent below the baseline the trend would predict, according to research based on United States payroll records, part ${n}.`;
    const batches: string[][] = [];
    let translateCalls = 0;
    const provider: Provider = {
      name: "fake",
      chat: async ({ messages }) => {
        const prompt = messages.map((m) => m.content).join("\n");
        if (prompt.includes("Condense translated narration")) {
          const asked = [...prompt.matchAll(/^(scene_\d+):/gm)].map(
            (m) => m[1]!,
          );
          batches.push(asked);
          return {
            content: asked
              .map(
                (id) =>
                  `${id}: Employment for people aged twenty-two to twenty-five runs nineteen percent below trend, per US payroll research, part ${id.slice(-2)}.`,
              )
              .join("\n"),
            usage: { input: 1, output: 1 },
          };
        }
        translateCalls += 1;
        return {
          content: translatedWithScenes(20, long),
          usage: { input: 1, output: 1 },
        };
      },
    };
    try {
      const res = await translateArticle({
        projectRoot: root,
        targetLang: "en-US",
        provider,
        voice: "en-US-ChristopherNeural",
        maxAttempts: 1,
      });
      expect(translateCalls).toBe(1);
      // 20 scenes / batch size 8 → 3 condensation calls, each asking for
      // at most 8 scenes (the ask must stay small enough to answer).
      expect(batches.length).toBe(3);
      expect(batches.map((b) => b.length)).toEqual([8, 8, 4]);
      const article = readFileSync(res.articlePath, "utf8");
      expect(article).toContain(
        "Employment for people aged twenty-two to twenty-five runs nineteen percent below trend",
      );
      expect(article).not.toContain(
        "according to research based on United States payroll records",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("re-asks a scene in a smaller batch when the first condensation call comes back empty", async () => {
    // The model can outrun its reasoning budget on a batch and answer
    // nothing. The scene must not be lost: the ask is retried smaller,
    // down to one scene, where the model always answers.
    const root = await makeProject();
    const overlong = TRANSLATED().replace(
      "Narration for the first scene.",
      "In the occupations most exposed to automation, employment for people aged twenty-two to twenty-five runs about nineteen percent below the baseline the trend would predict, according to research based on United States payroll records.",
    );
    const condensation =
      "scene_1: Employment for people aged twenty-two to twenty-five runs nineteen percent below trend, per US payroll research.";
    const askedSizes: number[] = [];
    let calls = 0;
    try {
      const res = await translateArticle({
        projectRoot: root,
        targetLang: "en-US",
        provider: {
          name: "fake",
          chat: async ({ messages }) => {
            calls += 1;
            const prompt = messages.map((m) => m.content).join("\n");
            if (!prompt.includes("Condense translated narration")) {
              return { content: overlong, usage: { input: 1, output: 1 } };
            }
            const asked = [...prompt.matchAll(/^(scene_\d+):/gm)].map(
              (m) => m[1]!,
            );
            askedSizes.push(asked.length);
            // The first ask comes back empty; the retry answers.
            if (calls === 2) {
              return { content: "", usage: { input: 1, output: 1 } };
            }
            return {
              content: asked.map(() => condensation).join("\n"),
              usage: { input: 1, output: 1 },
            };
          },
        },
        voice: "en-US-ChristopherNeural",
        maxAttempts: 1,
      });
      expect(calls).toBe(3);
      expect(askedSizes).toEqual([1, 1]);
      const article = readFileSync(res.articlePath, "utf8");
      expect(article).toContain(
        "Employment for people aged twenty-two to twenty-five runs nineteen percent below trend",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("shows the model its own previous answer when a retry asks for less", async () => {
    // Without the previous answer and its measured length, a re-ask
    // reproduces the same length — the model has nothing to cut.
    const root = await makeProject();
    const overlong = TRANSLATED().replace(
      "Narration for the first scene.",
      "In the occupations most exposed to automation, employment for people aged twenty-two to twenty-five runs about nineteen percent below the baseline the trend would predict, according to research based on United States payroll records.",
    );
    const stillOverlong =
      "scene_1: In the occupations most exposed to automation, employment for people aged twenty-two to twenty-five runs about nineteen percent below the baseline the trend would predict, according to research based on United States payroll records.";
    const prompts: string[] = [];
    try {
      await translateArticle({
        projectRoot: root,
        targetLang: "en-US",
        provider: {
          name: "fake",
          chat: async ({ messages }) => {
            const prompt = messages.map((m) => m.content).join("\n");
            if (prompt.includes("Condense translated narration")) {
              prompts.push(prompt);
              return {
                content: stillOverlong,
                usage: { input: 1, output: 1 },
              };
            }
            return { content: overlong, usage: { input: 1, output: 1 } };
          },
        },
        voice: "en-US-ChristopherNeural",
        maxAttempts: 1,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
    // The retry carries the previous answer back to the model...
    expect(prompts.length).toBeGreaterThan(1);
    expect(prompts[1]).toContain(
      "In the occupations most exposed to automation, employment for people aged twenty-two to twenty-five runs about nineteen percent below the baseline",
    );
    // ...and states the limit it has to reach.
    expect(prompts[1]).toContain("PREVIOUS answers");
  });

  it("does not switch the caption source for any target", () => {
    // The English auto-switch burned the scene's short label at the
    // bottom — the same text the Pillow banner already puts at the top,
    // so the frame repeated itself and showed no subtitle. A
    // translation burns the narration, like the source language.
    expect(captionsSourceFor("en-US")).toBeUndefined();
    expect(captionsSourceFor("zh-CN")).toBeUndefined();
  });

  it("reads the canonical language from frontmatter", () => {
    expect(canonicalLanguage(CANONICAL)).toBe("zh-CN");
  });
});
