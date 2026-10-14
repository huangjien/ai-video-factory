import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ImageGenerationError,
  type ImageProvider,
  type ImageRequest,
  type ImageResult,
} from "./image.js";

/**
 * Local FLUX.2 Klein 4B image provider — doc §59/v0.5 (Local Image
 * Generation). Unlike the MiniMax HTTP providers, the model runs
 * in-process on this machine via a Python sidecar (`../python/
 * flux_worker.py`, diffusers + pillow + LoRA), so images cost no quota
 * and no network round-trip. The sidecar speaks one JSON object per
 * line on stdio and keeps the pipeline warm across the whole render,
 * because model load dominates per-image cost on Apple Silicon.
 */
export interface FluxKleinImageProviderOptions {
  /** HF repo id or local path (default black-forest-labs/FLUX.2-klein-4B). */
  model?: string | undefined;
  /** Denoising steps (worker default: 8 distilled / 50 base). */
  steps?: number | undefined;
  /** CFG guidance (ignored by distilled klein variants). */
  guidance?: number | undefined;
  /** Fixed seed for reproducibility (default: random per image). */
  seed?: number | undefined;
  device?: "auto" | "mps" | "cpu" | undefined;
  dtype?: "bfloat16" | "float16" | "float32" | undefined;
  /**
   * LoRA adapters applied at worker startup: `"path[:scale][,path2[:scale2]]"`.
   * Entries may be local .safetensors files, directories, or HF repo ids.
   */
  lora?: string | undefined;
  /**
   * Absolute path to a lora-config.yaml (see ./lora-config.ts). When set,
   * the worker reads it and resolves each `source` relative to its
   * directory. Overrides the legacy `lora` string option.
   */
  loraConfigPath?: string | undefined;
  /** HF cache root (default `<repo>/models/hf`, gitignored). */
  hfHome?: string | undefined;
  /** Command that runs the worker (default `uv run python flux_worker.py`). */
  pythonBin?: string | undefined;
  pythonArgs?: string[] | undefined;
  /** Serve deterministic mock images without loading the model (tests). */
  selftest?: boolean | undefined;
  /** Grace for cold start (model load). Default 20 min. */
  readyTimeoutMs?: number | undefined;
  /** Per-image budget. Default 10 min. */
  jobTimeoutMs?: number | undefined;
}

interface WorkerResponse {
  id: number;
  ok: boolean;
  file?: string;
  error?: string;
}

interface PendingJob {
  resolve: (resp: WorkerResponse & { ok: true; file: string }) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const READY_TIMEOUT_MS = 20 * 60 * 1000;
const JOB_TIMEOUT_MS = 10 * 60 * 1000;

/** packages/media-generators/{dist|src} → ../python (same either way). */
function resolvePythonDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..", "python");
}

function resolveRepoRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..", "..", "..");
}

/**
 * Spawns `flux_worker.py` once and pipelines every generate() call
 * through its warm JSONL protocol. A crashed worker rejects in-flight
 * jobs with its stderr tail and is restarted on the next call.
 */
export class FluxKleinImageProvider implements ImageProvider {
  readonly name = "flux-klein";

  private readonly opts: FluxKleinImageProviderOptions;
  private readonly stderrTail: string[] = [];
  private workerPromise: Promise<ChildProcess> | null = null;
  private pending = new Map<number, PendingJob>();
  private nextId = 0;

  constructor(opts: FluxKleinImageProviderOptions = {}) {
    this.opts = opts;
  }

