---
name: boxbox-radio
description: Writing and wiring driver team-radio lines for BOX BOX! in src/content/ — response tables keyed by command + race state, unprompted driver calls (tyres gone, rain, safety car), tone, and deterministic line selection. Use BEFORE adding or editing any driver/engineer dialogue, adding a new command response, or a new race situation the driver should react to.
---

# BOX BOX! driver radio

The driver is half the fun. Lines are short, punchy, and react to what's actually happening.

## Structure

1. **Content is data.** All lines live in `src/content/` as typed tables, with no JSX or logic
   mixed in. Shape: `responses[command][situation] = string[]` plus
   `unprompted[trigger] = string[]`.
2. **Situations are derived, not stored.** A pure `classify(state, command)` in `src/content`
   maps race state to a situation key, for example `BOX` + wear > 80 % + late laps = `late_dead_tyres`
   (sarcastic), `BOX` + fresh tyres = `pointless_stop`, `PUSH` + wear > 70 % = `push_on_dead_tyres`,
   `DEFEND` with nobody within 1 s = `defend_nobody`. Always keep a `default` key per command.
3. **Unknown command** always uses the `say_again` pool ("Say again?", "Radio's breaking up,
   repeat?").
4. **Unprompted calls** fire from sim state transitions, not timers: wear crosses a
   threshold, rain starts, safety car deployed or in, puncture, overtake made or lost, final lap.
   Each trigger has a cooldown so the driver doesn't spam.
5. **Deterministic pick.** Choose a line with the race RNG sub-stream
   (``seedrandom(`${seed}:radio`)``), never `Math.random()`, so a replayed seed says the same
   things.

## Tone

- Radio-length: usually under 8 words, 12 at most. Lowercase-casual is fine. Swearing is
  bleeped (`"These tyres are ****ed!"`).
- Real F1 radio flavour ("Copy.", "Box, box.", "Tyres are gone!", "It's raining, turn 3!",
  "Why are we stopping?!") but no real driver or team names.
- Each pool has at least 3 variants so repeats feel rare. Sarcasm is for bad calls, not for
  every line.
- Engineer lines in the log are the player's transcript verbatim, not rewritten.
