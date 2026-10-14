import { execSync, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdirSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, afterEach, beforeAll, afterAll } from "vitest";
import { FluxKleinImageProvider } from "./flux-image.js";
import { ImageGenerationError } from "./image.js";

const hasUv = (() => {
  try {
    execSync("uv --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

const d = hasUv ? describe : describe.skip;

const pythonDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "python",
);

const selftestOpts = {
  selftest: true,
  readyTimeoutMs: 30_000,
  jobTimeoutMs: 30_000,
} as const;

d("FluxKleinImageProvider — JSONL protocol against the selftest worker", () => {
  it(
    "exposes name flux-klein",
    () => {
      expect(new FluxKleinImageProvider().name).toBe("flux-klein");
    },
    10_000,
  );

  it(
    "rejects an empty prompt without spawning a worker",
    async () => {
      const p = new FluxKleinImageProvider(selftestOpts);
      await expect(
        p.generate({ prompt: "   ", width: 96, height: 64 }),
      ).rejects.toMatchObject({
        name: "ImageGenerationError",
        provider: "flux-klein",
      });
    },
    10_000,
  );

  it(
    "generates a JPEG through the selftest worker",
    async () => {
      const p = new FluxKleinImageProvider(selftestOpts);
      try {
        const r = await p.generate({
          prompt: "gradient test",
          width: 96,
          height: 64,
        });
        expect(r.contentType).toBe("image/jpeg");
        expect(r.bytes.length).toBeGreaterThan(100);
        expect(r.bytes[0]).toBe(0xff);
        expect(r.bytes[1]).toBe(0xd8);
      } finally {
        p.dispose();
      }
    },
    90_000,
  );

  it(
    "is deterministic for the same prompt (selftest hash image)",
    async () => {
      const p = new FluxKleinImageProvider(selftestOpts);
      try {
        const a = await p.generate({
          prompt: "same prompt",
          width: 96,
          height: 64,
        });
        const b = await p.generate({
          prompt: "same prompt",
          width: 96,
          height: 64,
        });
        expect(Buffer.from(b.bytes).equals(Buffer.from(a.bytes))).toBe(true);
      } finally {
        p.dispose();
      }
    },
    90_000,
  );

  it(
    "surfaces worker job errors as ImageGenerationError",
    async () => {
      const p = new FluxKleinImageProvider(selftestOpts);
      try {
        await expect(
          p.generate({ prompt: "FAIL: boom", width: 96, height: 64 }),
        ).rejects.toMatchObject({
          name: "ImageGenerationError",
          provider: "flux-klein",
          message: expect.stringContaining("boom"),
        });
      } finally {
        p.dispose();
      }
    },
    90_000,
  );
});

describe("FluxKleinImageProvider — unit (no worker)", () => {
  it("rejects when the python sidecar is missing", async () => {
    const p = new FluxKleinImageProvider({
      pythonArgs: ["run", "python", "no-such-worker.py"],
      readyTimeoutMs: 10_000,
    });
    await expect(
      p.generate({ prompt: "x", width: 64, height: 64 }),
    ).rejects.toBeInstanceOf(ImageGenerationError);
  });

  it(
    "fails loud with a fix hint when the flux health check exits non-zero",
    async () => {
      // `false` (POSIX builtin) exits 1 on every arg, so --check fails
      // deterministically without depending on a specific path like
      // /bin/false (not present on macOS).
      const p = new FluxKleinImageProvider({
        pythonBin: "false",
        jobTimeoutMs: 10_000,
      });
      const err = await p
        .generate({ prompt: "x", width: 64, height: 64 })
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ImageGenerationError);
      const message = (err as Error).message;
      expect(message).toMatch(/flux service not ready/);
      expect(message).toMatch(/exited with code 1/);
      expect(message).toMatch(/uv sync/);
      expect(message).toMatch(/flux_worker\.py --check/);
    },
    15_000,
  );

  it(
    "fails loud with a fix hint when uv itself is missing",
    async () => {
      // Distinct from the above: spawnSync returns res.error (ENOENT)
      // rather than res.status !== 0. Verifies both arms of the
      // health check independently.
      const p = new FluxKleinImageProvider({
        pythonBin: "this-binary-does-not-exist-anywhere-12345",
        jobTimeoutMs: 10_000,
      });
      const err = await p
        .generate({ prompt: "x", width: 64, height: 64 })
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ImageGenerationError);
      const message = (err as Error).message;
      expect(message).toMatch(/flux service not ready/);
      expect(message).toMatch(/failed to spawn/);
    },
    15_000,
  );
});

describe("FluxKleinImageProvider — FLUX2_SKIP_HEALTH_CHECK=1 bypass", () => {
  // Scoped env var via beforeAll/afterAll so this test never races with
  // the health-check tests above (which assume the env var is unset).
  let prev: string | undefined;
  beforeAll(() => {
    prev = process.env["FLUX2_SKIP_HEALTH_CHECK"];
    process.env["FLUX2_SKIP_HEALTH_CHECK"] = "1";
  });
  afterAll(() => {
    if (prev === undefined) delete process.env["FLUX2_SKIP_HEALTH_CHECK"];
    else process.env["FLUX2_SKIP_HEALTH_CHECK"] = prev;
  });

  it(
    "bypasses the health check so a broken python env does not fail the pre-flight",
    async () => {
      // Contract: with the bypass, the failure must not be the
      // "flux service not ready" message that the health check
      // would have produced. Proves the bypass is honored even
      // when the env is broken.
      const p = new FluxKleinImageProvider({
        pythonBin: "this-binary-does-not-exist-anywhere-12345",
        jobTimeoutMs: 3_000,
      });
      const err = await p
        .generate({ prompt: "x", width: 64, height: 64 })
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ImageGenerationError);
      expect((err as Error).message).not.toMatch(/flux service not ready/);
    },
    10_000,
  );
});

