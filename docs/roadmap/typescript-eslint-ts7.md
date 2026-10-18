# typescript-eslint ↔ TypeScript 7

> Decision: **wait** for upstream to ship TS 7 support. Hard expiry: 2026-12-31.

## Why we're not on type-aware lint today

- The repo is on `typescript@^7.0.2` (Node 22+, all 24 packages compile under strict + noUncheckedIndexedAccess).
- `typescript-eslint@8.71.2` (latest) declares peer `typescript >=4.8.4 <6.1.0` — **TS 7 unsupported** as of writing.
- Tracking: <https://github.com/typescript-eslint/typescript-eslint/issues/10940>. No 9.x release, no published ETA.
- `eslint.config.mjs` runs on `@eslint/js` recommended only. Lint covers JS mistakes; the failure classes the render pipeline is most exposed to (floating promise, misused-promise) are **not** caught — tsc's strict mode catches the type-shape ones, and the recent renderer hardening (typed pipeline + paired await) closes the common cases.

## Trigger to enable

Any of:

- `typescript-eslint@9.x` is published **and** its release notes / peer deps list `typescript: ^7.0.0` (or unconstrained upper bound that accepts 7).
- A community-blessed workaround ships (e.g. a plugin that adapts the v8 parser to TS 7) — adopt only after the maintainer marks it stable.

## Action on trigger

1. Bump `typescript-eslint` in root devDeps to the 9.x version; `pnpm install`.
2. Replace the comment block in `eslint.config.mjs` with a real `typescript-eslint` import and a `recommendedTypeChecked` block (or `stylisticTypeChecked` if we want formatting).
3. Start with the three highest-value rules turned to `error`, the rest as `warn`:
   - `@typescript-eslint/no-floating-promises` — render pipeline
   - `@typescript-eslint/no-misused-promises` — same
   - `@typescript-eslint/consistent-type-imports` — mechanical
4. `pnpm run lint` (or `pnpm vitest run` for the parser warmup). Count violations; fix the cheap ones, `// eslint-disable-next-line` the rest with a 90-day removal comment.
5. Wire a `parser: typescript-eslint-parser` + `project: ['./packages/*/tsconfig.json']` so type-aware checks use the actual project graph (not a synthesized one).

## Action on expiry (2026-12-31)

Re-evaluate in light of upstream progress:

- **Released TS 7 support** → enable per "Action on trigger".
- **No progress, no clear ETA** → switch to plan A from the 2026-10-18 design discussion: pin `typescript@~5.9` as a devDep, run `typescript-eslint` against the 5.9 type service. Two TS versions coexist (build 7, lint 5.9) — accepted, document, move on.
- **Pin path also blocked** (peer dep gap widens) → downgrade the repo to `typescript@~5.9` and accept losing TS 7. Last resort; revisit quarterly.

## Non-goals while waiting

- Do not relax `strict: true`, `noUncheckedIndexedAccess: true`, or other `tsconfig.base.json` flags. tsc still does the heavy lifting.
- Do not introduce a community fork of `typescript-eslint` just to bypass the peer dep — too much maintenance risk for the marginal gain before 9.x lands.
- Do not delete `eslint.config.mjs` or stop running lint; the JS rules still catch real mistakes.
