# Effort tiers

"Effort" has two parts. The **tier** is what the packet tells the agent to do before it
reports done: how much to read, how much to verify, how much to write back. The
**reasoning effort** is the model's own thinking budget, set in the custom agent
definitions under `.claude/agents/` (frontmatter `effort:`); the Agent tool has no
per-call effort knob, so the tier picks the agent type:

| Tier | Agent type (`subagent_type`) | Model | Reasoning effort |
|---|---|---|---|
| high | `implementer-opus-high` | Opus | high |
| medium | `implementer-opus` | Opus | medium |
| low, judgement or UI involved | `implementer-opus` | Opus | medium |
| low or medium, mechanical and fully specified (`references/model-routing.md`) | `implementer-sonnet` | Sonnet | medium |

If a session does not list these agent types (the definitions live in `.claude/agents/`
and load at session start), fall back to `subagent_type: "general-purpose"` with
`model: "opus"` or `model: "sonnet"`; reasoning effort then follows the user's model
settings and you lose the high tier's extra thinking, so say so in the orchestration log.

Pick the tier per unit and write the one-line reason in the plan. When in doubt, go
one tier up: an over-worked unit costs tokens, an under-worked unit costs a review cycle.
The tier never decides the model — routing does. A high-tier unit is always Opus; a
low-tier unit is Opus unless it passes every Sonnet-eligibility rule.

## Choosing

| Tier | Use when | Typical units |
|---|---|---|
| **low** | Mechanical, one file or one pattern, an exact analog exists to copy | README update, adding keywords or radio lines given verbatim, adding a token and using it, renaming |
| **medium** | Several files in one area, some judgement, but no sim math, parser matching, audio or worker logic | Timing tower, radio log, debrief screen, start screen, a store slice, radio content tables + `classify` situations |
| **high** | Any of: sim step logic, RNG threading or anything that could break determinism, tyre/fuel/pit/mode/event math, parser matching rules, audio capture/resampling, the Whisper worker (loading, device fallback, protocol), the rAF fixed-step loop, canvas interpolation | `step()`, seeded events, pit stops, parser + its fuzzy matching, `recorder.ts`, `whisper.worker.ts`, game loop |

Fixers inherit the tier of the most severe finding they are fixing: a correctness or
determinism finding makes the fixer high even if the unit was medium.

## What each tier says in the packet

Paste the matching block into the packet's `## Effort` section.

### low

```
## Effort: low
- Mirror the analog file(s) named above exactly; do not explore beyond the listed files
  and the rules docs.
- Run `pnpm lint` and `pnpm typecheck` before reporting.
- Report in under 10 lines: files changed, one line per decision, anything unsure.
```

### medium

```
## Effort: medium
- Read the analog end to end (contract types → sim/content/voice → store → component)
  before writing anything, and the rules docs and boxbox-* skill named above.
- Before coding, list the edge cases you will handle (race not started, final lap, safety
  car, mic denied, model loading/error, keyboard fallback) in your notes; handle all of them.
- After coding, re-read your own diff once against build-feature
  references/review-checklist.md §2, §3 or §4 (whichever is your area) and fix what you find.
- Run `pnpm lint`, `pnpm typecheck` and `pnpm test` before reporting.
- Report: files changed, decisions made with the reason, edge cases covered,
  anything you were unsure about (be honest — the orchestrator resolves these, and an
  unflagged guess is worse than a flagged one).
```

### high

```
## Effort: high
- Read the rules docs named above in full, then the analog feature end to end.
- Before coding, write down in your notes: the invariants this code must hold
  (same seed + same commands = identical race, input state never mutated, RNG draw order
  fixed, wear in 0–100, stable position sort, worker messages match protocol.ts), the edge
  cases, and the failure paths. Design the change against that list first.
- Sim/content stay pure: RNG passed in, no Math.random/Date/performance.now/DOM; tunables
  only from src/sim/constants.ts. Every behaviour change gets a Vitest case, and the
  determinism test still passes.
- After coding, review your own diff against build-feature references/review-checklist.md
  §2–§5 as if you were a hostile reviewer; fix what you find and list what you fixed.
- Run `pnpm lint`, `pnpm typecheck` and `pnpm test`, and paste the result.
- Report: files changed, invariants and how each is enforced, edge cases covered,
  what you self-reviewed and fixed, and anything you are unsure about. Do not smooth
  over uncertainty.
```
