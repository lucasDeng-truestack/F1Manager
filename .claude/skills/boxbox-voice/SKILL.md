---
name: boxbox-voice
description: How BOX BOX! voice input works in src/voice/ — push-to-talk recorder, 16 kHz resampling, the local Whisper Web Worker (transformers.js, WebGPU → WASM), model download/caching, and the fuzzy command parser with its keyword table and messy-transcript tests. Use BEFORE touching recorder.ts, whisper.worker.ts or parser.ts, adding or renaming a command, tuning keywords, changing the model, or debugging "it didn't hear me" / "wrong command".
---

# BOX BOX! voice pipeline

`Space held → MediaRecorder → decode + resample to 16 kHz mono Float32 → whisper.worker → transcript → parser → Command`

Everything runs in the browser. **No paid APIs, no backend, no network calls except the
one-off model download.**

## recorder.ts

1. Push-to-talk: `keydown` Space starts and `keyup` Space stops. Ignore key repeat and ignore
   Space while focus is in a text input (the seed field). Call `preventDefault` so the page
   doesn't scroll.
2. Ask for the mic lazily on the first press, not on page load. If permission is denied or
   unavailable, emit a `mic-unavailable` state so the UI shows the B/P/S/D keyboard fallback.
3. Decode the blob with `AudioContext.decodeAudioData`, downmix to mono and resample to
   16 000 Hz (an `OfflineAudioContext` at 16 kHz is fine). Transfer the `Float32Array` buffer
   to the worker; don't copy it.
4. Drop clips shorter than ~250 ms (accidental taps).

## whisper.worker.ts

1. Use `@huggingface/transformers` `pipeline('automatic-speech-recognition', …)`.
   Default `onnx-community/whisper-base.en`, fall back to `onnx-community/whisper-tiny.en`
   when loading fails or the device is weak.
2. Device: `'webgpu'` when `navigator.gpu` exists and adapter request succeeds, otherwise
   `'wasm'`. Load the pipeline once, as a singleton.
3. Post `progress` messages from `progress_callback` so the UI can show the first-load
   download bar. The library caches weights in Cache Storage, so later loads are instant. Don't
   add a second cache.
4. Message protocol is a typed discriminated union shared with the main thread
   (`load`, `transcribe` → `progress`, `ready`, `transcript`, `error`). Keep it in one file.
5. Never block the main thread. No Whisper code outside the worker.

## parser.ts

1. Pure function: `parse(transcript) => { command: Command | 'UNKNOWN', confidence, matched }`.
   Commands are `BOX`, `PUSH`, `SAVE_TYRES`, `DEFEND`, `PLAN_B`, `COPY`.
2. Normalise first: lowercase, strip punctuation, collapse repeats, and drop fillers
   (`uh`, `um`, `like`, `now`, `mate`, the driver's name).
3. Keywords and sound-alikes live in **one table** (`COMMAND_KEYWORDS`) that the README
   documents for tuning, for example `box: ['box', 'bocks', 'boxx', 'pit', 'pit in', 'in this lap']`.
   Match with token fuzzy distance (Levenshtein ≤ 1 for short words) and multi-word phrases.
4. If two commands match, the one said most or said last wins. Pick that rule, write it down
   in the code and test it. Below threshold = `UNKNOWN`, and the driver replies "Say again?".

## Parser tests (`src/voice/parser.test.ts`)

Keep a table of real-world transcripts, and add every misheard phrase you find while playing:
`"box box box"`, `"uh push now push"`, `"bocks"`, `"Box, box."`, `"save the tyres mate"`,
`"defend defend"`, `"plan b"`, `"plan bee"`, `"copy that"`, `"[BLANK_AUDIO]"` → UNKNOWN,
`""` → UNKNOWN, and nonsense → UNKNOWN.
