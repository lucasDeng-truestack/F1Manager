import { describe, expect, it } from 'vitest';
import {
  FIELD_SIZE,
  RACE_TICK_LIMIT,
  createRace,
  createRng,
  simulateRace,
  step,
  type CommandInput,
  type RaceState,
} from './index';
import { deepFreeze, trace } from './testkit';

// Pinned: safety car + rain in one race, so events, pit stops and overtakes all run.
const EVENTFUL_SEED = 'd';
const INPUTS: CommandInput[] = [
  { tick: 0, command: 'PUSH' },
  { tick: 300, command: 'PLAN_B' },
  { tick: 900, command: 'SAVE_TYRES' },
  { tick: 1500, command: 'BOX' },
  { tick: 1500, command: 'DEFEND' },
  { tick: 2600, command: 'COPY' },
];

describe('determinism', () => {
  it('same seed + same inputs → identical race', () => {
    const a = simulateRace(EVENTFUL_SEED, INPUTS);
    const b = simulateRace(EVENTFUL_SEED, INPUTS);
    expect(a.phase).toBe('finished');
    expect(a).toEqual(b);
  });

  it('createRace is deterministic and builds a full grid', () => {
    const a = createRace('monza-42');
    expect(a).toEqual(createRace('monza-42'));
    expect(a.cars).toHaveLength(FIELD_SIZE);
    expect([...a.order].sort((x, y) => x - y)).toEqual(a.cars.map((c) => c.id));
    expect(a.eventLog).toEqual([{ tick: 0, lap: 1, type: 'LIGHTS_OUT' }]);
    const pole = a.cars[a.order[0]!]!;
    expect(Object.is(pole.distance, 0)).toBe(true); // +0, not -0
    expect(a.cars.every((c) => c.distance <= 0)).toBe(true);
  });

  it('draws exactly FIELD_SIZE − 1 race-stream values per tick over a whole eventful race', () => {
    // SC, rain, pit stops, finishes: the count never depends on what happens, so a
    // counterfactual re-sim (evaluateCalls) sees the same roll on every tick.
    let draws = 0;
    const inner = createRng(EVENTFUL_SEED, 'race');
    const counting = () => {
      draws += 1;
      return inner();
    };
    let state = createRace(EVENTFUL_SEED);
    while (state.phase !== 'finished') {
      const tick = state.tick;
      state = step(state, INPUTS.filter((i) => i.tick === tick).map((i) => i.command), counting);
    }
    expect(state.eventLog.some((e) => e.type === 'PIT_STOP')).toBe(true);
    expect(draws).toBe(state.tick * (FIELD_SIZE - 1));
  });

  it('reaching RACE_TICK_LIMIT ends the race even if cars are still running', () => {
    const start = createRace(EVENTFUL_SEED);
    const late: RaceState = { ...start, tick: RACE_TICK_LIMIT - 1 };
    const next = step(late, [], createRng(EVENTFUL_SEED, 'race'));
    expect(next.tick).toBe(RACE_TICK_LIMIT);
    expect(next.phase).toBe('finished');
    expect(next.cars.some((c) => c.finishTime === null)).toBe(true);
  });

  it('a manual step loop equals simulateRace', () => {
    const states = trace(EVENTFUL_SEED, INPUTS);
    expect(states.at(-1)).toEqual(simulateRace(EVENTFUL_SEED, INPUTS));
  });

  it('different seeds → different races', () => {
    const a = simulateRace('alpha', []);
    const b = simulateRace('bravo', []);
    expect(a.order).not.toEqual(b.order);
    expect(a.cars.map((c) => c.finishTime)).not.toEqual(b.cars.map((c) => c.finishTime));
  });

  it('step never mutates its input state (deep-frozen, every tick)', () => {
    const rng = createRng(EVENTFUL_SEED, 'race');
    let state: RaceState = createRace(EVENTFUL_SEED);
    while (state.phase !== 'finished') {
      const tick = state.tick;
      const snapshot = structuredClone(state);
      deepFreeze(state);
      const next = step(state, INPUTS.filter((i) => i.tick === tick).map((i) => i.command), rng);
      expect(state).toEqual(snapshot);
      state = next;
    }
  });

  it('step on a finished race returns it unchanged', () => {
    const done = simulateRace('alpha', []);
    expect(step(done, ['PUSH'], createRng('alpha', 'race'))).toBe(done);
  });

  it('draws exactly FIELD_SIZE − 1 race-stream values per tick', () => {
    let draws = 0;
    const counting = (() => {
      const inner = createRng('alpha', 'race');
      return () => {
        draws += 1;
        return inner();
      };
    })();
    let state = createRace('alpha');
    for (let i = 0; i < 500; i += 1) state = step(state, i === 10 ? ['PUSH'] : [], counting);
    expect(draws).toBe(500 * (FIELD_SIZE - 1));
  });

  it('positions are a permutation and match order every tick', () => {
    for (const s of trace(EVENTFUL_SEED, INPUTS)) {
      s.order.forEach((id, index) => expect(s.cars[id]?.position).toBe(index + 1));
      s.cars.forEach((c, id) => expect(c.id).toBe(id));
    }
  });
});
