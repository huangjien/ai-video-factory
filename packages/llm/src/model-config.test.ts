import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  availableGenerators,
  defaultModel,
  GeminiProvider,
  GLMProvider,
  loadModelConfig,
  loadProviderConfig,
  modelLabel,
  MiniMaxProvider,
  OpenAIProvider,
  repoConfigPath,
} from "./index.js";

/** Every model id the pipeline can serve, by kind — the keys the config
 *  file must define for the providers to start. */
const EVERY_ENTRY: [Parameters<typeof defaultModel>[0], string][] = [
  ["chat", "glm"],
  ["chat", "openai"],
  ["chat", "gemini"],
  ["chat", "minimax"],
  ["decision", "openai"],
  ["decision", "google"],
  ["decision", "minimax"],
  ["image", "minimax"],
  ["image", "minimax-h3"],
  ["image", "openai"],
  ["image", "gemini"],
  ["video", "minimax"],
  ["tts", "minimax"],
];

describe("config/llm.yaml — the single source of model ids", () => {
  let dir: string;
  let savedLlConfig: string | undefined;
  let savedOpenaiModel: string | undefined;
  let savedGeminiModel: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "vf-llm-config-"));
    savedLlConfig = process.env["LL_CONFIG"];
    savedOpenaiModel = process.env["OPENAI_MODEL"];
    savedGeminiModel = process.env["GEMINI_MODEL"];
    delete process.env["LL_CONFIG"];
    delete process.env["OPENAI_MODEL"];
    delete process.env["GEMINI_MODEL"];
  });

  afterEach(() => {
    process.env["LL_CONFIG"] = savedLlConfig;
    process.env["OPENAI_MODEL"] = savedOpenaiModel;
    process.env["GEMINI_MODEL"] = savedGeminiModel;
    rmSync(dir, { recursive: true, force: true });
  });

  /** Write an override file and point LL_CONFIG at it. */
  function override(yaml: string): string {
    const file = path.join(dir, "override.yaml");
    writeFileSync(file, yaml, "utf8");
    process.env["LL_CONFIG"] = file;
    return file;
  }

  it("uses the configured draft pool before filtering for API keys", () => {
    const roles = loadProviderConfig();
    override("draft: { generator_pool: [glm, openai] }");
    expect(
      availableGenerators({ GEMINI_API_KEY: "key", OPENAI_API_KEY: "key" }),
    ).toEqual(["openai"]);
    expect(loadProviderConfig()).toEqual(roles);
  });

  it.each(["[]", "[openai, openai]", "[minimax]"])(
    "rejects an invalid draft pool %s",
    (pool) => {
      override(`draft: { generator_pool: ${pool} }`);
      expect(() => availableGenerators({})).toThrow(/draft\.generator_pool/);
    },
  );

  it("ships in the repo, and every provider's model id resolves from it", () => {
    expect(repoConfigPath()?.endsWith(path.join("config", "llm.yaml"))).toBe(
      true,
    );
    const models = loadModelConfig();
    for (const [kind, provider] of EVERY_ENTRY) {
      // A blank id would be a silent "model not found" at call time.
      expect(defaultModel(kind, provider), `${kind}/${provider}`).toMatch(
        /^[A-Za-z0-9][A-Za-z0-9._-]*$/,
      );
      expect(models[kind]?.[provider]).toBe(defaultModel(kind, provider));
    }
  });

  it("an unknown provider or kind fails loudly, naming where to add it", () => {
    expect(() => defaultModel("chat", "nonexistent")).toThrow(
      /no model id for chat\/nonexistent — add it under models\.chat in .*config\/llm\.yaml/,
    );
  });

  it("LL_CONFIG replaces only the keys it names", () => {
    const before = loadModelConfig();
    override("models:\n  chat:\n    glm: glm-override-test\n");
    expect(defaultModel("chat", "glm")).toBe("glm-override-test");
    // Everything it did not name still comes from the repository file.
    expect(defaultModel("chat", "openai")).toBe(before.chat?.openai);
    expect(defaultModel("image", "minimax")).toBe(before.image?.minimax);
    expect(loadProviderConfig().storyboard.primary).toBe("minimax");
  });

  it("the original flat shape (role names at the top level) still parses as roles", () => {
    const file = path.join(dir, "flat.yaml");
    writeFileSync(file, "storyboard:\n  primary: glm\n  fallback: minimax\n");
    const cfg = loadProviderConfig(file);
    expect(cfg.storyboard.primary).toBe("glm");
    expect(cfg.storyboard.fallback).toBe("minimax");
    // Roles it did not name keep the repository file's values.
    expect(cfg.research.primary).toBe("glm");
  });

  it("an empty override file is an empty override", () => {
    override("");
    expect(defaultModel("chat", "glm")).toBe(loadModelConfig().chat?.glm);
  });

  it("a path that does not exist is ignored", () => {
    const cfg = loadProviderConfig(path.join(dir, "nope.yaml"));
    expect(cfg.storyboard.primary).toBe("minimax");
  });

  it("a malformed file throws naming the offending key — it is never applied in part", () => {
    const file = override("models:\n  chats:\n    glm: glm-5.3\n");
    expect(() => defaultModel("chat", "glm")).toThrow(new RegExp(file));
    expect(() => defaultModel("chat", "glm")).toThrow(/chats/);
  });

  it("a blank model id is a parse failure, not a default", () => {
    override('models:\n  chat:\n    glm: "   "\n');
    expect(() => defaultModel("chat", "glm")).toThrow(/models\.chat\.glm/);
  });

  it("a role without a primary is a parse failure", () => {
    override("roles:\n  review:\n    fallback: minimax\n");
    expect(() => loadProviderConfig()).toThrow(/roles\.review\.primary/);
  });

  it("a run record never fails on a missing id — it says `unknown`", () => {
    expect(modelLabel("chat", "glm")).toBe(defaultModel("chat", "glm"));
    // A stubbed or brand-new provider has no entry: the record is still
    // written, and it does not invent a name (the old helper stamped
    // every unknown provider as MiniMax-M3).
    expect(modelLabel("chat", undefined)).toBe("unknown");
    expect(modelLabel("chat", "some-new-provider")).toBe("unknown");
    // The strict lookup is the one an API call must use.
    expect(() => defaultModel("chat", "some-new-provider")).toThrow(
      /no model id/,
    );
  });
});

