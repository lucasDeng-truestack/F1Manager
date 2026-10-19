import { beforeAll, describe, expect, it } from 'vitest';
import {
  AI_PIT_LAP_MAX,
  AI_PIT_LAP_MIN,
  LAPS,
  PLAYER_ID,
  SIM_DT,
  TICK_MS,
  WEAR_CLIFF,
  createRace,
  type CarState,
  type Compound,
  type RaceState,
} from './index';
import { simulateRace } from './simulate';
import { lapCallsToInputs, trace, type LapCall } from './testkit';

// Strategy balance guard. Loose bounds on purpose: these protect the shape of the tyre
// model (stop > no-stop, one stop > two, push is a short-burst tool, save stretches a
// stint, the AI stops before the cliff), not exact lap times. If a tunable changes on
// purpose and a bound moves, re-run the sweep and re-pin with a reason.
//
// Pinned: the first 10 seeds of seed-0… with no safety car, rain or puncture.
const DRY_SEEDS = [
  'seed-1', 'seed-4', 'seed-9', 'seed-10', 'seed-12', 'seed-14', 'seed-18', 'seed-24', 'seed-28', 'seed-29',
] as const;

const box = (lap: number): LapCall => ({ lap, command: 'BOX' });
const planB = (lap: number): LapCall => ({ lap, command: 'PLAN_B' });

const STRATEGIES = {
  noStop: [],
  hardOn7: [box(7)],
  hardOn8: [box(8)],
  softOn8: [planB(1), box(8)],
  softOn9: [planB(1), box(9)],
  twoStopSoftSoft: [planB(1), box(5), box(10)],
  twoStopHardSoft: [box(5), planB(6), box(10)],
  hardOn7PushLast3: [box(7), { lap: LAPS - 2, command: 'PUSH' }],
  pushAllRace: [{ lap: 1, command: 'PUSH' }],
  saveAllRace: [{ lap: 1, command: 'SAVE_TYRES' }],
} satisfies Record<string, LapCall[]>;
type Strategy = keyof typeof STRATEGIES;
const ONE_STOPS: readonly Strategy[] = ['hardOn7', 'hardOn8', 'softOn8', 'softOn9'];
const TWO_STOPS: readonly Strategy[] = ['twoStopSoftSoft', 'twoStopHardSoft'];

const player = (s: RaceState): CarState => s.cars[PLAYER_ID]!;
const mean = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

/** results[strategy][seedIndex] = finished race. */
let results: Record<Strategy, RaceState[]>;
const time = (strategy: Strategy, i: number): number => player(results[strategy][i]!).finishTime!;
const bestOf = (strategies: readonly Strategy[], i: number): number => Math.min(...strategies.map((s) => time(s, i)));
const perSeed = <T>(f: (i: number) => T): T[] => DRY_SEEDS.map((_, i) => f(i));

beforeAll(() => {
  const entries = Object.entries(STRATEGIES).map(([name, calls]) => [
    name,
    DRY_SEEDS.map((seed) => simulateRace(seed, lapCallsToInputs(seed, calls))),
  ]);
  results = Object.fromEntries(entries) as Record<Strategy, RaceState[]>;
}, 120_000);

