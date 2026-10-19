import {
  BASE_LAP_TIME,
  COMPOUND_PACE,
  FUEL_PACE_PER_KG,
  LAPS,
  MIN_FOLLOW_GAP_S,
  MODE_PACE,
  PUNCTURE_PACE_LOSS,
  RAIN_LAP_TIME_DELTA,
  SC_CATCHUP_LAP_TIME,
  SC_LAP_TIME,
  SC_TRAIN_GAP_S,
  WEAR_CLIFF,
  WEAR_CLIFF_LOSS_PER_PCT,
  WEAR_PACE_LOSS,
} from './constants';
import type { CarState, RaceEvent, RaceEventType, RaceState, Weather } from './types';

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Lookup that fails loudly instead of returning undefined (noUncheckedIndexedAccess). */
export function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`sim: index ${index} out of range`);
  return item;
}

/** MIN_FOLLOW_GAP_S expressed in laps (distance units), converted with BASE_LAP_TIME. */
export const FOLLOW_GAP_LAPS = MIN_FOLLOW_GAP_S / BASE_LAP_TIME;

/** Lap number a car is on for a given distance: 1..LAPS (grid cars with distance ≤ 0 are on lap 1). */
export function lapOf(distance: number): number {
  return clamp(Math.floor(distance) + 1, 1, LAPS);
}

/**
 * The car's own target lap time in seconds for the current conditions.
 * Deliberately EXCLUDES the safety car: under SC the sim drives cars with
 * `effectiveLapTime` instead, but UI/content keep a meaningful "pace" number here and
 * overtake probabilities compare true pace.
 */
export function lapTimeFor(car: CarState, state: Pick<RaceState, 'weather'>): number {
  const weather: Weather = state.weather;
  const wear = car.tyreWear;
  const wearLoss = WEAR_PACE_LOSS * (wear / 100) + WEAR_CLIFF_LOSS_PER_PCT * Math.max(0, wear - WEAR_CLIFF);
  return (
    car.basePace +
    COMPOUND_PACE[car.compound][weather] +
    (weather === 'wet' ? RAIN_LAP_TIME_DELTA : 0) +
    wearLoss +
    car.fuel * FUEL_PACE_PER_KG +
    MODE_PACE[car.mode] +
    (car.punctured ? PUNCTURE_PACE_LOSS : 0)
  );
}

/**
 * Lap time the sim actually moves a car with this tick. Same as lapTimeFor unless the
 * safety car is out: the leader runs SC_LAP_TIME; a car more than SC_TRAIN_GAP_S behind
 * the car ahead runs SC_CATCHUP_LAP_TIME until it closes up, then SC_LAP_TIME. A car is
 * never faster than its own pace (e.g. a punctured car stays slow).
 */
export function effectiveLapTime(
  car: CarState,
  state: Pick<RaceState, 'weather' | 'safetyCar'>,
  isLeader: boolean,
): number {
  const own = lapTimeFor(car, state);
  if (!state.safetyCar.active) return own;
  const target = !isLeader && car.gapToAhead > SC_TRAIN_GAP_S ? SC_CATCHUP_LAP_TIME : SC_LAP_TIME;
  return Math.max(own, target);
}

/** Classification: finished first by finishTime, then distance desc, tie → lower id. Never sorts in place. */
export function computeOrder(cars: readonly CarState[]): number[] {
  return [...cars]
    .sort((a, b) => {
      if (a.finishTime !== null && b.finishTime !== null) {
        return a.finishTime - b.finishTime || a.id - b.id;
      }
      if (a.finishTime !== null) return -1;
      if (b.finishTime !== null) return 1;
      return b.distance - a.distance || a.id - b.id;
    })
    .map((c) => c.id);
}

/**
 * Time gap in seconds between two cars at sim time `time` (≥ 0).
 * Both finished → finishTime difference. Ahead finished → the behind car's estimated
 * finish (time + remaining distance × its lap time) minus the ahead finishTime.
 * Neither → distance difference × the behind car's own lap time, plus any pit time it
 * still has to serve.
 */
export function gapSeconds(ahead: CarState, behind: CarState, time: number, weather: Weather): number {
  const lt = lapTimeFor(behind, { weather });
  if (ahead.finishTime !== null && behind.finishTime !== null) {
    return Math.max(0, behind.finishTime - ahead.finishTime);
  }
  if (ahead.finishTime !== null) {
    return Math.max(0, time + Math.max(0, LAPS - behind.distance) * lt + behind.pitTimeRemaining - ahead.finishTime);
  }
  return Math.max(0, (ahead.distance - behind.distance) * lt + behind.pitTimeRemaining);
}

/**
 * Returns new car objects (ordered by id) with lap, position, gapToLeader and gapToAhead
 * filled in for the given order. Input cars are not mutated.
 */
export function withStandings(
  cars: readonly CarState[],
  order: readonly number[],
  time: number,
  weather: Weather,
): CarState[] {
  const leader = at(cars, at(order, 0));
  const next = cars.map((c) => ({ ...c, lap: lapOf(c.distance) }));
  order.forEach((id, index) => {
    const car = at(next, id);
    car.position = index + 1;
    if (index === 0) {
      car.gapToLeader = 0;
      car.gapToAhead = 0;
      return;
    }
    const ahead = at(cars, at(order, index - 1));
    const original = at(cars, id);
    car.gapToLeader = gapSeconds(leader, original, time, weather);
    car.gapToAhead = gapSeconds(ahead, original, time, weather);
  });
  return next;
}

export function hasEvent(log: readonly RaceEvent[], type: RaceEventType): boolean {
  return log.some((e) => e.type === type);
}