describe("providers take their default model from the config", () => {
  let dir: string;
  let savedLlConfig: string | undefined;
  let savedOpenaiModel: string | undefined;
  let savedGeminiModel: string | undefined;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "vf-llm-config-"));
    savedLlConfig = process.env["LL_CONFIG"];
    savedOpenaiModel = process.env["OPENAI_MODEL"];
    savedGeminiModel = process.env["GEMINI_MODEL"];
    delete process.env["LL_CONFIG"];
    delete process.env["OPENAI_MODEL"];
    delete process.env["GEMINI_MODEL"];
  });

  afterEach(() => {
    process.env["LL_CONFIG"] = savedLlConfig;
    process.env["OPENAI_MODEL"] = savedOpenaiModel;
    process.env["GEMINI_MODEL"] = savedGeminiModel;
    rmSync(dir, { recursive: true, force: true });
  });

  function overrideChat(yaml: string): void {
    const file = path.join(dir, "override.yaml");
    writeFileSync(file, yaml, "utf8");
    process.env["LL_CONFIG"] = file;
  }

  it("changing one id in the config moves every chat provider that serves it", () => {
    overrideChat(
      [
        "models:",
        "  chat:",
        "    glm: glm-from-config",
        "    openai: gpt-from-config",
        "    gemini: gemini-from-config",
        "    minimax: minimax-from-config",
      ].join("\n"),
    );
    expect(new GLMProvider()["defaultModel"]).toBe("glm-from-config");
    expect(new OpenAIProvider()["defaultModel"]).toBe("gpt-from-config");
    expect(new GeminiProvider()["defaultModel"]).toBe("gemini-from-config");
    expect(new MiniMaxProvider()["defaultModel"]).toBe("minimax-from-config");
  });

  it("precedence: a per-call override beats the env var, which beats the file", () => {
    overrideChat("models:\n  chat:\n    openai: gpt-from-file\n");
    expect(new OpenAIProvider()["defaultModel"]).toBe("gpt-from-file");
    process.env["OPENAI_MODEL"] = "gpt-from-env";
    expect(new OpenAIProvider()["defaultModel"]).toBe("gpt-from-env");
    expect(
      new OpenAIProvider({ defaultModel: "gpt-per-call" })["defaultModel"],
    ).toBe("gpt-per-call");
    delete process.env["OPENAI_MODEL"];
    // The other providers have no env knob — the file is their only dial.
    expect(new GeminiProvider()["defaultModel"]).toBe(
      defaultModel("chat", "gemini"),
    );
  });
});
