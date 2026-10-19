---
name: build-feature
description: Lead-developer workflow for building features in BOX BOX! — clarify requirements first, architect, build contract first, review and fix in a loop, verify, then hand off. Use for any multi-step feature, refactor, or new module when you are the only agent (Cursor, Codex, a single Claude Code session without subagents, or a change too small to be worth orchestrating). In Claude Code with the Agent tool and a feature spanning more than a couple of files, use the orchestrate skill instead — it wraps this one. Invoke before writing any code.
---

# Build Feature — Lead Developer Workflow

You are acting as the lead developer on this codebase. Your job is not to write code
fastest — it is to ship the *right* change, verified, consistent with the repo's rules,
and cleanly handed off. Follow the five phases in order. Each phase has a gate; do not
pass a gate by assumption.

**Golden rule: facts live in the repo — go read them. Intent lives with the user — go ask.**
Never burn tokens guessing at intent, and never interrupt the user for facts you can
grep for yourself.

**Which skill?** This skill is the single-agent path: you do every unit yourself, in
order. If you are in Claude Code, the `Agent` tool is available, and the change spans
more than a couple of files or more than one area (sim, voice, content, ui), stop and invoke `orchestrate`
instead — it runs these same phases with plan mode as the approval gate and delegates the
units to Opus/Sonnet subagents. The references under `references/` are shared by both
skills; edit them here, never copy them.

## Phase 0 — Context (read before anything)

0. **Record the baseline.** Save `git status --porcelain` and `git diff --stat` to your
   notes (scratchpad if you have one). The review in Phase 4 must scope to *this* task's
   files, not the whole tree.
1. Read `.claude/rules/project-map.md` and `README.md` to identify which area(s) the
   feature touches (`src/sim`, `src/voice`, `src/content`, `src/ui` + `src/state`).
2. Load the `boxbox-*` skill for each area touched (`boxbox-sim`, `boxbox-voice`,
   `boxbox-radio`, `boxbox-ui`). Library APIs (transformers.js, seedrandom, Zustand,
   Vite workers) → check the installed version's docs/types in `node_modules`, not memory.
3. Find the closest existing feature and read it end-to-end (contract types → sim /
   content / voice → store → component). Copy its shape. A feature that ignores an
   existing pattern is wrong even if it works.
4. Sim involved → read `src/sim/constants.ts` and the determinism tests before designing
   anything.

## Phase 1 — Clarify (gate: requirements are unambiguous)

Before designing, list every open question. Answer from the codebase what you can.
For the rest, **ask the user in one batch** — do not trickle questions one at a time,
and do not proceed on guesses. Questions that are almost always worth asking when the
request doesn't specify:

- **Gameplay:** what does the player do, and what should the sim do in response? Which
  numbers (pace, wear, pit loss, probability) — or is tuning left to playtesting?
- **Determinism:** may existing seeds play differently after this change, or must old
  races stay identical (new randomness on its own sub-stream)?
- **Voice:** new command or keyword? Which phrases should map to it, and which must not?
  What does the driver say if it's misheard?
- **Radio:** which situations get their own lines, and what's the tone (dry, sarcastic)?
- **UX:** which screen (start, race, debrief)? What shows while the model loads, if the mic
  is denied, or if Whisper errors? Which keyboard key is the fallback?

If the user is unavailable, state your assumptions explicitly at the top of your plan,
choose the most conservative option, and flag them again in the handoff.

**Gate:** you can state, in two sentences, what will exist when you're done and how the
user will confirm it works. If you can't, you're not ready.

## Phase 2 — Architect (gate: written plan exists)

Write the plan down before implementing (a short markdown block is enough):

- Files to create/modify, grouped by area.
- Contract changes: new or changed types (`src/sim/types.ts`, `src/state/types.ts`),
  tunables (`src/sim/constants.ts`), worker messages (`src/voice/protocol.ts`).
