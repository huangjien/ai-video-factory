// Build the publishable single-file CLI.
//
// The workspace ships 28 packages; a registry install should need ONE
// name. This bundles every @video/* package into one ESM file, keeps
// the third-party dependencies external (they are public npm packages
// and get installed normally), and vendors the two files the render
// path needs on disk: the Remotion Root component and the workspace
// packages that Root imports.
//
// Output: packages/cli/dist-bundle/
//   cli.js            — the bundle (the published `video` bin)
//   cli.js.map        — source map
//   vendor/Root.js    — the Remotion Root the render entry imports
//   vendor/node_modules/@video/…  — what Root.js imports at runtime
//   package.json      — the published manifest
//
// Usage: node scripts/build-bundle.mjs
import { build } from "esbuild";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliDir = path.join(repoRoot, "packages", "cli");
const outDir = path.join(cliDir, "dist-bundle");
const workspacePkgsDir = path.join(repoRoot, "packages");

/** The workspace packages the published bundle must vendor on disk: the
 *  Remotion Root imports @video/video-components, which imports
 *  @video/theme. Everything else the bundle inlines. */
const VENDOR_PACKAGES = ["@video/video-components", "@video/theme"];

/** Third-party packages stay external: they are public npm packages and
 *  npm installs them for the user. */
function readManifest(dir) {
  return JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
}

const cliManifest = readManifest(cliDir);
const workspaceManifests = new Map();
for (const entry of readdirSync(workspacePkgsDir)) {
  const manifestPath = path.join(workspacePkgsDir, entry, "package.json");
  if (!existsSync(manifestPath)) continue;
  const manifest = readManifest(path.join(workspacePkgsDir, entry));
  workspaceManifests.set(manifest.name, { dir: path.join(workspacePkgsDir, entry), manifest });
}

/** The third-party dependency union of the whole closure — what the
 *  published manifest must declare, since the @video/* packages are
 *  inlined and their external deps are no longer visible to npm. */
function thirdPartyClosure(startName) {
  const third = new Map();
  const seen = new Set();
  const stack = [startName];
  while (stack.length > 0) {
    const name = stack.pop();
    if (seen.has(name)) continue;
    seen.add(name);
    const entry = workspaceManifests.get(name);
    if (entry === undefined) continue;
    for (const [dep, range] of Object.entries(entry.manifest.dependencies ?? {})) {
      if (dep.startsWith("@video/")) stack.push(dep);
      else if (!third.has(dep)) third.set(dep, range);
    }
  }
  return { third, workspaceCount: seen.size };
}

const { third, workspaceCount } = thirdPartyClosure("@video/cli");

/** Copy a package's built dist into the vendor tree — WITHOUT its test
 *  files (the published tarball must not carry compiled tests). */
