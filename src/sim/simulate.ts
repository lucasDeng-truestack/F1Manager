import { LAPS, PLAYER_ID } from './constants';
import { createRace } from './init';
import { at, lapTimeFor } from './model';
import { createRng } from './rng';
import { step } from './step';
import type { CallImpact, Command, CommandInput, RaceState } from './types';

/** Commands per tick, each tick's list in input order. */
function groupByTick(inputs: readonly CommandInput[]): Map<number, Command[]> {
  const byTick = new Map<number, Command[]>();
  for (const input of inputs) {
    const list = byTick.get(input.tick);
    if (list === undefined) byTick.set(input.tick, [input.command]);
    else list.push(input.command);
  }
  return byTick;
}

const NO_COMMANDS: readonly Command[] = [];

/**
 * Runs a whole race headlessly: createRace + the `race` stream, each input applied at
 * the start of its tick. Inputs whose tick is never reached (negative, fractional, or
 * after the race ends) are ignored.
 */
export function simulateRace(seed: string, inputs: readonly CommandInput[]): RaceState {
  const rng = createRng(seed, 'race');
  const byTick = groupByTick(inputs);
  let state = createRace(seed);
  while (state.phase !== 'finished') {
    state = step(state, byTick.get(state.tick) ?? NO_COMMANDS, rng);
  }
  return state;
}

/**
 * The player's race time used for comparisons. finishTime when the car finished;
 * otherwise (RACE_TICK_LIMIT hit) an estimate: elapsed time + remaining laps at its pace.
 */
function playerRaceTime(state: RaceState): number {
  const car = at(state.cars, PLAYER_ID);
  if (car.finishTime !== null) return car.finishTime;
  return state.time + car.pitTimeRemaining + Math.max(0, LAPS - car.distance) * lapTimeFor(car, state);
}

/**
 * Counterfactual value of call `index`: re-simulate the race without `inputs[index]` and
 * compare with `base`, which must be `simulateRace(seed, inputs)` (computed once by the
 * caller and shared across calls). Exact because the `race` stream draws a fixed number of
 * values per tick, so removing a call changes only what the call itself changes.
 * Throws for an `index` outside `inputs`.
 */
export function evaluateCall(
  seed: string,
  inputs: readonly CommandInput[],
  index: number,
  base: RaceState,
): CallImpact {
  const input = at(inputs, index);
  const alt = simulateRace(
    seed,
    inputs.filter((_, k) => k !== index),
  );
  const applied = base.eventLog.find(
    (e) => e.type === 'COMMAND_APPLIED' && e.tick === input.tick && e.command === input.command,
  );
  return {
    tick: input.tick,
    lap: applied?.lap ?? base.leaderLap,
    command: input.command,
    timeDelta: playerRaceTime(alt) - playerRaceTime(base),
    positionDelta: at(alt.cars, PLAYER_ID).position - at(base.cars, PLAYER_ID).position,
  };
}

/** Counterfactual value of every call, in input order (see `evaluateCall`). */
export function evaluateCalls(seed: string, inputs: readonly CommandInput[]): CallImpact[] {
  const base = simulateRace(seed, inputs);
  return inputs.map((_, i) => evaluateCall(seed, inputs, i, base));
}
