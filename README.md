# BOX BOX!

A browser game where you are an F1 race engineer. You run a 15-lap race from the pit wall by talking to your driver over team radio — hold Space and say "box box", "push", "save the tyres", "defend", "plan B" or "copy". Speech recognition runs entirely in your browser; there is no backend and your audio never leaves your machine.

## Requirements

- Node 22 or newer
- pnpm
- A Chromium-based browser for WebGPU speech recognition (other browsers fall back to WASM)
- A microphone (optional — every command also has a key)

## Run it

```bash
pnpm install
pnpm dev        # http://localhost:5173
```

| Command | What it does |
|---|---|
| `pnpm dev` | Vite dev server on port 5173 |
| `pnpm build` | Typecheck, then build the static site into `dist/` |
| `pnpm preview` | Serve the built `dist/` on port 4173 |
| `pnpm test` | Vitest (sim, parser, content, state, UI helpers) |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | `tsc --noEmit` |

## How to play

1. Enter a seed (or keep the default `monza-42`) and press **Lights out**.
2. The race is 15 laps, about 24 seconds each, so about 6 minutes in all.
3. Hold **Space**, speak a call, and release. The radio log shows what was heard and the driver answers.
4. When the flag falls you get a debrief. It lists every call with its lap and the time and places it gained or lost.

### Calls

| Call | Key | Say | Effect |
|---|---|---|---|
| BOX | B | "box box", "pit" | Pits at the end of the current lap. Call it again before the line to cancel. In the wet the car always gets intermediates. |
| PUSH | P | "push", "flat out" | Faster, but more tyre wear and fuel. |
| SAVE_TYRES | S | "save the tyres", "lift and coast" | Slower, but tyres and fuel last longer. |
| DEFEND | D | "defend", "hold him off" | Harder for the car behind to pass. Slightly slower. |
| PLAN_B | A | "plan B", "switch plan" | Swaps the planned pit tyre between Plan A (hards) and Plan B (softs). |
| COPY | C | "copy", "roger" | Acknowledges only. Changes nothing. |

The game is fully playable without a microphone: the keys, and the on-screen buttons on a phone, send exactly the same calls as voice. If the radio can't make out a call, the driver says "say again?" and nothing changes.

The debrief's gained/lost numbers are exact. For each call the game re-runs the same race without that one call and compares your finishing time and position.

## Voice and the speech model

- The first visit downloads a Whisper model from the Hugging Face hub. The start screen shows the progress. The browser caches it, so later visits start immediately.
- With WebGPU the game loads `onnx-community/whisper-base.en` (more accurate). Without it, the game loads `onnx-community/whisper-tiny.en` on WASM (faster on a CPU). If the first model fails to load, the game falls back to tiny, then to tiny on WASM.
- The ONNX Runtime files are served from this app's own assets. The fonts are self-hosted via @fontsource. The only outside network call is the model download from Hugging Face.
- If the microphone is blocked, the game keeps working on the keys.

### Model size vs speed

base.en is about 74M parameters and tiny.en about 39M. On WebGPU, base is usually fast enough for push-to-talk. On a CPU (WASM), tiny keeps the delay between releasing Space and the driver's reply short. To force a model, pass a model id to `client.load(...)` in `src/state/voice.ts` (the worker accepts `'onnx-community/whisper-base.en'` or `'onnx-community/whisper-tiny.en'`). The selection and fallback order live in `attemptsFor` in `src/voice/whisper.worker.ts`.

## Tuning command keywords

Every word the radio understands lives in one place: `COMMAND_KEYWORDS` in `src/voice/parser.ts`. This is the current table:

| Command | Keywords |
|---|---|
| BOX | `box`, `bocks`, `boks`, `boxx`, `books`, `boxed`, `boxing`, `pit`, `pits`, `pit in`, `box this lap`, `in this lap` |
| PUSH | `push`, `pushing`, `pushed`, `posh`, `flat out`, `full send`, `go go go` |
| SAVE_TYRES | `save tyres`, `save the tyres`, `save tires`, `save the tires`, `tyre save`, `manage the tyres`, `look after the tyres`, `lift and coast`, `save` |
| DEFEND | `defend`, `defending`, `defence`, `defense`, `the fend`, `hold him off`, `keep him behind`, `cover the inside` |
| PLAN_B | `plan b`, `plan bee`, `plan be`, `plan b please`, `switch plan`, `other plan` |
| COPY | `copy`, `copy that`, `copied`, `roger`, `roger that`, `understood`, `got it`, `okay`, `ok`, `affirm`, `affirmative` |

### Rules for entries

- Write entries already normalised: lowercase, `a-z0-9`, single spaces. A test enforces this, and checks that no entry appears under two commands.
- Multi-word entries are phrases. At each position the longest phrase wins, so "save the tyres" is one hit and never also a bare "save".
- Entries of 5 or more letters (`FUZZY_MIN_LENGTH`) also match one typo away. Shorter entries match exactly only, so list their sound-alikes explicitly (that is why `bocks` and `boks` are there).
- COPY never beats an actionable call: "box box, okay?" is BOX.

### Thresholds

| Constant | Value | Meaning |
|---|---|---|
| `CONFIDENCE_THRESHOLD` | 0.6 | Below this the call is UNKNOWN and the driver says "say again?" |
| `FUZZY_MIN_LENGTH` | 5 | Shortest keyword that also matches one edit away |
| `FUZZY_SCORE` | 0.7 | Score of a one-typo match (an exact match scores 1) |
| `CONTENTION_PENALTY` | 0.5 | How much competing commands in one transcript lower confidence |

After any change, run `pnpm test`. `src/voice/parser.test.ts` holds a table of messy real-world transcripts that must still parse correctly.

## Seeds

The race is fully deterministic. The same seed plus the same calls at the same moments gives an identical race, which is how the debrief can replay it. An empty seed means `monza-42`.

A seed decides:

- your grid slot (P4–P7) and the other nine cars' pace, start tyres and pit plans
- whether there is a safety car (35 %), rain (30 %) and a puncture (25 %; when there is one, it hits you about 30 % of the time), and on which laps
- every overtaking roll and the driver's radio lines

Each kind of randomness has its own seeded stream (`grid`, `events`, `ai`, `race`, `radio`), so adding a radio line never changes a race. Every tunable — lap time, tyre wear, pit loss, event odds — is in `src/sim/constants.ts`.

## Project layout

| Path | What it is |
|---|---|
| `src/sim/` | Pure, deterministic race sim (15 laps, 10 cars, seeded events) and its tests |
| `src/voice/` | Push-to-talk recorder, Whisper Web Worker, command parser |
| `src/content/` | Driver radio lines and the situation picker |
| `src/state/` | Zustand store, fixed-step game loop, voice and keyboard wiring |
| `src/ui/` | React screens, timing tower, canvas track, radio log, PTT indicator |
| `src/theme.css` | Every design token. Components only use `var(--…)`, so a reskin is one file. |

## Deploy

- `pnpm build` produces a static `dist/`. Deploy it to Vercel (or any static host) with no server and no environment variables.
- `dist/` includes the ONNX Runtime WASM files (about 27 MB, plus about 14 MB for a fallback only older Safari uses). Check your host's per-file size limit.
- `onnxruntime-web` in `package.json` is pinned to exactly the version `@huggingface/transformers` depends on. When you upgrade transformers, bump both together, or the model will fail to load at runtime even though the build passes.
