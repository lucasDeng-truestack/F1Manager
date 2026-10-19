import {
  AI_EARLY_STOP_COMPOUND,
  AI_LATE_STOP_COMPOUND,
  AI_PIT_LAP_MAX,
  AI_PIT_LAP_MIN,
  AI_RAIN_REACT_MAX_LAPS,
  AI_START_COMPOUNDS,
  BASE_LAP_TIME,
  CAR_CODES,
  CAR_PACE_SPREAD,
  FIELD_SIZE,
  FUEL_START,
  GRID_GAP_S,
  PLAYER_GRID_MAX,
  PLAYER_GRID_MIN,
  PLAYER_ID,
  PLAYER_PACE_OFFSET,
  PLAYER_START_COMPOUND,
  PUNCTURE_LAP_MAX,
  PUNCTURE_LAP_MIN,
  PUNCTURE_PLAYER_SHARE,
  PUNCTURE_PROB,
  RAIN_LAP_MAX,
  RAIN_LAP_MIN,
  RAIN_PROB,
  SAFETY_CAR_PROB,
  SC_DURATION_MAX,
  SC_DURATION_MIN,
  SC_LAP_MAX,
  SC_LAP_MIN,
} from './constants';
import { at, computeOrder, withStandings } from './model';
import { createRng, pick, randInt } from './rng';
import type { AiPlan, CarState, Compound, EventSchedule, RaceState, Rng } from './types';

const AI_IDS: readonly number[] = Array.from({ length: FIELD_SIZE }, (_, id) => id).filter((id) => id !== PLAYER_ID);

interface GridEntry { id: number; basePace: number; compound: Compound }

/** grid stream: per AI car (ascending id) [pace, compound], then [player slot]. 2 × (FIELD_SIZE − 1) + 1 draws. */
function drawGrid(rng: Rng): { entries: GridEntry[]; playerSlot: number } {
  const entries = AI_IDS.map((id) => {
    const basePace = BASE_LAP_TIME + (rng() - 0.5) * CAR_PACE_SPREAD;
    const compound = pick(rng, AI_START_COMPOUNDS);
    return { id, basePace, compound };
  });
  const playerSlot = randInt(rng, PLAYER_GRID_MIN, PLAYER_GRID_MAX);
  return { entries, playerSlot };
}

/**
 * events stream: always exactly 9 draws in this order, whatever the outcomes, so changing
 * one probability never shifts another event:
 * [scRoll, scLap, scDuration, rainRoll, rainLap, punctureRoll, punctureLap, puncturePlayerRoll, punctureAiPick].
 */
export function drawSchedule(rng: Rng): EventSchedule {
  const scRoll = rng();
  const scLap = randInt(rng, SC_LAP_MIN, SC_LAP_MAX);
  const scDuration = randInt(rng, SC_DURATION_MIN, SC_DURATION_MAX);
  const rainRoll = rng();
  const rainLap = randInt(rng, RAIN_LAP_MIN, RAIN_LAP_MAX);
  const punctureRoll = rng();
  const punctureLap = randInt(rng, PUNCTURE_LAP_MIN, PUNCTURE_LAP_MAX);
  const puncturePlayerRoll = rng();
  const punctureAi = pick(rng, AI_IDS);

  const hasSc = scRoll < SAFETY_CAR_PROB;
  return {
    safetyCarLap: hasSc ? scLap : null,
    safetyCarLaps: hasSc ? scDuration : 0,
    rainLap: rainRoll < RAIN_PROB ? rainLap : null,
    puncture:
      punctureRoll < PUNCTURE_PROB
        ? { carId: puncturePlayerRoll < PUNCTURE_PLAYER_SHARE ? PLAYER_ID : punctureAi, lap: punctureLap }
        : null,
  };
}

/**
 * Early stoppers take AI_EARLY_STOP_COMPOUND to the end, late stoppers
 * AI_LATE_STOP_COMPOUND: split at the midpoint of the AI pit window.
 */
function stopCompoundFor(pitLap: number): Compound {
  return pitLap <= (AI_PIT_LAP_MIN + AI_PIT_LAP_MAX) / 2 ? AI_EARLY_STOP_COMPOUND : AI_LATE_STOP_COMPOUND;
}

/** ai stream: per AI car (ascending id) [pitLap, rainReactLaps]. 2 × (FIELD_SIZE − 1) draws. */
function drawAiPlans(rng: Rng): Map<number, AiPlan> {
  const plans = new Map<number, AiPlan>();
  for (const id of AI_IDS) {
    const pitLap = randInt(rng, AI_PIT_LAP_MIN, AI_PIT_LAP_MAX);
    const rainReactLaps = randInt(rng, 0, AI_RAIN_REACT_MAX_LAPS);
    plans.set(id, { pitLap, stopCompound: stopCompoundFor(pitLap), rainReactLaps });
  }
  return plans;
}

export function createRace(seed: string): RaceState {
  const { entries, playerSlot } = drawGrid(createRng(seed, 'grid'));
  const schedule = drawSchedule(createRng(seed, 'events'));
  const plans = drawAiPlans(createRng(seed, 'ai'));

  const player: GridEntry = {
    id: PLAYER_ID,
    basePace: BASE_LAP_TIME + PLAYER_PACE_OFFSET,
    compound: PLAYER_START_COMPOUND,
  };
  const grid = [...entries].sort((a, b) => a.basePace - b.basePace || a.id - b.id);
  grid.splice(playerSlot - 1, 0, player);

  const cars: CarState[] = Array.from({ length: FIELD_SIZE }, (_, id) => {
    const gridIndex = grid.findIndex((e) => e.id === id);
    const entry = at(grid, gridIndex);
    return {
      id,
      code: at(CAR_CODES, id),
      isPlayer: id === PLAYER_ID,
      basePace: entry.basePace,
      // `0 - x` (not `-x`): pole sits on exactly +0, never -0, so toEqual against 0 holds.
      distance: 0 - (gridIndex * GRID_GAP_S) / BASE_LAP_TIME,
      lap: 1,
      position: gridIndex + 1,
      gapToLeader: 0,
      gapToAhead: 0,
      compound: entry.compound,
      tyreWear: 0,
      tyreAgeLaps: 0,
      fuel: FUEL_START,
      mode: 'normal',
      plan: 'A',
      boxQueued: false,
      pitTimeRemaining: 0,
      pitStops: 0,
      punctured: false,
      lastLapTime: null,
      lapStartTime: 0,
      finishTime: null,
      ai: id === PLAYER_ID ? null : (plans.get(id) ?? null),
    };
  });

  const order = computeOrder(cars);
  const lightsOut = { tick: 0, lap: 1, type: 'LIGHTS_OUT' as const };
  return {
    seed,
    tick: 0,
    time: 0,
    phase: 'racing',
    weather: 'dry',
    rainStartedLap: null,
    safetyCar: { active: false, endsAtLeaderDistance: null },
    leaderLap: 1,
    cars: withStandings(cars, order, 0, 'dry'),
    order,
    schedule,
    tickEvents: [lightsOut],
    eventLog: [lightsOut],
  };
}
