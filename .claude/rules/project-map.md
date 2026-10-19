# BOX BOX! — project map and conventions

Browser game: the player is an F1 race engineer and plays by voice over "team radio".
Single Vite + React + TypeScript (`strict`) app, no backend, deployed to Vercel as a static
`dist/`. Node 22+, pnpm. `README.md` is the source of truth for running the game, tuning
command keywords, model size vs speed, and how seeds work.

> **Not a git repo yet.** The orchestrate / build-feature baseline and review steps diff
> against git. Before the first orchestrated run, ask the user to `git init` and make an
> initial commit themselves (agents never commit — `git-workflow.md`).

| Path | What it is | Skill to load |
|---|---|---|
| `src/sim/` | Pure deterministic race sim (15 laps, 10 cars, seeded events) + Vitest | `boxbox-sim` |
| `src/voice/` | `recorder.ts` (Space PTT → 16 kHz mono), `whisper.worker.ts` (transformers.js), `parser.ts` + tests | `boxbox-voice` |
| `src/content/` | Driver radio tables + `classify(state, command)` situation picker | `boxbox-radio` |
| `src/ui/` | React screens (start, race, debrief), timing tower, canvas track, radio log, PTT indicator | `boxbox-ui` |
| `src/state/` | Zustand store, game loop (rAF + fixed-step accumulator), `issueCommand` | `boxbox-ui` |
| `src/theme.css` | Every design token (CSS variables). Components use `var(--…)` only | `boxbox-ui` |

Dependency direction: `ui → state → sim / content / voice`. `src/sim` imports nothing from
the app. `src/content` may import sim types only.

## Contract files (the orchestrator owns these)

These play the role a shared schema package plays in a multi-package repo. Implementers
never edit them; the orchestrator writes them in the contract phase.

- `src/sim/types.ts` — `Compound`, `CarMode`, `CarState`, `RaceState`, `RaceEvent`,
  `Command` (`BOX | PUSH | SAVE_TYRES | DEFEND | PLAN_B | COPY`), `CommandInput { tick, command }`
- `src/sim/constants.ts` — every tunable (laps, field size, `TICK_MS`, `PIT_LOSS`, wear rates,
  mode multipliers, event probabilities)
- `src/voice/protocol.ts` — the worker message union (`load`, `transcribe` → `progress`,
  `ready`, `transcript`, `error`)
- `src/state/types.ts` — store shape and action signatures (`issueCommand(cmd, source)`)

## Commands

`pnpm dev` (5173) · `pnpm preview` (4173) · `pnpm lint` · `pnpm typecheck` (`tsc --noEmit`)
· `pnpm test` (Vitest) · `pnpm build`. The `.claude/launch.json` configs are `boxbox-dev`
and `boxbox-preview`.

## Non-negotiables

- **Determinism.** Same seed + same `CommandInput[]` = identical race. No `Math.random()`,
  `Date` or `performance.now()` in `src/sim` or `src/content`. RNG is `seedrandom`, threaded
  through; new randomness gets its own sub-stream. See `boxbox-sim`.
- **No paid APIs, no backend, no secrets.** Whisper runs locally in the worker; the only
  network call is the one-off model download from the HF hub (cached by the library).
- **Token-only styling.** No hex/rgb/px literals outside `src/theme.css`. See `boxbox-ui`.
- **Keyboard fallback always works.** B/P/S/D drive the same `issueCommand` as voice; the
  game is playable end to end with the mic denied.

## Tests

Vitest, next to the source (`*.test.ts`). Required suites: sim determinism, pit stops, tyre
wear, each seeded event (pinned seeds); parser messy-transcript table. Content `classify`
gets cases for every situation key.