describe('balance: dry race strategies (pinned dry seeds)', () => {
  it('precondition: every pinned seed is dry with no events, and every race finishes', () => {
    for (const seed of DRY_SEEDS) {
      expect(createRace(seed).schedule, seed).toEqual({ safetyCarLap: null, safetyCarLaps: 0, rainLap: null, puncture: null });
    }
    for (const races of Object.values(results)) for (const r of races) expect(player(r).finishTime).not.toBeNull();
  });

  it('the strategy calls really happened (stops and compounds)', () => {
    DRY_SEEDS.forEach((_, i) => {
      expect(player(results.noStop[i]!).pitStops).toBe(0);
      expect(player(results.hardOn8[i]!).compound).toBe<Compound>('H');
      expect(player(results.softOn8[i]!).compound).toBe<Compound>('S');
      expect(player(results.twoStopSoftSoft[i]!).pitStops).toBe(2);
    });
  });

  it('the best one-stop beats no-stop in every seed, by roughly 8–20 s on average', () => {
    const gains = perSeed((i) => time('noStop', i) - bestOf(ONE_STOPS, i));
    for (const gain of gains) expect(gain).toBeGreaterThan(0);
    expect(mean(gains)).toBeGreaterThan(6);
    expect(mean(gains)).toBeLessThan(25);
  });

  it('no-stop runs into the cliff late in the race', () => {
    DRY_SEEDS.forEach((_, i) => {
      const race = results.noStop[i]!;
      expect(player(race).tyreWear).toBeGreaterThan(WEAR_CLIFF);
      const critical = race.eventLog.find((e) => e.type === 'TYRES_CRITICAL' && e.carId === PLAYER_ID);
      expect(critical?.lap).toBeGreaterThanOrEqual(LAPS - 4);
    });
  });

  it('two stops are never better than the best one-stop', () => {
    const margins = perSeed((i) => bestOf(TWO_STOPS, i) - bestOf(ONE_STOPS, i));
    for (const m of margins) expect(m).toBeGreaterThan(0);
    expect(mean(margins)).toBeGreaterThan(5);
  });

  it('zero calls almost never wins', () => {
    const wins = results.noStop.filter((r) => player(r).position === 1).length;
    expect(wins).toBeLessThanOrEqual(1);
  });

  it('PUSH for the last 3 laps on fresh-ish tyres gains time', () => {
    const gains = perSeed((i) => time('hardOn7', i) - time('hardOn7PushLast3', i));
    expect(mean(gains)).toBeGreaterThan(0.5);
  });

  it('PUSH all race on one set burns the tyres into the cliff: a net loss', () => {
    DRY_SEEDS.forEach((_, i) => {
      expect(player(results.pushAllRace[i]!).tyreWear).toBe(100);
      expect(time('pushAllRace', i)).toBeGreaterThan(time('noStop', i) + 10);
    });
  });

  it('SAVE_TYRES stretches a stint below the cliff, but a good stop is still faster on average', () => {
    DRY_SEEDS.forEach((_, i) => {
      expect(player(results.saveAllRace[i]!).tyreWear).toBeLessThan(WEAR_CLIFF);
      expect(time('saveAllRace', i)).toBeLessThan(time('noStop', i));
    });
    expect(mean(perSeed((i) => time('saveAllRace', i) - bestOf(ONE_STOPS, i)))).toBeGreaterThan(0);
  });

  it('a race lasts about 6 minutes of real time', () => {
    const minutes = mean(
      perSeed((i) => (Math.min(...results.noStop[i]!.cars.map((c) => c.finishTime!)) / SIM_DT) * TICK_MS / 60_000),
    );
    expect(minutes).toBeGreaterThan(5.5);
    expect(minutes).toBeLessThan(7);
  });
});

describe('balance: AI strategy (pinned dry seeds, no player calls)', () => {
  interface Stint { compound: Compound; laps: number }
  const stopWear: number[] = [];
  const stopLaps: number[] = [];
  const finalWear: number[] = [];
  const stints: Stint[] = [];
  const stopsPerCar: number[] = [];

  beforeAll(() => {
    for (const seed of DRY_SEEDS) {
      const states = trace(seed);
      const final = states.at(-1)!;
      for (const e of final.eventLog) {
        if (e.type !== 'PIT_STOP' || e.carId === PLAYER_ID) continue;
        const before = states[e.tick]!.cars[e.carId!]!; // state the stopping step started from
        stopWear.push(before.tyreWear);
        stopLaps.push(before.lap);
        stints.push({ compound: before.compound, laps: before.tyreAgeLaps + 1 });
      }
      for (const c of final.cars.filter((car) => !car.isPlayer)) {
        finalWear.push(c.tyreWear);
        stopsPerCar.push(c.pitStops);
        stints.push({ compound: c.compound, laps: c.tyreAgeLaps });
      }
    }
  }, 120_000);

  it('every AI car makes exactly one stop, inside its pit window', () => {
    for (const n of stopsPerCar) expect(n).toBe(1);
    for (const lap of stopLaps) {
      expect(lap).toBeGreaterThanOrEqual(AI_PIT_LAP_MIN);
      expect(lap).toBeLessThanOrEqual(AI_PIT_LAP_MAX);
    }
  });

  it('AI cars stop before the cliff and finish on tyres short of it', () => {
    for (const w of stopWear) expect(w).toBeLessThan(WEAR_CLIFF);
    for (const w of finalWear) expect(w).toBeLessThan(WEAR_CLIFF);
  });

  it('soft stints are shorter than hard stints', () => {
    const avgLaps = (compound: Compound) => mean(stints.filter((s) => s.compound === compound).map((s) => s.laps));
    expect(stints.some((s) => s.compound === 'S')).toBe(true);
    expect(stints.some((s) => s.compound === 'H')).toBe(true);
    expect(avgLaps('S')).toBeLessThan(avgLaps('H'));
  });
});