d("FluxKleinImageProvider — lora-config.yaml end-to-end (selftest)", () => {
  const tempDirs: string[] = [];
  afterEach(() => {
    for (const d of tempDirs) rmSync(d, { recursive: true, force: true });
    tempDirs.length = 0;
  });

  const tempConfig = (yaml: string): string => {
    const dir = mkdtempSync(path.join(tmpdir(), "flux-lora-e2e-"));
    tempDirs.push(dir);
    const file = path.join(dir, "lora-config.yaml");
    writeFileSync(file, yaml);
    return file;
  };

  function spawnSelftestWithConfig(configPath: string): Promise<{
    ready: Record<string, unknown>;
    stderrTail: string;
  }> {
    return new Promise((resolve, reject) => {
      const proc = spawn(
        "uv",
        ["run", "python", "flux_worker.py", "--selftest", "--out-dir", path.join(tmpdir(), "flux-e2e-" + Math.random())],
        {
          cwd: pythonDir,
          env: { ...process.env, FLUX2_LORA_CONFIG: configPath },
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      const stderr: string[] = [];
      proc.stderr.on("data", (b: Buffer) => stderr.push(b.toString("utf8")));
      const rl = createInterface({ input: proc.stdout });
      const timer = setTimeout(() => {
        proc.kill("SIGKILL");
        reject(new Error("worker did not emit ready in 30s"));
      }, 30_000);
      rl.on("line", (line) => {
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(line);
        } catch {
          return;
        }
        if (msg["event"] === "ready") {
          clearTimeout(timer);
          proc.kill("SIGTERM");
          resolve({ ready: msg, stderrTail: stderr.join("") });
        }
      });
      proc.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  it("forwards lora-config.yaml entries into the ready event", async () => {
    const cfg = tempConfig(
      [
        "loras:",
        "  - source: loras/ink-style.safetensors",
        "    scale: 0.7",
        "  - source: org/some-lora",
        "",
      ].join("\n"),
    );
    const { ready } = await spawnSelftestWithConfig(cfg);
    expect(ready["lora"]).toEqual([
      expect.stringMatching(/loras[\\/]ink-style\.safetensors:0\.7/),
      "org/some-lora:1",
    ]);
  }, 60_000);

  it("reads scale and licence sidecar and propagates the resolved absolute path", async () => {
    const dir = tempDirs.length === 0 ? mkdtempSync(path.join(tmpdir(), "flux-lora-lic-")) : tempDirs[0]!;
    tempDirs.push(dir);
    mkdirSync(path.join(dir, "loras"), { recursive: true });
    writeFileSync(
      path.join(dir, "loras", "ink.license.txt"),
      "Apache-2.0 — my own work",
    );
    const cfg = path.join(dir, "lora-config.yaml");
    writeFileSync(
      cfg,
      [
        "loras:",
        "  - source: loras/ink.safetensors",
        "    scale: 0.4",
        "    license: loras/ink.license.txt",
        "",
      ].join("\n"),
    );
    const { ready } = await spawnSelftestWithConfig(cfg);
    const list = ready["lora"] as string[];
    expect(list).toHaveLength(1);
    expect(list[0]).toMatch(/loras[\\/]ink\.safetensors:0\.4/);
  }, 60_000);
});

d("referenceImage — image-to-image protocol field (selftest)", () => {
  const tempDirs: string[] = [];
  afterEach(() => {
    for (const d of tempDirs) rmSync(d, { recursive: true, force: true });
    tempDirs.length = 0;
  });

  function spawnSelftestSendOne(job: object): Promise<{
    ready: Record<string, unknown>;
    response: Record<string, unknown>;
    stderr: string;
  }> {
    return new Promise((resolve, reject) => {
      const proc = spawn(
        "uv",
        ["run", "python", "flux_worker.py", "--selftest", "--out-dir", path.join(tmpdir(), "flux-ref-" + Math.random())],
        { cwd: pythonDir, stdio: ["pipe", "pipe", "pipe"] },
      );
      const stderr: string[] = [];
      proc.stderr.on("data", (b: Buffer) => stderr.push(b.toString("utf8")));
      const rl = createInterface({ input: proc.stdout });
      let ready: Record<string, unknown> | null = null;
      const timer = setTimeout(() => {
        proc.kill("SIGKILL");
        reject(new Error("worker did not respond in 30s"));
      }, 30_000);
      rl.on("line", (line) => {
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(line);
        } catch {
          return;
        }
        if (msg["event"] === "ready" && ready === null) {
          ready = msg;
          proc.stdin?.write(JSON.stringify(job) + "\n");
          return;
        }
        if (ready !== null && typeof msg["id"] === "number") {
          clearTimeout(timer);
          proc.stdin?.end();
          proc.kill("SIGTERM");
          resolve({ ready, response: msg, stderr: stderr.join("") });
        }
      });
      proc.on("error", reject);
    });
  }

  it("accepts a readable reference image and returns a JPEG", async () => {
    // Spawn Python to write a valid PNG (no PNG encoder in this test file).
    const { writeFileSync, mkdirSync } = await import("node:fs");
    const dir = mkdtempSync(path.join(tmpdir(), "flux-ref-img-"));
    tempDirs.push(dir);
    const refPath = path.join(dir, "ref.png");
    execSync(
      `uv run --no-sync python -c "from PIL import Image; Image.new('RGB',(32,32),(120,180,90)).save('${refPath}','PNG')"`,
      { cwd: pythonDir, stdio: "ignore" },
    );
    const r = await spawnSelftestSendOne({
      id: 1,
      prompt: "reference test",
      width: 96,
      height: 64,
      steps: 4,
      seed: 7,
      referenceImage: refPath,
    });
    expect(r.response["ok"]).toBe(true);
    expect(typeof r.response["file"]).toBe("string");
    const { readFileSync } = await import("node:fs");
    const buf = readFileSync(r.response["file"] as string);
    expect(buf[0]).toBe(0xff);
    expect(buf[1]).toBe(0xd8);
  }, 90_000);

  it("rejects with ImageGenerationError when the reference file is unreadable", async () => {
    const r = await spawnSelftestSendOne({
      id: 2,
      prompt: "missing ref",
      width: 64,
      height: 64,
      steps: 4,
      seed: 7,
      referenceImage: "/definitely/does/not/exist.png",
    });
    expect(r.response["ok"]).toBe(false);
    expect(typeof r.response["error"]).toBe("string");
  }, 60_000);
});

d("--check-model — verifies the worker picks the right defaults from a checkpoint's model_index.json (no safetensors)", () => {
  function runCheckModel(repoId: string): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const proc = spawn(
        "uv",
        ["run", "python", "flux_worker.py", "--check-model", repoId],
        { cwd: pythonDir, stdio: ["ignore", "pipe", "pipe"] },
      );
      const out: Buffer[] = [];
      proc.stdout.on("data", (b: Buffer) => out.push(b));
      const timer = setTimeout(() => {
        proc.kill("SIGKILL");
        reject(new Error(`--check-model ${repoId} timed out`));
      }, 30_000);
      proc.on("close", () => {
        clearTimeout(timer);
        const text = Buffer.concat(out).toString("utf8");
        const start = text.indexOf("{");
        const end = text.lastIndexOf("}");
        if (start < 0 || end < 0) {
          reject(new Error(`no JSON in --check-model output:\n${text}`));
          return;
        }
        try {
          resolve(JSON.parse(text.slice(start, end + 1)));
        } catch (err) {
          reject(err);
        }
      });
      proc.on("error", reject);
    });
  }

  it("reports distilled=true + 8 steps for the 4B distilled variant", async () => {
    const out = await runCheckModel("black-forest-labs/FLUX.2-klein-4B");
    expect(out["is_distilled"]).toBe(true);
    expect(out["default_steps_with_worker"]).toBe(8);
    expect(out["guidance_honored"]).toBe(false);
  }, 60_000);

  it("reports distilled=false + 50 steps + guidance honored for the base 4B", async () => {
    const out = await runCheckModel("black-forest-labs/FLUX.2-klein-base-4B");
    expect(out["is_distilled"]).toBe(false);
    expect(out["default_steps_with_worker"]).toBe(50);
    expect(out["guidance_honored"]).toBe(true);
  }, 60_000);
});
