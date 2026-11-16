*Status:** Planned

# v0.12 — Decision surfaces (the OpenAI Decisions API, everywhere it fits)

**Date:** 2026-11-16
**Design + plan:** [`v0.12-decision-surfaces-plan.md`](./v0.12-decision-surfaces-plan.md)
**Builds on:** `docs/v0.11-decision-provider-plan.md` (the layer's design, contract, bench and
safety rules — unchanged by this milestone)

> **Implementation is complete (2026-11-16); the release is not.** Every item in the plan was
> built and measured against the live API — see §13 of the plan for the numbers. The marker
> stays **Planned** until the git tag and the GitHub Release exist
> (`docs/CONTRIBUTING.md` § Release process), because `Complete` means "shipped".

## One-line scope

Close the gap between the decision layer's **contract** (which supports `choice` / `score` /
`noul`) and its **wiring** (2 of 7 registered surfaces), by wiring the two surfaces that are
already prepared and adding the three new surfaces the code audit found — every one of them in
`shadow` until its corpus clears the accuracy gate.

## Why this milestone exists

The v0.11 plan listed four candidate surfaces (D1–D4). Two shipped, one was retired by
measurement, one was cancelled by measurement. A fresh read of the whole codebase
(2026-11-16) found **four more** places whose shape matches the Decisions API, plus **two
measurement gaps** the v0.11 plan left open (T7). This milestone works that list down.

## Deliverables

| # | Deliverable | Ships as | State |
|---|---|---|---|
| P0 | Prices filled + the bench's cost axis live + the 0.924/0.930 number fixed | measurement | **done 2026-11-16** |
| P1 | `motion-prescreen` (D1) wired in `shadow` | shadow surface | **done 2026-11-16** — measured 0.511, **retired** (not wired, not gated) |
| P2 | `caption-overlap` wired in `shadow` | shadow surface | **done 2026-11-16** — measured 1.000 |
| P3 | Image-brief expansion skip (new surface) | shadow surface | **CANCELLED 2026-11-16** — measured: no corpus exists |
| P4 | Prompt-eval rubric judge → a `score` decision | shadow surface | **done 2026-11-16** — a measurement beside the judge |
| P5 | `video review` verdict shadow (new surface) | shadow surface | **done 2026-11-16** — measured 1.000 |
| P6 | Article-judge dimension score | measured, then decided | **MEASURED 2026-11-16** — error 0.366, not built |

## Ship rule

Per `docs/CONTRIBUTING.md` § Release process — a minor bump ships only after the git tag **and**
the GitHub Release exist. No surface in this milestone is allowed to **act** before its own
corpus clears the gate; "wired" always means "consulted and recorded", never "gates the pipeline".
