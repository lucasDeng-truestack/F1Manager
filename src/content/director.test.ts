import seedrandom from 'seedrandom';
import { describe, expect, it } from 'vitest';
import {
  LAPS, PIT_LOSS, PIT_LOSS_SC, PLAYER_ID, RACE_TICK_LIMIT, RADIO_COOLDOWN_TICKS, RADIO_PODIUM_LAST, RADIO_POINTS_LAST, SIM_DT,
} from '../sim/constants';
import { createRace, createRng, step } from '../sim';
import type { CarState, Command, Compound, RaceEvent, RaceState } from '../sim/types';
import {
  createRadioMemory, MAX_UNPROMPTED_PER_STEP, pickLine, respond, unpromptedCalls, UNPROMPTED_PRIORITY,
  type RadioMemory,
} from './director';
import { responses, sayAgain, type Pool } from './responses';
import { ev, lcg, makeRace } from './testFixtures';
import { pitExit, unprompted, type UnpromptedTrigger } from './unprompted';

const COMMANDS: readonly Command[] = ['BOX', 'PUSH', 'SAVE_TYRES', 'DEFEND', 'PLAN_B', 'COPY'];

function allPools(): [string, Pool][] {
  const out: [string, Pool][] = [['say_again', sayAgain]];
  for (const c of COMMANDS) for (const [k, p] of Object.entries(responses[c]) as [string, Pool][]) out.push([`${c}.${k}`, p]);
  for (const [k, p] of Object.entries(unprompted) as [string, Pool][]) out.push([k, p]);
  for (const [k, p] of Object.entries(pitExit) as [string, Pool][]) out.push([`pit_exit.${k}`, p]);
  return out;
}

const constRng = (v: number) => () => v;

function fire(events: RaceEvent[], memory: RadioMemory = createRadioMemory(), tick = 1000, player = {}) {
  const prev = makeRace({ state: { tick: tick - 1 } });
  const next = makeRace({ tickEvents: events, state: { tick }, player });
  return unpromptedCalls(prev, next, memory, lcg(7));
}

/** One step from `before` to `after` player state (tick 999 → 1000). */
function rejoin(before: Partial<CarState>, after: Partial<CarState>, events: RaceEvent[] = [], state: Partial<RaceState> = {}) {
  const prev = makeRace({ player: before, state: { ...state, tick: 999 } });
  const next = makeRace({ player: after, tickEvents: events, state: { ...state, tick: 1000 } });
  return unpromptedCalls(prev, next, createRadioMemory(), lcg(7));
}

describe('tables', () => {
  it('every command has a default pool', () => {
    for (const c of COMMANDS) expect(responses[c].default.length).toBeGreaterThanOrEqual(3);
  });

  it.each(allPools())('%s: ≥ 3 lines, each ≤ 12 words, no duplicates', (_k, pool) => {
    expect(pool.length).toBeGreaterThanOrEqual(3);
    expect(new Set(pool).size).toBe(pool.length);
    for (const line of pool) {
      expect(line.trim().length).toBeGreaterThan(0);
      expect(line.split(/\s+/).length).toBeLessThanOrEqual(12);
    }
  });
});

describe('pickLine', () => {
  it('maps rng to an index and clamps rng() === 1', () => {
    const pool: Pool = ['a', 'b', 'c'];
    expect(pickLine(pool, constRng(0))).toBe('a');
    expect(pickLine(pool, constRng(0.5))).toBe('b');
    expect(pickLine(pool, constRng(0.999))).toBe('c');
    expect(pickLine(pool, constRng(1))).toBe('a');
  });
});

describe('respond', () => {
  it('returns a line from the classified pool', () => {
    const s = makeRace({ player: { lap: LAPS } });
    expect(responses.BOX.box_final_lap).toContain(respond(s, 'BOX', lcg(3)));
    expect(responses.SAVE_TYRES.save_final_lap).toContain(respond(s, 'SAVE_TYRES', lcg(3)));
    expect(responses.COPY.default).toContain(respond(s, 'COPY', lcg(3)));
    expect(responses.PLAN_B.to_plan_b).toContain(respond(s, 'PLAN_B', lcg(3)));
  });

  it('UNKNOWN uses the say-again pool', () => {
    expect(sayAgain).toContain(respond(makeRace(), 'UNKNOWN', lcg(1)));
  });

  it('is deterministic for the same rng sequence (fake and seedrandom)', () => {
    const s = makeRace();
    const run = (rng: () => number) => COMMANDS.map((c) => respond(s, c, rng));
    expect(run(lcg(42))).toEqual(run(lcg(42)));
    expect(run(seedrandom('monza-42:radio'))).toEqual(run(seedrandom('monza-42:radio')));
  });

  it('draws exactly once per reply', () => {
    let draws = 0;
    const rng = () => { draws += 1; return 0.3; };
    respond(makeRace(), 'PUSH', rng);
    respond(makeRace(), 'UNKNOWN', rng);
    expect(draws).toBe(2);
  });
});