  async generate(req: ImageRequest): Promise<ImageResult> {
    if (!req.prompt || req.prompt.trim().length === 0) {
      throw new ImageGenerationError(
        "prompt must be a non-empty string",
        this.name,
      );
    }
    const worker = await this.ensureWorker();
    const id = ++this.nextId;
    const timeoutMs = this.opts.jobTimeoutMs ?? JOB_TIMEOUT_MS;
    const job = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new ImageGenerationError(
            `job ${id} timed out after ${timeoutMs} ms`,
            this.name,
          ),
        );
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (resp) => {
          clearTimeout(timer);
          resolve(resp.file);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
        timer,
      });
    });
    worker.stdin?.write(
      JSON.stringify({
        id,
        prompt: req.prompt,
        width: req.width,
        height: req.height,
        steps: this.opts.steps,
        guidance: this.opts.guidance,
        seed: this.opts.seed,
        format: "jpg",
        ...(req.referenceImage ? { referenceImage: req.referenceImage } : {}),
      }) + "\n",
    );
    try {
      const file = await job;
      const buf = await readFile(file);
      await rm(file, { force: true });
      return { bytes: Uint8Array.from(buf), contentType: "image/jpeg" };
    } catch (err) {
      if (err instanceof ImageGenerationError) throw err;
      throw new ImageGenerationError(
        (err as Error).message,
        this.name,
      );
    }
  }

  /** Kill the worker and drop its temp dir. Safe to call twice. */
  dispose(): void {
    this.workerPromise?.then(
      (proc) => {
        proc.stdin?.end();
        proc.kill("SIGTERM");
      },
      () => undefined,
    );
    this.workerPromise = null;
  }

  private ensureWorker(): Promise<ChildProcess> {
    this.workerPromise ??= this.spawnWorker();
    return this.workerPromise;
  }

  private async spawnWorker(): Promise<ChildProcess> {
    const pythonDir = resolvePythonDir();
    if (!existsSync(path.join(pythonDir, "flux_worker.py"))) {
      throw new ImageGenerationError(
        `python sidecar not found at ${pythonDir} — run the setup in packages/media-generators/python/README.md`,
        this.name,
      );
    }
    const outDir = await mkdtemp(path.join(tmpdir(), "flux-klein-"));

    const bin = this.opts.pythonBin ?? "uv";
    const args = [
      ...(this.opts.pythonArgs ?? ["run", "python", "flux_worker.py"]),
      "--out-dir",
      outDir,
      ...(this.opts.selftest ? ["--selftest"] : []),
    ];
    const env: NodeJS.ProcessEnv = { ...process.env };
    const setEnv = (key: string, value: string | undefined) => {
      if (value !== undefined) env[key] = value;
    };
    setEnv("FLUX2_MODEL", this.opts.model);
    setEnv("FLUX2_STEPS", this.opts.steps?.toString());
    setEnv("FLUX2_GUIDANCE", this.opts.guidance?.toString());
    setEnv("FLUX2_DEVICE", this.opts.device);
    setEnv("FLUX2_DTYPE", this.opts.dtype);
    setEnv("FLUX2_LORA", this.opts.lora);
    setEnv("FLUX2_LORA_CONFIG", this.opts.loraConfigPath);
    setEnv("FLUX2_HF_HOME", this.opts.hfHome ?? path.join(resolveRepoRoot(), "models", "hf"));

    const proc = spawn(bin, args, {
      cwd: pythonDir,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const fail = (message: string) =>
      new ImageGenerationError(
        `${message}${this.stderrTail.length > 0 ? ` — last log: ${this.stderrTail.join(" | ").slice(-300)}` : ""}`,
        this.name,
      );

    const ready = new Promise<ChildProcess>((resolve, reject) => {
      const readyTimer = setTimeout(
        () =>
          reject(
            fail(
              `worker not ready after ${this.opts.readyTimeoutMs ?? READY_TIMEOUT_MS} ms (cold start? first run downloads ~16 GB of weights)`,
            ),
          ),
        this.opts.readyTimeoutMs ?? READY_TIMEOUT_MS,
      );
      const settleReady = (proc2: ChildProcess) => {
        clearTimeout(readyTimer);
        resolve(proc2);
      };
      const onExit = (code: number | null) => {
        clearTimeout(readyTimer);
        this.workerPromise = null;
        const err = fail(`worker exited before becoming ready (code ${code})`);
        for (const job of this.pending.values()) job.reject(err);
        this.pending.clear();
        reject(err);
      };
      proc.once("exit", onExit);

      const rl = createInterface({ input: proc.stdout! });
      rl.on("line", (line) => {
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(line) as Record<string, unknown>;
        } catch {
          return; // tolerate stray output on stdout
        }
        if (msg["event"] === "ready") {
          proc.off("exit", onExit);
          proc.once("exit", (code) => this.onWorkerExit(code));
          settleReady(proc);
          return;
        }
        const id = typeof msg["id"] === "number" ? msg["id"] : undefined;
        if (id === undefined) return;
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id);
        if (msg["ok"] === true && typeof msg["file"] === "string") {
          pending.resolve(
            msg as unknown as WorkerResponse & { ok: true; file: string },
          );
        } else {
          pending.reject(
            new ImageGenerationError(
              String(msg["error"] ?? "worker returned no image"),
              this.name,
            ),
          );
        }
      });
    });

    proc.stderr?.on("data", (chunk: Buffer) => {
      const lines = chunk.toString("utf8").split("\n").filter(Boolean);
      for (const line of lines) {
        this.stderrTail.push(line);
        if (this.stderrTail.length > 15) this.stderrTail.shift();
      }
    });
    proc.stdin?.on("error", () => {
      /* EPIPE handled via worker exit */
    });
    process.once("exit", () => {
      proc.kill("SIGTERM");
    });

    try {
      return await ready;
    } catch (err) {
      proc.kill("SIGKILL");
      await rm(outDir, { recursive: true, force: true }).catch(() => undefined);
      throw err;
    }
  }

  private onWorkerExit(code: number | null): void {
    this.workerPromise = null;
    const err = new ImageGenerationError(
      `worker exited unexpectedly (code ${code})${this.stderrTail.length > 0 ? ` — last log: ${this.stderrTail.join(" | ").slice(-300)}` : ""}`,
      this.name,
    );
    for (const job of this.pending.values()) job.reject(err);
    this.pending.clear();
  }
}
