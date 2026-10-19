# Handoff template

End every feature task with this report. The user commits manually (repo rule), did not
watch the work happen, and reads this to write the commit message and decide what to do
next — so it has to stand alone. Shared by `build-feature` and `orchestrate`; orchestrate
appends its orchestration log (see its own `references/handoff.md`).

```markdown
## What was built
One paragraph, user-language: what exists now that didn't before.

## Changes
- `path/to/file` — what and why (group by package)

## Run before using
# Usually nothing beyond `pnpm install` and `pnpm dev`. List new deps, a changed model id
# (first load re-downloads weights), or a changed seed behaviour (old seeds now play differently).

## Verified
- pnpm lint: ✅/❌ (paste failures verbatim if ❌)
- pnpm typecheck: ✅/❌
- pnpm test: ✅/❌
- pnpm build: ✅/❌
- Determinism (if sim/content touched): same-seed test passes; tunable changes listed ✅/❌
- Browser: <screens opened at 1280px and 375px, what you saw — or "not opened: no dev server">
- Keyboard-only race (B/P/S/D): start → 15 laps → debrief ✅/❌/not run
- Voice (if touched): model progress, PTT glow, transcript in log, command applied — or exact steps for the user (needs a real mic)

## Assumptions made (from Phase 1)
- <assumption> — chosen because <reason>; revisit if wrong

## Things I'm unsure about
Judgement calls you should sanity-check. One line each, with where to look.
- <decision> — <why it might be wrong> — see `path/to/file`

## Remaining gaps
- Escalated review findings (survived cycle 3): <file:line — finding — severity>
- Deferred scope (agreed in the plan or discovered mid-run): <what, and why deferred>
- Not verified: <anything in the verify strategy that could not be exercised>

## Next steps
Ordered. What you'd do next if this were your ticket.
1. <e.g. play seed 42 with a real mic and log every misheard phrase into the parser tests>
2. <e.g. tune PIT_LOSS after a few races>

## Suggested commit message
<One sentence describing the user-visible change.>

<Merge verdict line — see below>
```

## Merge verdict

End with one line the user can act on without reading the rest:

- `Ready to commit.` — lint, typecheck and tests clean, zero open findings, manual flow
  verified or clearly described.
- `Ready to commit with caveats.` — checks clean, only style-tier findings or unverified
  manual steps remain; listed above.
- `Do not merge yet.` — a correctness or determinism finding survived the loop, or
  a check fails. Say which.

## Rules

- Never mark "Verified" on hope. A ❌ with pasted output is a good handoff; a false ✅
  is the worst possible outcome of this workflow.
- "Remaining gaps: none" and "Unsure about: none" must be earned by the review loop,
  not assumed.
- Do not stage, commit, or push. Summarize so the user can.
- Never commit Whisper model weights; they download at runtime.
