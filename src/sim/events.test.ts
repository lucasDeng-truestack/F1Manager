import { describe, expect, it } from 'vitest';
import {
  COMPOUND_PACE,
  LAPS,
  PLAYER_ID,
  PUNCTURE_PACE_LOSS,
  RAIN_LAP_TIME_DELTA,
  WET_COMPOUND,
  createRace,
  lapTimeFor,
  simulateRace,
  type RaceEventType,
  type RaceState,
} from './index';
import { trace } from './testkit';

// Pinned seeds, found by scanning `seed-0`…`seed-299` for races with exactly one event.
// If a tunable or the events-stream draw order changes, these must be re-pinned.
const NO_EVENTS_SEED = 'seed-1';
const SC_SEED = 'seed-41'; // safety car on lap 11 for 3 laps, field well spread by then
const RAIN_SEED = 'seed-0';
const AI_PUNCTURE_SEED = 'seed-6';
const PLAYER_PUNCTURE_SEED = 'seed-74';

const ofType = (s: RaceState, type: RaceEventType) => s.eventLog.filter((e) => e.type === type);

describe('event schedule (pinned seeds)', () => {
  it('no-events seed', () => {
    expect(createRace(NO_EVENTS_SEED).schedule).toEqual({ safetyCarLap: null, safetyCarLaps: 0, rainLap: null, puncture: null });
    const race = simulateRace(NO_EVENTS_SEED, []);
    for (const t of ['SAFETY_CAR_DEPLOYED', 'SAFETY_CAR_IN', 'RAIN_START', 'PUNCTURE'] as const) {
      expect(ofType(race, t)).toHaveLength(0);
    }
    expect(race.weather).toBe('dry');
  });

  it('pinned schedules', () => {
    expect(createRace(SC_SEED).schedule).toEqual({ safetyCarLap: 11, safetyCarLaps: 3, rainLap: null, puncture: null });
    expect(createRace(RAIN_SEED).schedule).toEqual({ safetyCarLap: null, safetyCarLaps: 0, rainLap: 5, puncture: null });
    expect(createRace(AI_PUNCTURE_SEED).schedule).toEqual({
      safetyCarLap: null, safetyCarLaps: 0, rainLap: null, puncture: { carId: 5, lap: 5 },
    });
    expect(createRace(PLAYER_PUNCTURE_SEED).schedule).toEqual({
      safetyCarLap: null, safetyCarLaps: 0, rainLap: null, puncture: { carId: PLAYER_ID, lap: 5 },
    });
  });

  it('every race starts with LIGHTS_OUT and ends with a chequered flag per car and one FINAL_LAP', () => {
    const race = simulateRace(SC_SEED, []);
    expect(race.eventLog[0]).toEqual({ tick: 0, lap: 1, type: 'LIGHTS_OUT' });
    expect(ofType(race, 'FINAL_LAP')).toEqual([expect.objectContaining({ lap: LAPS })]);
    expect(ofType(race, 'CHEQUERED_FLAG').map((e) => e.carId).sort()).toEqual(race.cars.map((c) => c.id));
    expect(race.phase).toBe('finished');
  });

  it('event payloads: which optional fields each type carries', () => {
    const seeds = [SC_SEED, RAIN_SEED, AI_PUNCTURE_SEED, PLAYER_PUNCTURE_SEED];
    const seen = new Set<RaceEventType>();
    for (const [seed, boxTick] of seeds.flatMap((s) => [[s, 1200], [s, -1]] as const)) {
      // PUSH all race on one set (boxTick −1 is never reached) guarantees TYRES_CRITICAL.
      const race = simulateRace(seed, [{ tick: 0, command: 'PUSH' }, { tick: boxTick, command: 'BOX' }]);
      for (const e of race.eventLog) {
        seen.add(e.type);
        const fields = Object.keys(e).filter((k) => !['tick', 'lap', 'type'].includes(k)).sort();
        const expected: Record<RaceEventType, string[]> = {
          LIGHTS_OUT: [], FINAL_LAP: [], SAFETY_CAR_DEPLOYED: [], SAFETY_CAR_IN: [], RAIN_START: [],
          CHEQUERED_FLAG: ['carId'], PUNCTURE: ['carId'], TYRES_CRITICAL: ['carId'],
          PIT_STOP: ['carId', 'compound'], OVERTAKE: ['carId', 'otherCarId'], COMMAND_APPLIED: ['carId', 'command'],
        };
        expect(fields, `${seed} ${e.type}`).toEqual(expected[e.type]);
      }
      const flags = ofType(race, 'CHEQUERED_FLAG');
      expect(new Set(flags.map((e) => e.carId)).size).toBe(flags.length); // once per car
    }
    expect(seen.size).toBe(11); // every RaceEventType was checked
  });

  it('final classification follows finishTime, ties broken by id', () => {
    const race = simulateRace(RAIN_SEED, []);
    const byFinish = [...race.cars].sort((a, b) => a.finishTime! - b.finishTime! || a.id - b.id).map((c) => c.id);
    expect(race.order).toEqual(byFinish);
    race.order.forEach((id, i) => expect(race.cars[id]!.position).toBe(i + 1));
  });
});

