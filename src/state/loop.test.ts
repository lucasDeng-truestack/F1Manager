import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_TICKS_PER_FRAME, TICK_MS, evaluateCall, evaluateCalls, simulateRace } from '../sim';
import type { CallImpact, RaceState } from '../sim/types';
import { DEBRIEF_HOLD_MS, IMPACT_BATCH_MS, computeImpacts, getInterpolationAlpha, scheduleDebrief, startGameLoop } from './loop';
import { initialGameState, useGameStore } from './store';

// Pass-through spies: count how much analysis runs, without changing what it computes.
vi.mock('../sim', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../sim')>();
  return { ...actual, evaluateCall: vi.fn(actual.evaluateCall), simulateRace: vi.fn(actual.simulateRace) };
});

const store = () => useGameStore.getState();
const tick = () => store().race?.tick ?? -1;

let callbacks = new Map<number, FrameRequestCallback>();
let nextId = 1;

/** Runs every pending animation-frame callback at time `t` (ms). */
function frame(t: number): void {
  const due = [...callbacks.values()];
  callbacks = new Map();
  for (const cb of due) cb(t);
}

const stops: (() => void)[] = [];
function start(): () => void {
  const stop = startGameLoop();
  stops.push(stop);
  return stop;
}

beforeEach(() => {
  callbacks = new Map();
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    const id = nextId++;
    callbacks.set(id, cb);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    callbacks.delete(id);
  });
  useGameStore.setState(initialGameState());
  vi.mocked(evaluateCall).mockClear();
  vi.mocked(simulateRace).mockClear();
});

afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('startGameLoop', () => {
  it('steps once per TICK_MS of real time and reports the interpolation alpha', () => {
    store().startRace();
    start();
    frame(1000); // first frame only sets the clock
    expect(tick()).toBe(0);
    frame(1000 + TICK_MS * 2.5);
    expect(tick()).toBe(2);
    expect(getInterpolationAlpha()).toBeCloseTo(0.5);
    frame(1000 + TICK_MS * 3);
    expect(tick()).toBe(3);
    expect(getInterpolationAlpha()).toBeCloseTo(0);
  });

  it(`runs at most MAX_TICKS_PER_FRAME steps per frame and drops the backlog`, () => {
    store().startRace();
    start();
    frame(0);
    frame(5 * 60 * 1000 + TICK_MS / 4); // tab hidden for five minutes
    expect(tick()).toBe(MAX_TICKS_PER_FRAME);
    expect(getInterpolationAlpha()).toBeLessThan(1);
    frame(5 * 60 * 1000 + TICK_MS / 4 + TICK_MS);
    expect(tick()).toBe(MAX_TICKS_PER_FRAME + 1); // back to real time, no fast-forward
  });

  it('never runs two loops, even when started twice (StrictMode)', () => {
    store().startRace();
    const stopA = start();
    stopA(); // StrictMode: mount → unmount → mount
    start();
    start();
    expect(callbacks.size).toBe(1);
    frame(0);
    frame(TICK_MS);
    expect(tick()).toBe(1);
  });

  it('stops only when every starter has stopped; a stop counts once', () => {
    store().startRace();
    const stopA = start();
    const stopB = start();
    stopA();
    stopA();
    expect(callbacks.size).toBe(1);
    stopB();
    expect(callbacks.size).toBe(0);
    frame(TICK_MS * 10);
    expect(tick()).toBe(0);
  });

  it('does not step or accumulate time outside a race', () => {
    start();
    frame(0);
    frame(TICK_MS * 3);
    expect(store().race).toBeNull();
    expect(getInterpolationAlpha()).toBe(0);
    store().startRace();
    frame(TICK_MS * 3 + 10);
    expect(tick()).toBe(0); // time spent on the start screen is not replayed
  });

  it('holds the chequered flag, then switches to the debrief and fills impacts', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    store().startRace();
    store().issueCommand('PUSH', 'keyboard');
    while (store().race?.phase === 'racing') store().advance();
    start();
    frame(0);
    expect(getInterpolationAlpha()).toBe(1);
    frame(TICK_MS);
    expect(store().screen).toBe('race');
    vi.advanceTimersByTime(DEBRIEF_HOLD_MS);
    expect(store().screen).toBe('debrief');
    expect(store().impacts).toEqual([]);
    vi.runAllTimers();
    expect(store().impacts).toEqual([]); // nothing runs before the debrief has painted
    expect(simulateRace).not.toHaveBeenCalled();
    frame(TICK_MS * 2);
    vi.runAllTimers();
    expect(store().impacts).toHaveLength(1);
  });
});

