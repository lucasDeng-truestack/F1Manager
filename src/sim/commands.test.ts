import { describe, expect, it } from 'vitest';
import {
  PLAYER_ID,
  createRace,
  createRng,
  evaluateCalls,
  simulateRace,
  step,
  type CarState,
  type Command,
  type CommandInput,
  type RaceState,
} from './index';
import { firstTick, trace } from './testkit';

const SEED = 'seed-1';

function stepWith(commands: Command[], state: RaceState = createRace(SEED)): RaceState {
  return step(state, commands, createRng(SEED, 'race'));
}
const player = (s: RaceState) => s.cars[PLAYER_ID]!;
const strategy = (c: CarState) => ({ mode: c.mode, plan: c.plan, boxQueued: c.boxQueued });

describe('player commands', () => {
  it.each([
    ['PUSH', { mode: 'push' }],
    ['SAVE_TYRES', { mode: 'save' }],
    ['DEFEND', { mode: 'defend' }],
    ['BOX', { boxQueued: true }],
    ['PLAN_B', { plan: 'B' }],
    ['COPY', { mode: 'normal', plan: 'A', boxQueued: false }],
  ] as const)('%s', (command, expected) => {
    const next = stepWith([command]);
    expect(player(next)).toMatchObject(expected);
    expect(next.tickEvents).toContainEqual({ tick: 0, lap: 1, type: 'COMMAND_APPLIED', carId: PLAYER_ID, command });
    expect(next.eventLog).toContainEqual({ tick: 0, lap: 1, type: 'COMMAND_APPLIED', carId: PLAYER_ID, command });
  });

  it('BOX and PLAN_B toggle', () => {
    expect(player(stepWith(['BOX', 'BOX'])).boxQueued).toBe(false);
    expect(player(stepWith(['PLAN_B', 'PLAN_B'])).plan).toBe('A');
    expect(player(stepWith(['PLAN_B'], stepWith(['PLAN_B']))).plan).toBe('A');
  });

  it('several commands on one tick apply in order', () => {
    const next = stepWith(['PUSH', 'SAVE_TYRES']);
    expect(player(next).mode).toBe('save');
    expect(next.tickEvents.filter((e) => e.type === 'COMMAND_APPLIED').map((e) => e.command)).toEqual(['PUSH', 'SAVE_TYRES']);
  });

  it('only the player car is affected', () => {
    const without = stepWith([]);
    for (const command of ['PUSH', 'SAVE_TYRES', 'DEFEND', 'BOX', 'PLAN_B', 'COPY'] as const) {
      const withCmd = stepWith([command]);
      for (const car of withCmd.cars.filter((c) => !c.isPlayer)) {
        expect(strategy(car)).toEqual(strategy(without.cars[car.id]!));
      }
    }
  });

  it('PUSH is faster than SAVE_TYRES over a short stint', () => {
    // Fresh tyres, final laps: a stop at the end of lap 11, then push vs save from lap 13.
    const boxTick = firstTick(trace(SEED), (s) => player(s).lap >= 11);
    const stopped = trace(SEED, [{ tick: boxTick, command: 'BOX' }]);
    const lateTick = firstTick(stopped, (s) => player(s).lap >= 13);
    const run = (command: Command) =>
      simulateRace(SEED, [{ tick: boxTick, command: 'BOX' }, { tick: lateTick, command }]);
    expect(player(run('PUSH')).finishTime!).toBeLessThan(player(run('SAVE_TYRES')).finishTime!);
  });

  it('PUSH all race on one set burns the tyres into the cliff and loses to SAVE_TYRES', () => {
    const push = simulateRace(SEED, [{ tick: 0, command: 'PUSH' }]);
    const save = simulateRace(SEED, [{ tick: 0, command: 'SAVE_TYRES' }]);
    expect(player(push).tyreWear).toBe(100);
    expect(player(push).finishTime!).toBeGreaterThan(player(save).finishTime!);
  });
});

describe('evaluateCalls', () => {
  const inputs: CommandInput[] = [
    { tick: 100, command: 'COPY' },
    { tick: 200, command: 'PUSH' },
    { tick: 2000, command: 'BOX' },
  ];

  it('returns one CallImpact per input with tick, lap and command', () => {
    const impacts = evaluateCalls(SEED, inputs);
    expect(impacts).toHaveLength(inputs.length);
    const base = simulateRace(SEED, inputs);
    impacts.forEach((impact, i) => {
      expect(impact.tick).toBe(inputs[i]!.tick);
      expect(impact.command).toBe(inputs[i]!.command);
      const event = base.eventLog.find((e) => e.type === 'COMMAND_APPLIED' && e.tick === impact.tick)!;
      expect(impact.lap).toBe(event.lap);
    });
    expect(impacts[2]!.lap).toBeGreaterThan(1);
  });

  it('COPY has no impact; real calls do', () => {
    const [copy, push, box] = evaluateCalls(SEED, inputs);
    expect(copy).toMatchObject({ timeDelta: 0, positionDelta: 0 });
    expect(push!.timeDelta).toBeGreaterThan(0); // pushing all race gains time on one stint
    expect(box!.timeDelta).not.toBe(0);
  });

  it('signs: timeDelta = alt − base finish time, positionDelta = alt − base position', () => {
    const only: CommandInput[] = [{ tick: 2000, command: 'BOX' }];
    const [impact] = evaluateCalls(SEED, only);
    const base = simulateRace(SEED, only);
    const alt = simulateRace(SEED, []);
    expect(impact!.timeDelta).toBe(player(alt).finishTime! - player(base).finishTime!);
    expect(impact!.positionDelta).toBe(player(alt).position - player(base).position);
  });

  it('is deterministic and handles no inputs', () => {
    expect(evaluateCalls(SEED, inputs)).toEqual(evaluateCalls(SEED, inputs));
    expect(evaluateCalls(SEED, [])).toEqual([]);
  });
});
