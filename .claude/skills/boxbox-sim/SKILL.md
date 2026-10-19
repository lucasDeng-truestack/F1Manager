---
name: boxbox-sim
description: Rules for the BOX BOX! race simulation in src/sim/ — determinism, seeded RNG, fixed-timestep ticks, tyre/fuel/pit/mode models, seeded events (safety car, rain, puncture) and their unit tests. Use BEFORE adding or changing anything in src/sim/, tuning lap-time/tyre/pit numbers, adding a race event or car mode, or when a race "plays differently with the same seed".
---

# BOX BOX! race sim

The sim is the heart of the game and the only part that must be bit-for-bit reproducible.
**Same seed + same command list (with tick numbers) = identical race.** Every rule below
protects that.

## Non-negotiables

1. **Pure functions only.** `src/sim/` never imports React, Zustand, the DOM, `Date`,
   `performance.now()`, `Math.random()` or anything from `src/voice`, `src/ui` or `src/state`.
   The shape is `step(state, inputs, rng) => newState`. Never mutate the incoming state.
2. **One RNG, threaded through.** Create it with `seedrandom(seed)` once per race and pass it
   in. Draw from it in a fixed order every tick, even when the result is unused, so adding
   a branch can't shift later draws. If a new feature needs randomness, give it its own
   sub-stream (``seedrandom(`${seed}:rain`)``) so existing races don't change.
3. **Fixed timestep.** The sim advances in fixed ticks (constant `TICK_MS`). The UI loop
   accumulates real time and calls `step` N times. Wall-clock time never enters the sim.
4. **Player input is data.** Commands enter as `{ tick, command }` and are applied at the
   start of that tick. That is what makes the debrief and replays possible.
5. **Tunables live in one place** (`src/sim/constants.ts`): lap count (15), field size (10),
   pit loss (~22 s), compound base pace and wear rates, mode multipliers (push = faster +
   more wear, save = slower + less wear, defend = harder to pass + small pace cost), event
   probabilities. No magic numbers in the logic.
6. **Integer or rounded state where it's compared.** Positions and gaps shown to the player
   come from sorting cumulative race time. Break ties on car id so the sort is stable.

## Tests (Vitest, `src/sim/**/*.test.ts`)

Every change keeps or adds tests for:

- **Determinism.** Run the full race twice with the same seed and command list and
  `expect(a).toEqual(b)`. Different seeds give different results.
- **Pit stops.** A stop costs roughly `PIT_LOSS`, resets wear to 0 and changes the compound.
- **Tyre wear.** Wear rises every lap, push wears faster than normal, which wears faster
  than save. Lap time gets worse as wear rises.
- **Events.** Find a seed that triggers each event (safety car, rain, puncture) and pin it in
  the test. A safety car closes up gaps. Rain hurts slick pace. A puncture forces a big loss.

When you change a tunable on purpose, update the pinned expectations in the same change and
say why in the commit. Never loosen a determinism assertion to make a test pass.