describe('debrief analysis', () => {
  /** A finished race with three calls, played through the store (no loop running). */
  function finishedRace(): RaceState {
    store().startRace();
    const calls = [[100, 'PUSH'], [700, 'BOX'], [1800, 'SAVE_TYRES']] as const;
    for (const [at, cmd] of calls) {
      while (tick() < at) store().advance();
      store().issueCommand(cmd, 'keyboard');
    }
    while (store().race?.phase === 'racing') store().advance();
    const race = store().race;
    if (race === null) throw new Error('no race');
    return race;
  }

  /** Every call blows the batch budget, so each batch evaluates exactly one call. */
  function slowClock(): void {
    let t = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => (t += IMPACT_BATCH_MS));
  }

  /** Records every distinct impacts array written to the store. */
  function impactWrites(): CallImpact[][] {
    const writes: CallImpact[][] = [];
    const unsubscribe = useGameStore.subscribe((s, prev) => {
      if (s.impacts !== prev.impacts) writes.push(s.impacts);
    });
    stops.push(unsubscribe);
    return writes;
  }

  /** Into the debrief (hold elapsed) and past the first paint: the base race is next. */
  function toDebriefPainted(finished: RaceState): void {
    scheduleDebrief(finished);
    vi.advanceTimersByTime(DEBRIEF_HOLD_MS);
    expect(store().screen).toBe('debrief');
    frame(0);
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });

  it('simulates the base once, evaluates one batch per macrotask and writes impacts once', () => {
    const finished = finishedRace();
    slowClock();
    const writes = impactWrites();
    toDebriefPainted(finished);

    vi.advanceTimersToNextTimer(); // the base race, on its own
    expect(simulateRace).toHaveBeenCalledTimes(1);
    expect(evaluateCall).not.toHaveBeenCalled();
    for (let n = 1; n <= 3; n++) {
      expect(store().impacts).toEqual([]); // "Analysing…" until every call is in
      vi.advanceTimersToNextTimer();
      expect(evaluateCall).toHaveBeenCalledTimes(n);
    }
    expect(vi.getTimerCount()).toBe(0);
    expect(writes).toHaveLength(1);
    expect(store().impacts).toEqual(evaluateCalls(finished.seed, store().inputs));
  });

  it('evaluates several fast calls in one batch', () => {
    const finished = finishedRace();
    vi.spyOn(performance, 'now').mockReturnValue(0); // never over budget
    toDebriefPainted(finished);
    vi.advanceTimersToNextTimer(); // base
    vi.advanceTimersToNextTimer(); // all three calls
    expect(evaluateCall).toHaveBeenCalledTimes(3);
    expect(store().impacts).toHaveLength(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    ['back to start', () => store().backToStart()],
    ['race again', () => store().startRace()],
  ])('stops mid-analysis and writes nothing when the player leaves (%s)', (_label, leave) => {
    const finished = finishedRace();
    slowClock();
    toDebriefPainted(finished);
    vi.advanceTimersToNextTimer(); // base
    vi.advanceTimersToNextTimer(); // call 1 of 3
    expect(evaluateCall).toHaveBeenCalledTimes(1);
    leave();
    const writes = impactWrites();
    vi.runAllTimers();
    expect(evaluateCall).toHaveBeenCalledTimes(1); // no further batches ran
    expect(writes).toEqual([]);
    expect(store().impacts).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not even simulate the base race when the player leaves before the paint', () => {
    const finished = finishedRace();
    scheduleDebrief(finished);
    vi.advanceTimersByTime(DEBRIEF_HOLD_MS);
    store().backToStart();
    frame(0);
    vi.runAllTimers();
    expect(simulateRace).not.toHaveBeenCalled();
    expect(store().impacts).toEqual([]);
  });

  it('falls back to a macrotask where requestAnimationFrame does not exist', () => {
    const finished = finishedRace();
    vi.stubGlobal('requestAnimationFrame', undefined);
    useGameStore.setState({ screen: 'debrief' });
    computeImpacts(finished);
    expect(store().impacts).toEqual([]);
    vi.runAllTimers();
    expect(store().impacts).toEqual(evaluateCalls(finished.seed, store().inputs));
  });
});