describe('unpromptedCalls', () => {
  const single: [UnpromptedTrigger, RaceEvent[], object?][] = [
    ['lights_out', [ev('LIGHTS_OUT')]],
    ['tyres_gone', [ev('TYRES_CRITICAL', { carId: PLAYER_ID })]],
    ['rain', [ev('RAIN_START')]],
    ['safety_car_out', [ev('SAFETY_CAR_DEPLOYED')]],
    ['safety_car_in', [ev('SAFETY_CAR_IN')]],
    ['puncture', [ev('PUNCTURE', { carId: PLAYER_ID })]],
    ['overtake_made', [ev('OVERTAKE', { carId: PLAYER_ID, otherCarId: 3 })]],
    ['overtake_lost', [ev('OVERTAKE', { carId: 3, otherCarId: PLAYER_ID })]],
    ['final_lap', [ev('FINAL_LAP')]],
    ['finish_win', [ev('CHEQUERED_FLAG', { carId: PLAYER_ID })], { position: 1 }],
    ['finish_podium', [ev('CHEQUERED_FLAG', { carId: PLAYER_ID })], { position: 2 }],
    ['finish_podium', [ev('CHEQUERED_FLAG', { carId: PLAYER_ID })], { position: RADIO_PODIUM_LAST }],
    ['finish_points', [ev('CHEQUERED_FLAG', { carId: PLAYER_ID })], { position: RADIO_PODIUM_LAST + 1 }],
    ['finish_points', [ev('CHEQUERED_FLAG', { carId: PLAYER_ID })], { position: RADIO_POINTS_LAST }],
    ['finish_back', [ev('CHEQUERED_FLAG', { carId: PLAYER_ID })], { position: RADIO_POINTS_LAST + 1 }],
  ];

  it.each(single)('%s fires from its event', (trigger, events, player) => {
    const { lines, memory } = fire(events, createRadioMemory(), 1000, player ?? {});
    expect(lines).toHaveLength(1);
    expect(unprompted[trigger as Exclude<UnpromptedTrigger, 'pit_exit'>]).toContain(lines[0]);
    expect(memory.lastFired[trigger]).toBe(1000);
  });

  it.each<Compound>(['S', 'M', 'H', 'I'])('pit_exit fires on the rejoin step with the %s pool', (compound) => {
    const { lines, memory } = rejoin({ pitTimeRemaining: 0.2, compound }, { pitTimeRemaining: 0, compound });
    expect(lines).toHaveLength(1);
    expect(pitExit[compound]).toContain(lines[0]);
    expect(memory.lastFired.pit_exit).toBe(1000);
  });

  it('no pit_exit on the box-entry step (PIT_STOP event, car now stationary)', () => {
    const { lines, memory } = rejoin(
      { pitTimeRemaining: 0, compound: 'M' }, { pitTimeRemaining: PIT_LOSS, compound: 'S' },
      [ev('PIT_STOP', { carId: PLAYER_ID, compound: 'S' })],
    );
    expect(lines).toEqual([]);
    expect(memory.lastFired.pit_exit).toBeUndefined();
  });

  it('no pit_exit while still stationary, on track, or for the pre-race call', () => {
    expect(rejoin({ pitTimeRemaining: 10 }, { pitTimeRemaining: 10 - SIM_DT }).lines).toEqual([]);
    expect(rejoin({ pitTimeRemaining: 0 }, { pitTimeRemaining: 0 }).lines).toEqual([]);
    const parked = makeRace({ player: { pitTimeRemaining: 5 } });
    expect(unpromptedCalls(parked, parked, createRadioMemory(), lcg(1)).lines).toEqual([]);
  });

  it('pit_exit fires after a safety-car stop too', () => {
    const sc = { safetyCar: { active: true, endsAtLeaderDistance: 8 } };
    const { lines } = rejoin({ pitTimeRemaining: 0.1, compound: 'H' }, { pitTimeRemaining: 0, compound: 'H' }, [], sc);
    expect(lines).toHaveLength(1);
    expect(pitExit.H).toContain(lines[0]);
  });

  it('another car rejoining, or a missing player car, raises nothing', () => {
    const prev = makeRace();
    const next = makeRace();
    prev.cars[3] = { ...(prev.cars[3] as CarState), pitTimeRemaining: 0.1 };
    expect(unpromptedCalls(prev, next, createRadioMemory(), lcg(1)).lines).toEqual([]);
    const empty = { ...makeRace(), cars: [] };
    expect(unpromptedCalls(empty, next, createRadioMemory(), lcg(1)).lines).toEqual([]);
    expect(unpromptedCalls(prev, empty, createRadioMemory(), lcg(1)).lines).toEqual([]);
  });

  it('does not mutate prev or next', () => {
    const prev = makeRace({ player: { pitTimeRemaining: 0.2 }, state: { tick: 999 } });
    const next = makeRace({ player: { pitTimeRemaining: 0 }, tickEvents: [ev('RAIN_START')] });
    const before = structuredClone([prev, next]);
    unpromptedCalls(prev, next, createRadioMemory(), lcg(1));
    expect([prev, next]).toEqual(before);
  });

  it('ignores other cars’ player-specific events and command echoes', () => {
    const { lines, memory } = fire([
      ev('TYRES_CRITICAL', { carId: 4 }), ev('PUNCTURE', { carId: 2 }), ev('PIT_STOP', { carId: 5, compound: 'H' }),
      ev('OVERTAKE', { carId: 2, otherCarId: 3 }), ev('CHEQUERED_FLAG', { carId: 1 }),
      ev('COMMAND_APPLIED', { carId: PLAYER_ID, command: 'BOX' }),
    ]);
    expect(lines).toEqual([]);
    expect(memory.lastFired).toEqual({});
  });

  it('no events → no lines and no rng draws', () => {
    let draws = 0;
    const s = makeRace();
    const out = unpromptedCalls(s, s, createRadioMemory(), () => { draws += 1; return 0; });
    expect(out.lines).toEqual([]);
    expect(draws).toBe(0);
  });

  it('cooldown suppresses a repeat within RADIO_COOLDOWN_TICKS and allows it after', () => {
    const e = [ev('TYRES_CRITICAL', { carId: PLAYER_ID })];
    const first = fire(e, createRadioMemory(), 1000);
    expect(first.lines).toHaveLength(1);
    const blocked = fire(e, first.memory, 1000 + RADIO_COOLDOWN_TICKS - 1);
    expect(blocked.lines).toEqual([]);
    expect(blocked.memory.lastFired.tyres_gone).toBe(1000);
    const again = fire(e, blocked.memory, 1000 + RADIO_COOLDOWN_TICKS);
    expect(again.lines).toHaveLength(1);
    expect(again.memory.lastFired.tyres_gone).toBe(1000 + RADIO_COOLDOWN_TICKS);
  });

  it('cooldown is per trigger', () => {
    const first = fire([ev('OVERTAKE', { carId: PLAYER_ID, otherCarId: 3 })]);
    const lost = fire([ev('OVERTAKE', { carId: 3, otherCarId: PLAYER_ID })], first.memory, 1010);
    expect(unprompted.overtake_lost).toContain(lost.lines[0]);
  });

  it('caps lines per step and follows the priority order', () => {
    const { lines, memory } = fire([
      ev('FINAL_LAP'), ev('OVERTAKE', { carId: PLAYER_ID, otherCarId: 1 }), ev('PUNCTURE', { carId: PLAYER_ID }),
      ev('SAFETY_CAR_DEPLOYED'),
    ]);
    expect(lines).toHaveLength(MAX_UNPROMPTED_PER_STEP);
    expect(unprompted.puncture).toContain(lines[0]);
    expect(unprompted.safety_car_out).toContain(lines[1]);
    expect(memory.lastFired.overtake_made).toBeUndefined();
    expect(memory.lastFired.final_lap).toBeUndefined();
  });

  it('priority list covers every trigger exactly once', () => {
    const all = [...Object.keys(unprompted), 'pit_exit'].sort();
    expect([...UNPROMPTED_PRIORITY].sort()).toEqual(all);
  });

  it('does not mutate the input memory', () => {
    const memory: RadioMemory = { lastFired: { rain: 10 } };
    const frozen = structuredClone(memory);
    const out = fire([ev('LIGHTS_OUT'), ev('RAIN_START')], memory);
    expect(memory).toEqual(frozen);
    expect(out.memory).not.toBe(memory);
    expect(out.memory.lastFired).not.toBe(memory.lastFired);
    expect(out.memory.lastFired).toEqual({ rain: 1000, lights_out: 1000 });
  });

  it('is deterministic for the same seed', () => {
    const events = [ev('RAIN_START'), ev('OVERTAKE', { carId: 2, otherCarId: PLAYER_ID })];
    const run = () => {
      const rng = seedrandom('monza-42:radio');
      const s = makeRace({ tickEvents: events });
      return unpromptedCalls(s, s, createRadioMemory(), rng).lines;
    };
    expect(run()).toEqual(run());
  });
});

