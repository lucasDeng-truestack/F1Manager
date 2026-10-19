# Model routing — Opus vs Sonnet per unit

Two models implement in this workflow: **Opus** (`model: "opus"`) and **Sonnet**
(`model: "sonnet"`). Opus is the default. Sonnet is an opt-in for units where the work is
mechanical and the packet fully specifies it, so the cheaper model cannot lower code
quality — it can only follow or fail to follow instructions, and failing is detected
mechanically (lint, typecheck, tests, grep, diff against the packet).

Routing is decided per unit in the plan, written in the Units table next to the effort
tier, with the one-line reason. **When in doubt, Opus.** Sonnet costs noticeably less than
Opus per token (check the current pricing table before quoting this), so a correctly
routed Sonnet unit saves a large share of the agent's tokens, and a Sonnet unit that has to be
re-run on Opus costs about one Sonnet run more than going to Opus directly. Token
break-even is therefore around one escalation in two — but every escalation also costs
you a validation pass and a delay, so route to Sonnet only when you would be surprised
if it came back wrong.

## Always Opus

Any unit that includes one of these goes to Opus, whatever its size or tier:

- **UI/UX work of any kind** — new or changed screens, components, canvas drawing,
  the PTT indicator, loading/error/mic-denied states, theme token choices, anything judged
  by how the game looks or feels. This includes "small" visual changes: spacing,
  hierarchy, and colour calls are judgement, not mechanics.
- **High effort tier** (sim step logic, determinism and RNG threading, tyre/pit/mode/event
  math, parser matching, audio capture/resampling, the Whisper worker, the game loop).
- **Writing driver radio lines** that are not given verbatim — tone is judgement.
- **Medium tier where the analog is loose** — the packet says "like X but …" and the
  "but" needs design decisions (new service shape, new validation rules, state machines).
- **Anything touching speech recognition or the command parser's matching**: failures
  there are not caught by lint and only show with a real mic and messy speech.
- **Fixers** whose findings include a correctness or determinism item, or any
  finding phrased as "investigate" / "consider" / "decide".

## Sonnet-eligible

A unit may go to Sonnet only when **all** of these hold:

1. **Exact analog named in the packet.** Not "the closest feature" — the specific file(s)
   to mirror, and the mirroring is one-to-one (same shape, different names/fields).
2. **Steps are enumerable.** You can write the packet's `Files` section with a bullet per
   file saying what changes in it. If you find yourself writing "add whatever is needed
   to make X work", stop — that unit is Opus.
3. **No judgement calls left.** Field lists, enum values, permission strings, copy,
   and column orders are all in the packet. The agent
   decides nothing the reviewer would have an opinion about.
4. **Failure is mechanically detectable.** Lint, typecheck, vitest, the checklist greps, or a
   diff against the packet's per-file bullets catches a wrong result. A unit whose failure
   mode is "subtly wrong UX" is never Sonnet-eligible.
5. **Low or medium tier**, and the medium case contains no backend service logic beyond
   CRUD mirroring.

### Typical Sonnet units in this repo

| Unit shape | Why it qualifies |
|---|---|
| UI copy changes where every old → new string is listed in the packet | grep verifies |
| README sections (run, keyword tuning, model size vs speed, seeds) from a spec you wrote | content is in the packet |
| New `COMMAND_KEYWORDS` entries or sound-alikes listed verbatim, plus their parser test rows | table pattern, vitest verifies |
| Radio line pools where every line is in the packet | content is in the packet; grep verifies |
| Parser or sim tests written against an explicit case list (input → expected) for code that already exists | spec is the packet; vitest verifies |
| Renames / moves / import rewiring with a complete file list | grep verifies |
| Fixers whose findings are all convention/style tier and each finding states the expected fix | verbatim list, re-review verifies |

### Never Sonnet, even though they look mechanical

- "Copy this page for entity Y" when Y has different states, counts or actions than X —
  the differences are UX decisions.
- Anything in `src/sim` beyond tests, the parser's matching/normalisation, `recorder.ts`
  or `whisper.worker.ts`.
- Adding or changing a token in `src/theme.css` (a colour call is a design call).
- First implementation of a pattern that has no analog yet.
- Anything the plan marks as "user will look at this first".

## Spawn parameters

| Role | `subagent_type` | Model / effort | Notes |
|---|---|---|---|
| Explorer | `Explore` | agent default | read-only fan-out in plan mode |
| Implementer or fixer, high tier | `implementer-opus-high` | Opus, high | sim, determinism, parser matching, audio, worker, game loop; any correctness/determinism finding |
| Implementer or fixer, judgement or UI | `implementer-opus` | Opus, medium | default for every other unit |
| Implementer or fixer, mechanical | `implementer-sonnet` | Sonnet, medium | only when every eligibility rule holds; findings all convention/style with fixes stated |

The three implementer types are custom agents in `.claude/agents/`. If the session does
not list them, use `subagent_type: "general-purpose"` with `model: "opus"` or
`model: "sonnet"` and note the fallback in the orchestration log.

The effort tier (`references/effort-tiers.md`) is independent of the model: a Sonnet unit
still carries a tier block; it is almost always `low`.

## Sonnet packets are stricter

Add the Sonnet addendum from `references/agent-packets.md` to every Sonnet packet. The
difference from an Opus packet is that Sonnet is told *what to do in each file*, not
*what outcome to reach*, and is told to stop and report rather than improvise when the
analog and the instructions disagree.

## Escalation

- A Sonnet unit gets **one** correction via `SendMessage` for a gap that is a missed
  instruction (wrong path, missed file, lint not run). It never gets a second.
- If the gap is a judgement gap — the agent invented a shape, changed copy, "improved"
  neighbouring code, or reports "unsure" about anything that is not a typo in your packet
  — stop. Re-spawn the unit on Opus with the same packet plus the Sonnet report under
  `## Prior attempt (do not trust, do not repeat)`. Do not iterate with Sonnet.
- Record every escalation in the orchestration log. Two escalations in one run means the
  routing was wrong for this feature class; say so in the handoff so the rule here can be
  tightened.

## What you log

The handoff's orchestration log already has a `Model` column. Fill it honestly, add
`escalated → opus` in Notes where it happened, and end the log with one line:
`Routing: N units sonnet, M opus, K escalations.` Over several runs this is the only
evidence for widening or narrowing the Sonnet-eligible list above.
