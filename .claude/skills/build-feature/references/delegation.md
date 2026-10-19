# Delegation — the unit packet and the parallel-safety rule

This file holds the two things both skills share: what a unit packet must contain, and
when two units may run side by side. **Who** executes a unit is decided elsewhere:

- `build-feature` (single agent): you execute every unit yourself, in order, and write
  the packet as your own working notes so the review has something objective to check.
- `orchestrate` (Claude Code with the Agent tool): the orchestrator writes the packet and
  spawns an `implementer-*` agent per unit. Agent type, model and effort tier come from
  `.claude/skills/orchestrate/references/model-routing.md` and `effort-tiers.md`; the
  full spawn packet (role, effort block, hard limits, report format, Sonnet addendum) is
  in `agent-packets.md` there. Do not improvise delegation outside orchestrate.

## Why delegation fails (and how to prevent it)

Subagents share **nothing** with you: no conversation history, no rules you've read,
no decisions you've made. Every failure mode of delegation is a missing sentence in
the packet. Write packets as if onboarding a competent contractor on day one. The same
discipline makes a single-agent run reviewable: a unit without a packet cannot be
checked against anything but your own memory.

## Parallel-safety rule

Two units may run in parallel **only if** their file sets are disjoint and both depend
only on the frozen contract. `src/sim/**`, `src/voice/**`, `src/content/**` and
`src/ui/**` qualify once the contract files (`src/sim/types.ts`, `src/sim/constants.ts`,
`src/voice/protocol.ts`, `src/state/types.ts`) are written into the plan and on disk.
Two units editing a contract file, or both editing `src/theme.css`, never qualify.

## The unit packet (required sections)

```
## Task
One paragraph: what to build and the definition of done.

## Contract (frozen — do not change)
- Types: paste the relevant parts of src/sim/types.ts / src/state/types.ts
- Constants: paste the names (and values if they matter) from src/sim/constants.ts
- Worker protocol: paste src/voice/protocol.ts if the unit sends or handles messages

## Files
- Modify: exact paths
- Create: exact paths
- Do NOT touch: anything outside these (especially the contract files)

## Conventions (do not rediscover — obey)
- Read .claude/rules/project-map.md and .claude/skills/boxbox-<area>/SKILL.md first
- Mirror this existing code: <path to the closest analog you found in Phase 0>
- Sim/content: pure functions, RNG passed in, no Math.random/Date/DOM, no input mutation,
  tunables only from constants.ts
- Voice: Whisper only inside whisper.worker.ts; parser pure; keywords only in COMMAND_KEYWORDS
- UI: var(--…) tokens from src/theme.css only; narrow store selectors; commands via issueCommand

## Verify before reporting done
- pnpm lint && pnpm typecheck && pnpm test
- Report: files changed, decisions made, anything you were unsure about
```

## After a unit is done

Do not trust "done" — yours or an agent's. The unit's result enters the Phase 4 review
loop as an untrusted diff checked against this packet. If anything was flagged as
uncertain, resolve it explicitly before the review; never let a guess become a silent
decision.