describe('safety car', () => {
  const states = trace(SC_SEED);
  const final = states.at(-1)!;
  const deployed = ofType(final, 'SAFETY_CAR_DEPLOYED');
  const ended = ofType(final, 'SAFETY_CAR_IN');

  it('deploys once on its lap and comes in after its laps', () => {
    expect(deployed).toHaveLength(1);
    expect(ended).toHaveLength(1);
    expect(deployed[0]!.lap).toBe(11);
    const leaderAt = (tick: number) => states[tick]!.cars[states[tick]!.order[0]!]!.distance;
    expect(leaderAt(ended[0]!.tick) - leaderAt(deployed[0]!.tick)).toBeGreaterThanOrEqual(3);
  });

  it('closes up the field and forbids overtakes', () => {
    const start = deployed[0]!.tick;
    const end = ended[0]!.tick;
    const pittedDuringSc = new Set(
      final.eventLog.filter((e) => e.type === 'PIT_STOP' && e.tick >= start && e.tick <= end).map((e) => e.carId),
    );
    const spread = (s: RaceState) => {
      const ds = s.cars.filter((c) => !pittedDuringSc.has(c.id)).map((c) => c.distance);
      return Math.max(...ds) - Math.min(...ds);
    };
    expect(pittedDuringSc.size).toBeLessThan(9);
    expect(spread(states[end]!)).toBeLessThan(spread(states[start]!) * 0.5);
    expect(final.eventLog.some((e) => e.type === 'OVERTAKE' && e.tick > start && e.tick < end)).toBe(false);
  });
});

describe('rain', () => {
  const states = trace(RAIN_SEED);
  const final = states.at(-1)!;

  it('starts on its lap and lasts to the end', () => {
    const rain = ofType(final, 'RAIN_START');
    expect(rain).toHaveLength(1);
    expect(rain[0]!.lap).toBe(5);
    expect(final.rainStartedLap).toBe(5);
    expect(states.slice(rain[0]!.tick + 1).every((s) => s.weather === 'wet')).toBe(true);
  });

  it('makes slick lap times worse and inters better than slicks', () => {
    const car = final.cars[PLAYER_ID]!;
    const dry = { weather: 'dry' as const };
    const wet = { weather: 'wet' as const };
    for (const compound of ['S', 'M', 'H'] as const) {
      const slick = { ...car, compound };
      expect(lapTimeFor(slick, wet) - lapTimeFor(slick, dry)).toBeCloseTo(
        COMPOUND_PACE[compound].wet - COMPOUND_PACE[compound].dry + RAIN_LAP_TIME_DELTA,
      );
      expect(lapTimeFor({ ...car, compound: 'I' }, wet)).toBeLessThan(lapTimeFor(slick, wet));
    }
  });

  it('AI cars switch to inters', () => {
    const rainTick = ofType(final, 'RAIN_START')[0]!.tick;
    const wetStops = final.eventLog.filter((e) => e.type === 'PIT_STOP' && e.tick > rainTick);
    expect(wetStops.length).toBeGreaterThan(0);
    for (const e of wetStops) expect(e.compound).toBe(WET_COMPOUND);
    for (const c of final.cars.filter((c) => !c.isPlayer)) expect(c.compound).toBe('I');
  });
});

describe('puncture', () => {
  it('AI car: punctured on its lap, auto-boxes at the next line and the puncture is cleared', () => {
    const states = trace(AI_PUNCTURE_SEED);
    const final = states.at(-1)!;
    const punctures = ofType(final, 'PUNCTURE');
    expect(punctures).toEqual([expect.objectContaining({ carId: 5 })]);
    const t = punctures[0]!.tick;
    expect(states[t]!.cars[5]!.lap).toBe(5);
    expect(states[t + 1]!.cars[5]!.punctured).toBe(true);
    expect(states[t + 1]!.cars[5]!.boxQueued).toBe(true);
    const stop = final.eventLog.find((e) => e.type === 'PIT_STOP' && e.carId === 5 && e.tick > t)!;
    expect(states[stop.tick + 1]!.cars[5]!.punctured).toBe(false);
    expect(states[stop.tick + 1]!.cars[5]!.lap).toBe(6);
  });

  it('player: big lap-time loss, no automatic box, BOX fixes it', () => {
    const states = trace(PLAYER_PUNCTURE_SEED);
    const final = states.at(-1)!;
    const t = ofType(final, 'PUNCTURE')[0]!.tick;
    expect(final.cars[PLAYER_ID]!.punctured).toBe(true);
    expect(final.eventLog.some((e) => e.type === 'PIT_STOP' && e.carId === PLAYER_ID)).toBe(false);

    // Completed lap times: lap 4 (healthy) vs lap 5 (punctured from its start).
    const lapTimeOf = (lap: number) => states.find((s) => s.cars[PLAYER_ID]!.lap === lap + 1)!.cars[PLAYER_ID]!.lastLapTime!;
    expect(lapTimeOf(5) - lapTimeOf(4)).toBeGreaterThan(PUNCTURE_PACE_LOSS - 3);

    const fixed = simulateRace(PLAYER_PUNCTURE_SEED, [{ tick: t + 1, command: 'BOX' }]);
    expect(fixed.cars[PLAYER_ID]!.punctured).toBe(false);
    expect(fixed.cars[PLAYER_ID]!.finishTime!).toBeLessThan(final.cars[PLAYER_ID]!.finishTime!);
  });
});
