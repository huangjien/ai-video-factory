# Backlog judge cache redesign (2026-11-21)

## Problem

`backlog judge` writes one cache per input hash, while `backlog auto` scans those files by modification time and accepts the newest parseable ranking. The auto path does not verify that the ranking represents the current backlog. The judge cache key also omits prompt inputs such as notes and anchors. Repeated runs therefore accumulate artifacts and can select a stale ranking.

## Decision

Use one rolling artifact: `runs/backlog-judge.yaml`. Both `judge` and `auto` use the same fingerprint calculation, cache reader, and validation rules. Each judge attempt replaces the artifact with the latest result; it does not keep per-hash history.

The fingerprint covers every input that can affect the prompt or ranking: open entry IDs, topics, notes and anchors; the latest analytics report content; already-produced stories; configured provider/model; and a judge prompt/schema version. Canonical serialization makes the fingerprint deterministic. `content` remains excluded because it is not sent to the judge.

The cache record stores the fingerprint, provider/model, timestamp, and a complete ranking. A valid ranking must cover the current open-entry IDs exactly once and use unique contiguous ranks. Missing, stale, malformed, or incomplete records are cache misses.

`backlog auto` uses a matching valid record. On a miss, it runs `backlog judge`, then reloads and validates the single snapshot against the current inputs. If judging fails or the backlog changes while judging, auto stops without selecting an idea.

The same file holds the latest failure diagnostic (error and, for malformed model output, its raw reply) when a judge attempt fails. It contains no usable ranking in that state, so a prior ranking cannot survive a failed refresh. Writes use a temporary sibling plus atomic rename; only one persistent judge artifact remains.

On adoption, remove legacy `runs/backlog-judge-<64-hex>.yaml` cache files and `runs/backlog-judge-<64-hex>-failed.yaml` dumps. Future runs only read/write `runs/backlog-judge.yaml`.

## Scope

- Add a shared cache/fingerprint module used by `backlog-score.ts` and `backlog-auto.ts`.
- Replace hash-named successful and failed files with the one rolling snapshot.
- Make `auto` reject stale snapshots, invoke judge on misses, and validate again after judge completes.
- Update `backlog status` to report the latest failure from the snapshot.
- Update CLI descriptions and backlog design docs to describe the rolling cache.
- Preserve per-run auto records; they are execution history, not judge cache artifacts.

## Failure behavior

- Provider failure, malformed ranking, stale snapshot, and concurrent backlog changes never fall back to an older ranking.
- A failed attempt replaces the current snapshot with a failure record; the next auto attempt can judge again.
- Atomic replacement prevents readers from seeing a partially written YAML file.

## Verification

Exercise cache hit/miss, fingerprint invalidation for every prompt input, ranking coverage validation, judge failure, and auto re-judge behavior. Run the CLI build and the focused backlog judge/auto/status tests.
