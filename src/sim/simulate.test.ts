import { describe, expect, it } from 'vitest';
import { LAPS, PLAYER_ID, evaluateCall, evaluateCalls, simulateRace, type CallImpact, type CommandInput, type RaceState } from './index';
import { at, lapTimeFor } from './model';
import { deepFreeze } from './testkit';

const SEED = 'd';
const INPUTS: CommandInput[] = [
  { tick: 0, command: 'PUSH' },
  { tick: 300, command: 'PLAN_B' },
  { tick: 900, command: 'SAVE_TYRES' },
  { tick: 1500, command: 'BOX' },
  { tick: 1500, command: 'DEFEND' },
];

/** The pre-refactor evaluateCalls body, kept verbatim as the reference the split must match. */
function referenceEvaluateCalls(seed: string, inputs: readonly CommandInput[]): CallImpact[] {
  const raceTime = (state: RaceState): number => {
    const car = at(state.cars, PLAYER_ID);
    if (car.finishTime !== null) return car.finishTime;
    return state.time + car.pitTimeRemaining + Math.max(0, LAPS - car.distance) * lapTimeFor(car, state);
  };
  const base = simulateRace(seed, inputs);
  const baseTime = raceTime(base);
  const basePosition = at(base.cars, PLAYER_ID).position;
  return inputs.map((input, i) => {
    const alt = simulateRace(seed, inputs.filter((_, k) => k !== i));
    const applied = base.eventLog.find(
      (e) => e.type === 'COMMAND_APPLIED' && e.tick === input.tick && e.command === input.command,
    );
    return {
      tick: input.tick,
      lap: applied?.lap ?? base.leaderLap,
      command: input.command,
      timeDelta: raceTime(alt) - baseTime,
      positionDelta: at(alt.cars, PLAYER_ID).position - basePosition,
    };
  });
}

describe('evaluateCall / evaluateCalls', () => {
  const expected = referenceEvaluateCalls(SEED, INPUTS);

  it('evaluateCalls is unchanged by the split into evaluateCall', () => {
    expect(evaluateCalls(SEED, INPUTS)).toEqual(expected);
    // Not vacuous: at least one call moved the player's race time.
    expect(expected.some((c) => c.timeDelta !== 0)).toBe(true);
  });

  it('evaluateCall one at a time over a shared base equals evaluateCalls', () => {
    const base = deepFreeze(simulateRace(SEED, INPUTS));
    const inputs = deepFreeze(INPUTS.map((i) => ({ ...i })));
    const oneByOne = inputs.map((_, i) => evaluateCall(SEED, inputs, i, base));
    expect(oneByOne).toEqual(expected); // and frozen inputs/base were never written to
    expect(evaluateCall(SEED, inputs, 3, base)).toEqual(evaluateCall(SEED, inputs, 3, base));
  });

  it('returns no impacts for no calls and throws for an index outside the inputs', () => {
    expect(evaluateCalls(SEED, [])).toEqual([]);
    const base = simulateRace(SEED, INPUTS);
    expect(() => evaluateCall(SEED, INPUTS, INPUTS.length, base)).toThrow();
    expect(() => evaluateCall(SEED, INPUTS, -1, base)).toThrow();
  });
});