- Whether existing seeds will play differently, and why that's acceptable.
- UI: screens/components, which existing components and tokens you'll reuse, new tokens.
- Order of work: contract first, then units in dependency order (see Phase 3).
- Test/verify strategy: which Vitest cases (sim and parser changes always get tests), the
  keyboard-only playthrough, which screens to look at in the browser, voice steps for a real mic.

Before freezing the plan, re-check every number, path and version string in it against
the raw output it came from. A wrong fact in the plan is copied faithfully into the code.

Show the plan to the user before implementing when the feature touches the contract
files, changes how seeds play, or spans more than one area; otherwise include it at the top of your response and proceed.
(Under `orchestrate`, plan mode makes this gate explicit.)

## Phase 3 — Implement

Work in units, contract first, in this order — the decomposition is the value even when
one agent does all of it, because the review in Phase 4 checks each unit against the plan:

1. **Contract first:** `src/sim/types.ts`, `src/sim/constants.ts`,
   `src/voice/protocol.ts`, `src/state/types.ts`; then `pnpm typecheck`.
2. **Sim unit:** pure functions in `src/sim` with Vitest coverage (determinism test stays green).
3. **Voice / content units:** recorder, worker, parser + tests; radio tables + `classify`.
4. **UI + state unit:** store slice, game-loop wiring, components and tokens.
5. **Docs unit (optional):** README updates (keywords, model options, seeds).

If the contract must change mid-way, stop, change it, update the plan, and re-check the
units already written against the new contract before continuing.

Write your own "packet" for each unit as working notes — the Task / Contract / Files /
Conventions / Verify sections from `references/delegation.md` — so Phase 4 has something
objective to review against. If you do have the `Agent` tool and find yourself wanting to
delegate a unit, that is the signal to switch to `orchestrate`; do not improvise a
delegation here.

## Phase 4 — Review Loop (gate: clean review)

You now switch roles: you are the reviewer, and the implementation is untrusted. Use
`references/review-checklist.md`. Scope everything to the files this task touched (diff
against the Phase 0 baseline). The loop:

1. Run the mechanical checks (lint/typecheck/test, the checklist §1 greps).
2. In Claude Code, invoke the `code-review` skill at level `high` targeting the touched
   paths. Elsewhere, read the diff as a reviewer yourself: correctness, edge cases, rule
   compliance, reuse.
3. Walk checklist §2–§5 against the diff for what a generic review cannot know (integer
   purity, RNG draw order, constants, worker protocol, parser table, token-only styling).
4. UI touched and a dev server configured (`.claude/launch.json`)? Open the changed
   screens at 1280px and 375px, play a few laps with B/P/S/D, and look before you fix anything else.
5. Write findings as one numbered list with `file:line`, ordered by the checklist's
   severity discipline. Fix them. Re-review only the fixes.
6. Repeat until a pass produces zero findings. Cap at 3 cycles. If findings persist
   after 3, stop and escalate to the user with the remaining list — do not silently ship
   known issues, and do not loop forever.

## Phase 5 — Verify & Hand Off

- Run `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` and report the real
  result. Never claim clean if it isn't.
- Exercise the feature if a dev server is available (keyboard-only race start → debrief);
  voice needs a real mic, so say exactly what manual steps the user should run.
- **Never** `git add` / `commit` / `push` (`.claude/rules/git-workflow.md`).
- If the change touched `src/sim`, confirm the same-seed determinism test passes and list
  any tunable you changed.
- Write the handoff using `references/handoff.md`, including the merge verdict line. It
  must include assumptions made in Phase 1 and anything the review loop escalated.

## Anti-patterns (things that get this workflow fired)

- Writing code before Phase 1's gate. — Guessing gameplay numbers the user cares about.
- `Math.random()` / `Date` in the sim or content, or sim logic leaking into components.
- Hand-rolling something that already exists (a token, a component, a keyword entry, a sim helper).
- Changing the contract after units are written without re-checking them.
- Reviewing the whole working tree instead of this task's diff. — Reviewing your own
  code generously.
- Reporting "done" without running lint/typecheck/test. — Committing to git.
- Improvising subagent delegation here instead of switching to `orchestrate`.
