// The game loop: requestAnimationFrame + a fixed-step accumulator of TICK_MS that calls the
// store's `advance()`. Real time never reaches the sim — it only decides how many steps run.
// Also moves a finished race to the debrief and computes the call impacts once.
import { MAX_TICKS_PER_FRAME, TICK_MS, evaluateCall, simulateRace } from '../sim';
import type { CallImpact, RaceState } from '../sim/types';
import { useGameStore } from './store';

/** Real-time hold on the chequered flag before the debrief. UI timing, not a sim tunable. */
export const DEBRIEF_HOLD_MS = 2500;
/**
 * Wall-clock budget for one batch of call analysis (one macrotask). Each call re-runs the
 * whole race, so a batch is at least one race long; the budget only groups fast ones.
 */
export const IMPACT_BATCH_MS = 12;

let users = 0;
let rafId: number | null = null;
let lastFrame: number | null = null;
let accumulator = 0;
let alpha = 0;
let debriefScheduledFor: RaceState | null = null;

/**
 * How far the next tick is from landing, in [0, 1]: draw `prevRace + (race − prevRace) × α`.
 * 1 once the race is finished (show the final state), 0 when no race is running.
 */
export function getInterpolationAlpha(): number {
  return alpha;
}

/** True while `finished` is the race on the debrief: the player has not moved on. */
function onDebriefOf(finished: RaceState): boolean {
  const state = useGameStore.getState();
  return state.screen === 'debrief' && state.race === finished;
}

/** Runs `fn` after the next paint: rAF, then a macrotask. No rAF (tests, SSR): a macrotask. */
function afterPaint(fn: () => void): void {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(fn, 0));
  else setTimeout(fn, 0);
}

/**
 * Computes the finished race's impacts off the critical path and hands them to the debrief
 * in ONE write (the debrief shows "Analysing…" until impacts.length === inputs.length).
 * Waits for a paint, simulates the base race in its own macrotask, then evaluates the calls
 * in batches of about IMPACT_BATCH_MS, yielding between batches. Before every step and the
 * final write it checks the player is still on this race's debrief; if not, it stops.
 */
export function computeImpacts(finished: RaceState): void {
  if (!onDebriefOf(finished)) return;
  afterPaint(() => {
    if (!onDebriefOf(finished)) return;
    // Fixed once the race is finished: calls are only taken while it is racing.
    const { inputs } = useGameStore.getState();
    const base = simulateRace(finished.seed, inputs);
    const impacts: CallImpact[] = [];
    const batch = (): void => {
      if (!onDebriefOf(finished)) return;
      const started = performance.now();
      while (impacts.length < inputs.length) {
        impacts.push(evaluateCall(finished.seed, inputs, impacts.length, base));
        if (performance.now() - started >= IMPACT_BATCH_MS) break;
      }
      if (impacts.length < inputs.length) {
        setTimeout(batch, 0);
        return;
      }
      // Same macrotask as the guard above (evaluateCall is pure): still this race's debrief.
      useGameStore.setState({ impacts });
    };
    setTimeout(batch, 0);
  });
}

/**
 * After DEBRIEF_HOLD_MS on the chequered flag: switch to the debrief, then start computing
 * the impacts once it has painted (see computeImpacts). Once per finished race; a stale
 * timer (backToStart / a new race meanwhile) does nothing. Not cancelled by stopping the
 * loop — the race screen unmounting on the switch must not lose the impacts.
 */
export function scheduleDebrief(finished: RaceState): void {
  if (debriefScheduledFor === finished) return;
  debriefScheduledFor = finished;
  setTimeout(() => {
    const state = useGameStore.getState();
    if (state.screen !== 'race' || state.race !== finished) return;
    useGameStore.setState({ screen: 'debrief' });
    computeImpacts(finished);
  }, DEBRIEF_HOLD_MS);
}

function frame(now: number): void {
  rafId = requestAnimationFrame(frame);
  const elapsed = lastFrame === null ? 0 : Math.max(0, now - lastFrame);
  lastFrame = now;

  const before = useGameStore.getState();
  if (before.screen !== 'race' || before.race === null) {
    accumulator = 0;
    alpha = 0;
    return;
  }

  if (before.race.phase === 'racing') {
    accumulator += elapsed;
    let steps = 0;
    while (accumulator >= TICK_MS && steps < MAX_TICKS_PER_FRAME) {
      useGameStore.getState().advance();
      accumulator -= TICK_MS;
      steps += 1;
    }
    // Back from a hidden tab (or a long stall): drop the backlog instead of fast-forwarding.
    if (accumulator >= TICK_MS) accumulator %= TICK_MS;
  }

  const race = useGameStore.getState().race;
  if (race !== null && race.phase === 'finished') {
    accumulator = 0;
    alpha = 1;
    scheduleDebrief(race);
  } else {
    alpha = Math.min(1, accumulator / TICK_MS);
  }
}

/**
 * Starts the loop (or joins the running one) and returns its stop function. Reference
 * counted, so React StrictMode's mount → unmount → mount never runs two loops, and each
 * returned stop function only counts once.
 */
export function startGameLoop(): () => void {
  users += 1;
  if (rafId === null) {
    lastFrame = null;
    accumulator = 0;
    rafId = requestAnimationFrame(frame);
  }
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    users -= 1;
    if (users === 0 && rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
      lastFrame = null;
    }
  };
}
