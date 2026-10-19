// Test-only helpers for the src/sim suites. Not exported from index.ts.
import { PLAYER_ID } from './constants';
import { createRace } from './init';
import { at } from './model';
import { createRng } from './rng';
import { step } from './step';
import type { Command, CommandInput, RaceState } from './types';

/** Every state of a race: [createRace(seed), after step 1, …, finished]. */
export function trace(seed: string, inputs: readonly CommandInput[] = []): RaceState[] {
  const rng = createRng(seed, 'race');
  let state = createRace(seed);
  const states = [state];
  while (state.phase !== 'finished') {
    const tick = state.tick;
    const commands: Command[] = inputs.filter((i) => i.tick === tick).map((i) => i.command);
    state = step(state, commands, rng);
    states.push(state);
  }
  return states;
}

/** First tick (state.tick) at which `predicate` holds, or -1. */
export function firstTick(states: readonly RaceState[], predicate: (s: RaceState) => boolean): number {
  return states.find(predicate)?.tick ?? -1;
}

export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

/** A strategy call expressed in laps: issue `command` on the first tick the player is on `lap` or later. */
export interface LapCall { lap: number; command: Command }

/**
 * Turns lap-based calls (sorted by lap) into tick-based inputs by stepping the race until
 * the last call is issued, so a later call sees the effect of earlier ones (e.g. a stop).
 * Feeding the result to simulateRace replays exactly that race.
 */
export function lapCallsToInputs(seed: string, calls: readonly LapCall[]): CommandInput[] {
  const rng = createRng(seed, 'race');
  let state = createRace(seed);
  const inputs: CommandInput[] = [];
  let next = 0;
  while (next < calls.length && state.phase !== 'finished') {
    const commands: Command[] = [];
    for (let call = calls[next]; call !== undefined && at(state.cars, PLAYER_ID).lap >= call.lap; call = calls[next]) {
      commands.push(call.command);
      inputs.push({ tick: state.tick, command: call.command });
      next += 1;
    }
    state = step(state, commands, rng);
  }
  return inputs;
}
