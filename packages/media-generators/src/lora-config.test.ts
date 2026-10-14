import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  loadLoraConfig,
  LoraConfigError,
  resolveLoraConfigPath,
} from "./lora-config.js";

let root: string;
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "lora-config-test-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(rel: string, content: string): string {
  const full = path.join(root, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content);
  return full;
}

describe("loadLoraConfig", () => {
  it("returns an empty config when loras is absent", () => {
    const f = write("lora-config.yaml", "loras: null\n");
    const r = loadLoraConfig(f);
    expect(r.entries).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it("resolves relative source paths against the config file directory", () => {
    const f = write(
      "lora-config.yaml",
      "loras:\n  - source: ink-style.safetensors\n",
    );
    const r = loadLoraConfig(f);
    expect(r.entries).toEqual([
      {
        source: path.join(root, "ink-style.safetensors"),
        scale: 1.0,
      },
    ]);
  });

  it("reads scale, license sidecar, and surfaces sidecar content", () => {
    write("loras/ink-style.license.txt", "CC-BY-4.0 — drawn by @artist\n");
    const f = write(
      "lora-config.yaml",
      [
        "loras:",
        "  - source: loras/ink-style.safetensors",
        "    scale: 0.8",
        "    license: loras/ink-style.license.txt",
        "  - source: HF/repo-id",
        "",
      ].join("\n"),
    );
    const r = loadLoraConfig(f);
    expect(r.entries).toHaveLength(2);
    expect(r.entries[0]).toMatchObject({
      source: path.join(root, "loras", "ink-style.safetensors"),
      scale: 0.8,
      license: { text: "CC-BY-4.0 — drawn by @artist\n" },
    });
    expect(r.entries[1]).toEqual({ source: "HF/repo-id", scale: 1.0 });
    expect(r.warnings).toEqual([]);
  });

  it("warns when a local adapter has no license sidecar", () => {
    const f = write(
      "lora-config.yaml",
      "loras:\n  - source: orphan.safetensors\n",
    );
    const r = loadLoraConfig(f);
    expect(r.warnings.some((w) => w.includes("no license sidecar"))).toBe(true);
  });

  it("does not warn about license for HF repo ids", () => {
    const f = write(
      "lora-config.yaml",
      "loras:\n  - source: some-org/some-lora\n",
    );
    const r = loadLoraConfig(f);
    expect(r.warnings).toEqual([]);
  });

  it("throws when a license sidecar is missing", () => {
    const f = write(
      "lora-config.yaml",
      [
        "loras:",
        "  - source: loras/x.safetensors",
        "    license: loras/missing.license.txt",
        "",
      ].join("\n"),
    );
    expect(() => loadLoraConfig(f)).toThrow(LoraConfigError);
  });

  it("throws on malformed YAML with the file path in the message", () => {
    const f = write("lora-config.yaml", "loras: [\n");
    try {
      loadLoraConfig(f);
      expect.unreachable("expected LoraConfigError");
    } catch (err) {
      expect(err).toBeInstanceOf(LoraConfigError);
      expect((err as Error).message).toContain(f);
    }
  });

  it("rejects non-array loras and missing source", () => {
    const bad = write("lora-config.yaml", "loras: not-an-array\n");
    expect(() => loadLoraConfig(bad)).toThrow(LoraConfigError);
    const bad2 = write(
      "lora-config.yaml",
      "loras:\n  - scale: 0.5\n",
    );
    expect(() => loadLoraConfig(bad2)).toThrow(/source is required/);
  });
});

describe("resolveLoraConfigPath", () => {
  it("prefers envPath over providerPath and on-disk files", () => {
    const env = write("env.yaml", "loras: []\n");
    const prov = write("prov.yaml", "loras: []\n");
    const projectFile = write("project/lora-config.yaml", "loras: []\n");
    const got = resolveLoraConfigPath({
      envPath: env,
      providerPath: prov,
      projectRoot: path.join(root, "project"),
      repoRoot: path.join(root, "repo"),
    });
    expect(got).toBe(env);
    expect(got).not.toBe(projectFile);
  });

  it("falls back to providerPath when envPath does not exist", () => {
    const prov = write("prov.yaml", "loras: []\n");
    const got = resolveLoraConfigPath({
      envPath: path.join(root, "missing.yaml"),
      providerPath: prov,
      projectRoot: path.join(root, "project"),
      repoRoot: path.join(root, "repo"),
    });
    expect(got).toBe(prov);
  });

  it("falls back to <projectRoot>/lora-config.yaml then <repoRoot>", () => {
    const project = path.join(root, "project");
    const repo = path.join(root, "repo");
    const projectFile = write("project/lora-config.yaml", "loras: []\n");
    const got = resolveLoraConfigPath({
      projectRoot: project,
      repoRoot: repo,
    });
    expect(got).toBe(projectFile);
  });

  it("falls back to <repoRoot>/lora-config.yaml when project has none", () => {
    const repoFile = write("repo/lora-config.yaml", "loras: []\n");
    const got = resolveLoraConfigPath({
      projectRoot: path.join(root, "empty-project"),
      repoRoot: path.join(root, "repo"),
    });
    expect(got).toBe(repoFile);
  });

  it("returns undefined when no candidate exists", () => {
    expect(
      resolveLoraConfigPath({
        projectRoot: path.join(root, "p"),
        repoRoot: path.join(root, "r"),
      }),
    ).toBeUndefined();
  });
});
