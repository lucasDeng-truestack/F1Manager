---
name: boxbox-checklist
description: Project map and pre-commit checklist for BOX BOX! (voice-controlled F1 race-engineer game, Vite + React + TS, static deploy to Vercel). Use at the START of any task in this repo to learn where things live and which skill to load, and BEFORE claiming work is done, committing, or deploying.
---

# BOX BOX! project map & checklist

## Where things live → which skill to load

| Path | What | Skill |
|---|---|---|
| `src/sim/` | Pure deterministic race sim + tests | `boxbox-sim` |
| `src/voice/` | `recorder.ts`, `whisper.worker.ts`, `parser.ts` + tests | `boxbox-voice` |
| `src/content/` | Driver radio tables + situation classifier | `boxbox-radio` |
| `src/ui/`, `src/state/`, `src/theme.css` | React screens, canvas, Zustand store, tokens | `boxbox-ui` |
| `README.md` | Run, tune keywords, model size vs speed, seeds | update when any of those change |

Dependency direction: `ui → state → sim/content/voice`. The sim depends on nothing in the app.
Contract files, commands and non-negotiables: `.claude/rules/project-map.md`.

## How to build

- Multi-file feature or anything spanning two areas → `orchestrate` (plan mode, Opus/Sonnet
  implementers from `.claude/agents/`, review loop).
- Small single-area change, or no Agent tool → `build-feature`.

## Stack constraints

- Vite + React + TypeScript `strict`. No `any`, and no `@ts-ignore` without a reason comment.
- No backend, no paid APIs, no secrets, no env vars. Deploys to Vercel as a static `dist/`.
- `pnpm` is the package manager. Deps: `@huggingface/transformers`, `seedrandom`, `zustand`,
  and `vitest` (dev). Ask before adding anything else.
- Whisper model weights are never committed. They download at runtime from the HF hub.

## Before saying it's done

1. `pnpm lint` and `pnpm typecheck` (`tsc --noEmit`) are clean.
2. `pnpm test` (Vitest) is green. Sim determinism, pit, wear, event tests and parser
   messy-transcript tests all exist and pass.
3. `pnpm build` succeeds. The worker is emitted as a separate chunk.
4. Playable end to end with **keyboard only** (B/P/S/D): start → 15 laps → debrief.
5. If voice code changed, check manually in the browser: model progress shows, Space
   glows the PTT indicator, the transcript appears in the radio log, and the command takes effect.
6. README is still accurate (keywords table, model options, seed behaviour).
