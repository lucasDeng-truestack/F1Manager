# Review checklist — repo-specific

Run mechanical checks first (cheap, objective), then read the diff. Report findings as
a numbered list with file:line; fix, then re-review only the fixes.

## 1) Mechanical checks

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build

# Non-determinism in the pure layers — must be zero hits
git diff -- 'src/sim/*' 'src/content/*' | grep -nE '^\+.*(Math\.random|Date\.now|new Date|performance\.now)'

# Pure layers importing the app, React, the DOM or the store — must be zero hits
git diff -- 'src/sim/*' 'src/content/*' | grep -nE '^\+.*(from .react|from .zustand|src/(ui|state|voice)|\.\./(ui|state|voice)|document\.|window\.)'

# Hardcoded colours / sizes outside the theme file — each hit must be justified
git diff -- 'src/ui/*' | grep -nE '^\+.*(#[0-9a-fA-F]{3,8}\b|rgba?\(|[0-9]+px)'

# Whisper / transformers used outside the worker
git diff -- 'src/*' | grep -nE '^\+.*@huggingface/transformers' | grep -v 'whisper.worker.ts'

# Paid / remote APIs sneaking in
git diff | grep -nE '^\+.*(api\.openai|anthropic|fetch\(.*https?://)' | grep -v 'huggingface'

# Debug leftovers
git diff | grep -nE '^\+.*(console\.log|debugger)'
```

## 2) Sim & content review (`src/sim`, `src/content`)

- [ ] Functions are pure: new state returned, input never mutated (no `push`/`sort` on
      incoming arrays without copying).
- [ ] RNG comes in as a parameter; draws happen in a fixed order every tick; new
      randomness uses its own ``seedrandom(`${seed}:<name>`)`` sub-stream.
- [ ] Commands applied from `CommandInput { tick, command }` at the start of that tick.
- [ ] Every tunable is in `src/sim/constants.ts`; no magic numbers in logic.
- [ ] Position sort is stable (ties broken by car id).
- [ ] Tests: determinism (same seed twice → `toEqual`), pit stop loss + wear reset +
      compound change, wear ordering push > normal > save, each event pinned to a seed.
      Changed tunables → pinned expectations updated with a reason.
- [ ] Radio: every command has a `default` situation; unknown → `say_again`; unprompted
      triggers have cooldowns; line choice uses the radio sub-stream.

## 3) Voice review (`src/voice`)

- [ ] Space PTT ignores key repeat and text inputs, calls `preventDefault`; mic requested
      on first press, denial surfaces a `mic-unavailable` state.
- [ ] Audio is mono 16 000 Hz `Float32Array`, transferred (not copied) to the worker;
      clips under ~250 ms dropped.
- [ ] Worker: pipeline is a singleton; WebGPU only when an adapter is obtained, otherwise
      WASM; base.en with tiny.en fallback; `progress` posted; messages match
      `src/voice/protocol.ts` exactly.
- [ ] Parser is pure; keywords live only in `COMMAND_KEYWORDS`; normalisation strips
      fillers and punctuation; tie rule is documented and tested; below threshold → UNKNOWN.
- [ ] Parser test table covers the messy cases ("box box box", "uh push now push",
      "bocks", blank/`[BLANK_AUDIO]`, nonsense) plus any new keyword.

## 4) UI & state review (`src/ui`, `src/state`, `src/theme.css`)

- [ ] Colours, fonts, sizes, radii and spacing via semantic `var(--…)` tokens only; new
      tokens added to `src/theme.css`; canvas reads tokens via `getComputedStyle`.
- [ ] Components select narrow store slices; no whole-store subscriptions.
- [ ] Game loop: rAF + fixed-step accumulator calling `sim.step`; canvas only reads state.
- [ ] Voice and keyboard both go through `issueCommand(cmd, source)`; B/P/S/D hints shown.
- [ ] Model download progress, model error and mic-denied states are visible and never
      block the keyboard fallback.
- [ ] Radio log is `aria-live="polite"`; all controls keyboard-reachable; canvas is
      DPR-aware and resizes via `ResizeObserver`.
- [ ] No horizontal page scroll at 1280px and at 375px.

## 5) Cross-cutting

- [ ] Matches the plan's contract exactly (types, constants, worker protocol, store actions).
- [ ] Dependency direction holds: `ui → state → sim / content / voice`.
- [ ] No leftover debug: `console.log`, commented-out blocks, unused imports.
- [ ] Naming/idiom matches neighbouring code (compare with the analog).
- [ ] README still accurate (run, keywords, model size vs speed, seeds).
- [ ] Anything the implementer flagged as "unsure" has been resolved explicitly.

## Severity discipline

Order findings: correctness → determinism/security → convention violations → style.
A style nit never blocks handoff on cycle 3; a determinism or correctness bug always does.
