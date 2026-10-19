---
name: boxbox-ui
description: BOX BOX! frontend rules for src/ui/, src/state/ and src/theme.css — token-only styling for later reskinning, screen layout (timing tower, canvas track, radio log, PTT indicator), start and debrief screens, Zustand store boundaries, Canvas 2D render loop and keyboard fallback. Use BEFORE adding or editing any React component, CSS, canvas drawing, store slice, or screen.
---

# BOX BOX! UI

A designer will reskin this later. Keep it plain, keep it token-driven, and keep logic out of
components.

## Styling

1. **Every colour, font, size, radius and spacing value is a CSS variable in `src/theme.css`.**
   Components only use `var(--…)`. No hex, rgb or px literals in component CSS, and no inline
   style colours. Canvas reads tokens once with `getComputedStyle(document.documentElement)`
   and refreshes on theme change.
2. Tokens are semantic (`--color-surface`, `--color-text-muted`, `--color-tyre-soft`,
   `--color-radio-engineer`, `--color-radio-driver`, `--color-ptt-live`), not literal
   (`--red`).
3. Placeholder look: retro/pixel (a pixel font self-hosted via @fontsource, hard edges, scanline-free).
   Plain CSS or CSS modules only. Don't add a UI library or Tailwind.

## Layout (race screen)

- Left: timing tower P1–P10 with gap, tyre compound icon and wear %. Highlight the player row.
- Centre: `<canvas>` with a top-down track loop and car dots, sized by `ResizeObserver` and DPR-aware.
- Right/bottom: radio log (engineer and driver lines styled differently, auto-scroll), lap
  `n/15`, weather, and the PTT indicator that glows while Space is held and shows a "thinking"
  state while Whisper runs.
- Model download progress shows before the first race and never blocks the keyboard fallback.
- Start screen: seed input + "Lights out" button. Debrief: finish position, then each call with
  lap number and time gained or lost.

## State & loop

1. `src/state/` holds the Zustand store: race state, command log, radio log, voice status. Components
   select narrow slices. Don't subscribe to the whole store.
2. The game loop is `requestAnimationFrame` with a fixed-step accumulator that calls `sim.step`
   (see the `boxbox-sim` skill). Canvas draws from state and interpolates between ticks. It
   never changes sim state.
3. Voice and keyboard go through the same `issueCommand(cmd, source)` action. Fallback keys:
   **B** = BOX, **P** = PUSH, **S** = SAVE_TYRES, **D** = DEFEND. Show the key hints on screen.
4. Accessibility: the radio log is an `aria-live="polite"` region, and every control is
   reachable by keyboard.
