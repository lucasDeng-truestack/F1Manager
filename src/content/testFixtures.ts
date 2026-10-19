// Hand-built RaceState fixtures for content tests (the sim's createRace is another unit).
import { CAR_CODES, FIELD_SIZE, PLAYER_ID } from '../sim/constants';
import type { CarState, RaceEvent, RaceState, Rng } from '../sim/types';

export function makeCar(id: number, overrides: Partial<CarState> = {}): CarState {
  return {
    id,
    code: CAR_CODES[id] ?? `C${id}`,
    isPlayer: id === PLAYER_ID,
    basePace: 90,
    distance: 3.5,
    lap: 4,
    position: id + 1,
    gapToLeader: id * 2,
    gapToAhead: id === 0 ? 0 : 2,
    compound: 'M',
    tyreWear: 40,
    tyreAgeLaps: 3,
    fuel: 80,
    mode: 'normal',
    plan: 'A',
    boxQueued: false,
    pitTimeRemaining: 0,
    pitStops: 0,
    punctured: false,
    lastLapTime: 90,
    lapStartTime: 270,
    finishTime: null,
    ai: null,
    ...overrides,
  };
}

/**
 * Field in id order; `order` is ids by position. The player is placed at `playerPosition`
 * (1-based, default 5); every car gets the matching `position`, gaps default to 2 s.
 */
export function makeRace(opts: {
  playerPosition?: number;
  player?: Partial<CarState>;
  gapBehindPlayer?: number;
  state?: Partial<RaceState>;
  tickEvents?: RaceEvent[];
} = {}): RaceState {
  const playerPos = opts.playerPosition ?? 5;
  const ai = Array.from({ length: FIELD_SIZE - 1 }, (_, i) => i + 1);
  const order = [...ai.slice(0, playerPos - 1), PLAYER_ID, ...ai.slice(playerPos - 1)];
  const cars: CarState[] = Array.from({ length: FIELD_SIZE }, (_, id) => {
    const position = order.indexOf(id) + 1;
    const gapToAhead = position === 1 ? 0 : 2;
    return makeCar(id, { position, gapToAhead, gapToLeader: (position - 1) * 2 });
  });
  const pIdx = order.indexOf(PLAYER_ID);
  const base = cars[PLAYER_ID];
  if (base) cars[PLAYER_ID] = { ...base, ...opts.player };
  const behindId = order[pIdx + 1];
  const behind = behindId === undefined ? undefined : cars[behindId];
  if (behindId !== undefined && behind && opts.gapBehindPlayer !== undefined) {
    cars[behindId] = { ...behind, gapToAhead: opts.gapBehindPlayer };
  }
  return {
    seed: 'test',
    tick: 1000,
    time: 375,
    phase: 'racing',
    weather: 'dry',
    rainStartedLap: null,
    safetyCar: { active: false, endsAtLeaderDistance: null },
    leaderLap: 4,
    cars,
    order,
    schedule: { safetyCarLap: null, safetyCarLaps: 2, rainLap: null, puncture: null },
    tickEvents: opts.tickEvents ?? [],
    eventLog: [],
    ...opts.state,
  };
}

export function ev(type: RaceEvent['type'], extra: Partial<RaceEvent> = {}, tick = 1000): RaceEvent {
  return { tick, lap: 4, type, ...extra };
}

/** Tiny deterministic LCG in [0, 1). */
export function lcg(seed = 1): Rng {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