// End-to-end against the real sim: the driver must not speak on box entry, only on rejoin.
describe('pit_exit timing in a simulated race', () => {
  const EXIT_LINES = new Set<string>(Object.values(pitExit).flat());
  type Step = { prev: RaceState; next: RaceState; lines: string[] };

  /** Runs `seed`, sending BOX once on the first tick where `boxWhen` holds. */
  function drive(seed: string, boxWhen: (s: RaceState) => boolean): Step[] {
    const raceRng = createRng(seed, 'race');
    const radioRng = createRng(seed, 'radio');
    let state = createRace(seed);
    let memory = createRadioMemory();
    let boxed = false;
    const steps: Step[] = [];
    while (state.phase !== 'finished' && state.tick < RACE_TICK_LIMIT) {
      const commands: Command[] = [];
      if (!boxed && boxWhen(state)) { boxed = true; commands.push('BOX'); }
      const next = step(state, commands, raceRng);
      const out = unpromptedCalls(state, next, memory, radioRng);
      memory = out.memory;
      steps.push({ prev: state, next, lines: out.lines });
      state = next;
    }
    return steps;
  }

  /** Index of the player's box entry and rejoin steps; asserts the radio around them. */
  function checkStop(steps: Step[]): { entry: Step; exit: Step } {
    const entryIdx = steps.findIndex((s) => s.next.tickEvents.some((e) => e.type === 'PIT_STOP' && e.carId === PLAYER_ID));
    const exitIdx = steps.findIndex((s) => (s.prev.cars[PLAYER_ID]?.pitTimeRemaining ?? 0) > 0 && s.next.cars[PLAYER_ID]?.pitTimeRemaining === 0);
    expect(entryIdx).toBeGreaterThanOrEqual(0);
    expect(exitIdx).toBeGreaterThan(entryIdx + 1);
    const entry = steps[entryIdx] as Step;
    const exit = steps[exitIdx] as Step;
    const fitted = entry.next.tickEvents.find((e) => e.type === 'PIT_STOP' && e.carId === PLAYER_ID)?.compound;
    expect(fitted).toBeDefined();

    expect(entry.lines.filter((l) => EXIT_LINES.has(l))).toEqual([]);
    const exitLines = exit.lines.filter((l) => EXIT_LINES.has(l));
    expect(exitLines).toHaveLength(1);
    expect(pitExit[fitted as Compound]).toContain(exitLines[0]);
    // Exactly one pit-exit line in the whole race, and it is the rejoin step's.
    expect(steps.flatMap((s) => s.lines).filter((l) => EXIT_LINES.has(l))).toEqual(exitLines);
    return { entry, exit };
  }

  it('green-flag stop: silent on entry, one line on rejoin naming the fitted compound', () => {
    const { entry } = checkStop(drive('monza-42', (s) => s.tick === 0));
    expect(entry.next.cars[PLAYER_ID]?.pitTimeRemaining).toBe(PIT_LOSS);
  });

  it('safety-car stop: same timing', () => {
    // First seed (in a fixed list) with a safety car, so a sim retune cannot strand a pinned seed.
    const seed = Array.from({ length: 500 }, (_, i) => `pit-exit-sc-${i}`)
      .find((s) => createRace(s).schedule.safetyCarLap !== null);
    expect(seed).toBeDefined();
    const { entry } = checkStop(drive(seed as string, (s) => s.safetyCar.active));
    expect(entry.next.cars[PLAYER_ID]?.pitTimeRemaining).toBe(PIT_LOSS_SC);
  });
});
