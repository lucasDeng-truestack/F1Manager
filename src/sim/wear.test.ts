import { describe, expect, it } from 'vitest';
import {
  PLAYER_ID,
  TYRE_CRITICAL_WEAR,
  WEAR_CLIFF,
  createRace,
  createRng,
  lapTimeFor,
  step,
  type Command,
  type RaceState,
} from './index';
import { firstTick, trace } from './testkit';

const NO_EVENTS_SEED = 'seed-1';
const player = (s: RaceState) => s.cars[PLAYER_ID]!;

/** Player wear the first time it is on `lap` (laps − 1 completed), mode set at tick 0. */
function wearOnLap(mode: Command | null, lap: number): number {
  const states = trace(NO_EVENTS_SEED, mode === null ? [] : [{ tick: 0, command: mode }]);
  const tick = firstTick(states, (s) => player(s).lap >= lap);
  return player(states[tick]!).tyreWear;
}

describe('tyre wear', () => {
  it('rises every lap of a stint', () => {
    const states = trace(NO_EVENTS_SEED);
    const atLineCrossings: number[] = [];
    for (let i = 1; i < states.length; i += 1) {
      if (player(states[i]!).lap !== player(states[i - 1]!).lap) atLineCrossings.push(player(states[i]!).tyreWear);
    }
    expect(atLineCrossings.length).toBeGreaterThanOrEqual(13);
    for (let i = 1; i < atLineCrossings.length; i += 1) {
      expect(atLineCrossings[i]!).toBeGreaterThan(atLineCrossings[i - 1]!);
    }
  });

  it('after 5 laps: push > normal > save', () => {
    const push = wearOnLap('PUSH', 6);
    const normal = wearOnLap(null, 6);
    const save = wearOnLap('SAVE_TYRES', 6);
    expect(push).toBeGreaterThan(normal);
    expect(normal).toBeGreaterThan(save);
  });

  it('lap time gets worse as wear rises, steeper past the cliff', () => {
    const state = createRace(NO_EVENTS_SEED);
    const car = player(state);
    const at = (tyreWear: number) => lapTimeFor({ ...car, tyreWear }, state);
    let previous = at(0);
    for (let wear = 10; wear <= 100; wear += 10) {
      const now = at(wear);
      expect(now).toBeGreaterThan(previous);
      previous = now;
    }
    const belowCliff = at(WEAR_CLIFF) - at(WEAR_CLIFF - 10);
    const aboveCliff = at(WEAR_CLIFF + 10) - at(WEAR_CLIFF);
    expect(aboveCliff).toBeGreaterThan(belowCliff);
  });

  it('wear is clamped to 100 (push all race on one set)', () => {
    const states = trace(NO_EVENTS_SEED, [{ tick: 0, command: 'PUSH' }]);
    for (const s of states) for (const c of s.cars) expect(c.tyreWear).toBeLessThanOrEqual(100);
    expect(player(states.at(-1)!).tyreWear).toBe(100);
    const critical = states.at(-1)!.eventLog.filter((e) => e.type === 'TYRES_CRITICAL' && e.carId === PLAYER_ID);
    expect(critical).toHaveLength(1); // once per stint
    const tick = critical[0]!.tick;
    expect(player(states[tick]!).tyreWear).toBeLessThan(TYRE_CRITICAL_WEAR);
    expect(player(states[tick + 1]!).tyreWear).toBeGreaterThanOrEqual(TYRE_CRITICAL_WEAR);
  });

  it('a car already at 99.99 % stays ≤ 100 after a step', () => {
    const start = createRace(NO_EVENTS_SEED);
    const worn: RaceState = { ...start, cars: start.cars.map((c) => ({ ...c, tyreWear: 99.99 })) };
    let s = worn;
    const rng = createRng(NO_EVENTS_SEED, 'race');
    for (let i = 0; i < 50; i += 1) s = step(s, [], rng);
    for (const c of s.cars) expect(c.tyreWear).toBe(100);
  });
});