function vendorPackage(name) {
  const entry = workspaceManifests.get(name);
  if (entry === undefined) throw new Error(`unknown workspace package: ${name}`);
  const dest = path.join(outDir, "vendor", "node_modules", ...name.split("/"));
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  const srcDist = path.join(entry.dir, "dist");
  if (!existsSync(srcDist)) throw new Error(`${name} has no dist — run pnpm run build first`);
  cpSync(srcDist, path.join(dest, "dist"), {
    recursive: true,
    filter: (src) => !/\.test\.(js|js\.map|d\.ts|d\.ts\.map)$/.test(src),
  });
  writeFileSync(
    path.join(dest, "package.json"),
    `${JSON.stringify(
      {
        name,
        version: entry.manifest.version,
        type: "module",
        main: "dist/index.js",
        types: "dist/index.d.ts",
        exports: entry.manifest.exports ?? { ".": { default: "./dist/index.js" } },
        license: entry.manifest.license ?? "Apache-2.0",
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

// ── the bundle ────────────────────────────────────────────────────────────
const result = await build({
  entryPoints: [path.join(cliDir, "src", "index.ts")],
  outfile: path.join(outDir, "cli.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: true,
  logLevel: "warning",
  // Every @video/* package is INLINED (that is the point); every other
  // bare import stays external and is declared in the published manifest.
  plugins: [
    {
      name: "external-third-party",
      setup(buildApi) {
        buildApi.onResolve({ filter: /^[^./]/ }, (args) => {
          if (args.path.startsWith("@video/")) return undefined;
          return { path: args.path, external: true };
        });
      },
    },
  ],
});
if (result.errors.length > 0) {
  console.error(result.errors);
  process.exit(1);
}

// ── the vendored render-path files ────────────────────────────────────────
const rootSrc = path.join(workspacePkgsDir, "video-renderer", "dist", "Root.js");
if (!existsSync(rootSrc)) throw new Error("video-renderer/dist/Root.js missing — run pnpm run build");
mkdirSync(path.join(outDir, "vendor"), { recursive: true });
cpSync(rootSrc, path.join(outDir, "vendor", "Root.js"));
for (const name of VENDOR_PACKAGES) vendorPackage(name);

// ── the runtime assets the inlined packages read from disk ────────────────
// The bundle inlines @video/prompts, @video/media-generators and @video/tts,
// and those packages read .md prompts, python helpers and eval fixtures
// from their own directory at runtime. The published package ships them
// beside the bundle; each package's resolver probes both layouts.
mkdirSync(path.join(outDir, "prompts"), { recursive: true });
cpSync(
  path.join(workspacePkgsDir, "prompts", "prompts"),
  path.join(outDir, "prompts"),
  { recursive: true },
);
for (const [pkg, dest] of [
  ["media-generators", "media-generators"],
  ["tts", "tts"],
]) {
  const src = path.join(workspacePkgsDir, pkg, "python");
  if (!existsSync(src)) continue;
  const to = path.join(outDir, "assets", dest, "python");
  rmSync(to, { recursive: true, force: true });
  mkdirSync(to, { recursive: true });
  cpSync(src, to, {
    recursive: true,
    filter: (p) => !/__pycache__|\.pyc$|test_/.test(p),
  });
}
// The model ids and provider roles. `defaultModel()` in @video/llm has no
// built-in copy — without this file no provider could name its model.
mkdirSync(path.join(outDir, "assets", "config"), { recursive: true });
cpSync(
  path.join(repoRoot, "config", "llm.yaml"),
  path.join(outDir, "assets", "config", "llm.yaml"),
);
// The python helpers the pipeline shells out to (text overlay, thumbnail
// branding, bilibili upload, channel analytics). The make pipeline
// probes both `<cwd>/scripts/` and `assets/scripts/` beside the bundle.
const RUNTIME_SCRIPTS = [
  "pillow-text-overlay.py",
  "thumbnail-brand.py",
  "bilibili-upload.py",
  "channel-analytics.py",
];
mkdirSync(path.join(outDir, "assets", "scripts"), { recursive: true });
for (const name of RUNTIME_SCRIPTS) {
  const src = path.join(repoRoot, "scripts", name);
  if (!existsSync(src)) continue;
  cpSync(src, path.join(outDir, "assets", "scripts", name));
}

// The decision-eval fixtures travel too (same dual-layout resolver).
const decisionsSrc = path.join(workspacePkgsDir, "prompts", "decisions");
if (existsSync(decisionsSrc)) {
  cpSync(decisionsSrc, path.join(outDir, "decisions"), { recursive: true });
}

// The golden-set fixtures travel with the package so `video prompts eval`
// works for an installed user too.
cpSync(
  path.join(workspacePkgsDir, "prompts", "evals"),
  path.join(outDir, "evals"),
  { recursive: true },
);

// ── the published manifest ────────────────────────────────────────────────
const published = {
  name: cliManifest.name,
  version: cliManifest.version,
  description:
    "AI Video Factory — a pnpm TypeScript pipeline that turns a topic into a finished 1080p MP4 (Chinese or English).",
  license: "Apache-2.0",
  type: "module",
  bin: { video: "cli.js" },
  engines: cliManifest.engines ?? { node: ">=22" },
  dependencies: Object.fromEntries([...third.entries()].sort()),
  files: ["cli.js", "cli.js.map", "vendor", "prompts", "assets", "evals"],
  keywords: ["video", "ai", "llm", "pipeline", "youtube", "shorts", "chinese"],
  repository: { type: "git", url: "git+https://github.com/huangjien/ai-video-factory.git" },
  homepage: "https://github.com/huangjien/ai-video-factory#readme",
  publishConfig: { access: "public" },
};
writeFileSync(
  path.join(outDir, "package.json"),
  `${JSON.stringify(published, null, 2)}\n`,
  "utf8",
);

const bundleBytes = statSync(path.join(outDir, "cli.js")).size;
console.log(`bundled ${workspaceCount} workspace packages → ${outDir}`);
console.log(`  cli.js            ${(bundleBytes / 1024).toFixed(0)} kB`);
console.log(`  externals         ${[...third.keys()].join(", ")}`);
console.log(`  vendored on disk  ${["vendor/Root.js", ...VENDOR_PACKAGES].join(", ")}`);
console.log(`publish with: cd packages/cli/dist-bundle && npm publish --access public`);
