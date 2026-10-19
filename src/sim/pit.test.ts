import { describe, expect, it } from 'vitest';
import {
  LAPS,
  PIT_LOSS,
  PIT_LOSS_SC,
  PLAN_COMPOUND,
  PLAYER_ID,
  SIM_DT,
  WEAR_CLIFF,
  WEAR_PER_LAP,
  WET_COMPOUND,
  lapTimeFor,
  simulateRace,
  type CommandInput,
  type RaceState,
} from './index';
import { firstTick, trace } from './testkit';

// Pinned seeds (schedules asserted in events.test.ts).
const NO_EVENTS_SEED = 'seed-1';
const RAIN_SEED = 'seed-0'; // rain from leader lap 5, nothing else
const SC_SEED = 'seed-41'; // safety car on lap 11 for 3 laps, nothing else

const player = (s: RaceState) => s.cars[PLAYER_ID]!;
const playerStops = (s: RaceState) => s.eventLog.filter((e) => e.type === 'PIT_STOP' && e.carId === PLAYER_ID);

/** Tick at which the player is first on `lap` in the no-input race of `seed`. */
function tickOnLap(seed: string, lap: number): number {
  return firstTick(trace(seed), (s) => player(s).lap >= lap);
}

describe('pit stops', () => {
  it('a late stop costs roughly PIT_LOSS of race time, minus the fresh-tyre gain on the last lap', () => {
    // Box on lap 14 → stop at the line, then one lap on fresh hards instead of ~90 % worn
    // mediums (past the cliff). The fresh-tyre gain on that lap is computed from the
    // model at mid-lap wear (lap time is linear in wear above the cliff, so the midpoint is
    // the lap average). Tolerance 2.5 s: the stationary time is rounded up to whole ticks
    // (≤ SIM_DT), and the rejoin can cost a little traffic.
    const states = trace(NO_EVENTS_SEED);
    const base = states.at(-1)!;
    const onFinalLap = states.find((s) => player(s).lap === LAPS)!;
    const worn = player(onFinalLap);
    const fitted = PLAN_COMPOUND.A;
    const wornMidLap = { ...worn, tyreWear: worn.tyreWear + WEAR_PER_LAP[worn.compound].dry / 2 };
    const freshMidLap = { ...worn, compound: fitted, tyreWear: WEAR_PER_LAP[fitted].dry / 2 };
    const freshGain = lapTimeFor(wornMidLap, onFinalLap) - lapTimeFor(freshMidLap, onFinalLap);
    expect(worn.tyreWear).toBeGreaterThan(WEAR_CLIFF); // precondition: the no-stop car is on dead tyres

    const boxed = simulateRace(NO_EVENTS_SEED, [{ tick: tickOnLap(NO_EVENTS_SEED, LAPS - 1), command: 'BOX' }]);
    expect(playerStops(boxed)).toHaveLength(1);
    const delta = player(boxed).finishTime! - player(base).finishTime!;
    expect(Math.abs(delta - (PIT_LOSS - freshGain))).toBeLessThan(2.5);
  });

  it('the car is stationary for PIT_LOSS (rounded up to whole ticks)', () => {
    const states = trace(NO_EVENTS_SEED, [{ tick: 500, command: 'BOX' }]);
    const stationary = states.filter((s) => player(s).pitTimeRemaining > 0).length;
    expect(stationary * SIM_DT).toBeGreaterThanOrEqual(PIT_LOSS);
    expect(stationary * SIM_DT).toBeLessThan(PIT_LOSS + SIM_DT);
  });

  it('stop resets wear and fits Plan A compound; PLAN_B switches to softs', () => {
    const planA = simulateRace(NO_EVENTS_SEED, [{ tick: 1200, command: 'BOX' }]);
    expect(playerStops(planA)[0]?.compound).toBe(PLAN_COMPOUND.A);
    expect(player(planA).compound).toBe('H');
    expect(player(planA).pitStops).toBe(1);

    const planB = simulateRace(NO_EVENTS_SEED, [
      { tick: 100, command: 'PLAN_B' },
      { tick: 1200, command: 'BOX' },
    ]);
    expect(playerStops(planB)[0]?.compound).toBe('S');

    const states = trace(NO_EVENTS_SEED, [{ tick: 1200, command: 'BOX' }]);
    const stopTick = playerStops(states.at(-1)!)[0]!.tick;
    const before = states[stopTick]!;
    const after = states[stopTick + 1]!;
    expect(player(before).tyreWear).toBeGreaterThan(20);
    expect(player(after).tyreWear).toBe(0);
    expect(player(after).tyreAgeLaps).toBe(0);
    expect(player(after).boxQueued).toBe(false);
    expect(player(after).pitTimeRemaining).toBe(PIT_LOSS);
  });

  it('BOX twice before the line cancels the stop', () => {
    const race = simulateRace(NO_EVENTS_SEED, [
      { tick: 300, command: 'BOX' },
      { tick: 301, command: 'BOX' },
    ]);
    expect(playerStops(race)).toHaveLength(0);
    expect(player(race).pitStops).toBe(0);
  });

  it('the stop happens at the next line crossing, not immediately', () => {
    const boxTick = 400; // mid lap 2
    const states = trace(NO_EVENTS_SEED, [{ tick: boxTick, command: 'BOX' }]);
    const afterCall = states[boxTick + 1]!;
    expect(player(afterCall).boxQueued).toBe(true);
    expect(player(afterCall).pitTimeRemaining).toBe(0);

    const stopTick = playerStops(states.at(-1)!)[0]!.tick;
    expect(stopTick).toBeGreaterThan(boxTick + 1);
    const before = states[stopTick]!;
    const after = states[stopTick + 1]!;
    expect(player(after).lap).toBe(player(before).lap + 1);
    expect(Number.isInteger(player(after).distance)).toBe(true);
    expect(player(before).lap).toBe(player(afterCall).lap);
  });

  it('no stop when the next crossing is the finish', () => {
    const race = simulateRace(NO_EVENTS_SEED, [{ tick: tickOnLap(NO_EVENTS_SEED, LAPS) + 5, command: 'BOX' }]);
    expect(playerStops(race)).toHaveLength(0);
    expect(player(race).finishTime).not.toBeNull();
  });

  it('a stop in the wet fits intermediates, whatever the plan', () => {
    const rainTick = simulateRace(RAIN_SEED, []).eventLog.find((e) => e.type === 'RAIN_START')!.tick;
    const inputs: CommandInput[] = [
      { tick: 10, command: 'PLAN_B' },
      { tick: rainTick + 1, command: 'BOX' },
    ];
    const race = simulateRace(RAIN_SEED, inputs);
    expect(playerStops(race)[0]?.compound).toBe(WET_COMPOUND);
    expect(player(race).compound).toBe('I');
  });

  it('a box queued in the dry fits inters if it starts raining before the line', () => {
    const states = trace(RAIN_SEED);
    const rainTick = states.at(-1)!.eventLog.find((e) => e.type === 'RAIN_START')!.tick;
    // Precondition (pinned seed): the player's next crossing after the call is in the wet.
    const crossTick = firstTick(states, (s) => player(s).lap > player(states[rainTick - 1]!).lap) - 1;
    expect(crossTick).toBeGreaterThanOrEqual(rainTick);

    const race = simulateRace(RAIN_SEED, [
      { tick: 10, command: 'PLAN_B' },
      { tick: rainTick - 1, command: 'BOX' },
    ]);
    const [stop] = playerStops(race);
    expect(stop?.tick).toBe(crossTick);
    expect(stop?.compound).toBe(WET_COMPOUND);
  });

  it('a stop under the safety car costs PIT_LOSS_SC', () => {
    const deployTick = simulateRace(SC_SEED, []).eventLog.find((e) => e.type === 'SAFETY_CAR_DEPLOYED')!.tick;
    const states = trace(SC_SEED, [{ tick: deployTick + 1, command: 'BOX' }]);
    const stop = playerStops(states.at(-1)!)[0]!;
    expect(states[stop.tick + 1]!.safetyCar.active).toBe(true);
    expect(player(states[stop.tick + 1]!).pitTimeRemaining).toBe(PIT_LOSS_SC);
  });
});
