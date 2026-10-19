/**
 * step(state, commands, rng) → next RaceState. Pure: the incoming state is never mutated;
 * every changed car is a fresh object. Order of operations (FIXED — changing it changes
 * every race; RNG is only drawn in phase 5):
 *
 * 1. Player commands (car PLAYER_ID only), in the order given. Each emits COMMAND_APPLIED.
 * 2. Scheduled events: SAFETY_CAR_DEPLOYED / SAFETY_CAR_IN (leader lap / leader distance),
 *    RAIN_START (leader lap), PUNCTURE (the scheduled car's own lap; AI auto-queues a box).
 * 3. AI decisions (no RNG): queue a box, pick normal / push mode.
 * 4. Move cars by SIM_DT using effectiveLapTime (safety-car aware): pit countdown, wear,
 *    fuel, TYRES_CRITICAL, then the start/finish line: lap time, finish
 *    (CHEQUERED_FLAG) or pit stop (PIT_STOP, car parked on the line).
 * 5. Racing: walk adjacent pairs of the pre-tick order, drawing EXACTLY FIELD_SIZE − 1
 *    values from `rng` every tick. A car closing inside the follow gap either passes
 *    (OVERTAKE) or is held at the gap. No passing under the safety car. Cars in the pit or
 *    finished take no part (they are passed freely, no event).
 * 6. Order, positions, gaps, car laps, leaderLap; FINAL_LAP once.
 * 7. time += SIM_DT, tick += 1; phase 'finished' when all cars finished or RACE_TICK_LIMIT.
 *
 * Events emitted in phases 1–5 carry the leader lap at the start of the tick; phase 6
 * events carry the new leader lap.
 */
import {
  AI_PIT_WEAR,
  AI_PUSH_FINAL_LAPS,
  AI_PUSH_MAX_WEAR,
  FIELD_SIZE,
  FUEL_PER_LAP,
  LAPS,
  MODE_FUEL,
  MODE_WEAR,
  OVERTAKE_DEFEND_FACTOR,
  OVERTAKE_PROB_MAX,
  OVERTAKE_PROB_PER_S,
  PIT_LOSS,
  PIT_LOSS_SC,
  PLAN_COMPOUND,
  PLAYER_ID,
  RACE_TICK_LIMIT,
  SIM_DT,
  TYRE_CRITICAL_WEAR,
  WEAR_PER_LAP,
  WET_COMPOUND,
} from './constants';
import {
  FOLLOW_GAP_LAPS,
  at,
  clamp,
  computeOrder,
  effectiveLapTime,
  hasEvent,
  lapTimeFor,
  withStandings,
} from './model';
import type { CarState, Command, Compound, RaceEvent, RaceState, Rng, SafetyCarState, Weather } from './types';

type EventBody = Omit<RaceEvent, 'tick' | 'lap'>;

function applyCommand(car: CarState, command: Command): void {
  switch (command) {
    case 'BOX':
      car.boxQueued = !car.boxQueued;
      break;
    case 'PUSH':
      car.mode = 'push';
      break;
    case 'SAVE_TYRES':
      car.mode = 'save';
      break;
    case 'DEFEND':
      car.mode = 'defend';
      break;
    case 'PLAN_B':
      car.plan = car.plan === 'A' ? 'B' : 'A';
      break;
    case 'COPY':
      break;
  }
}

function aiWantsBox(car: CarState, weather: Weather, rainStartedLap: number | null, leaderLap: number): boolean {
  const ai = car.ai;
  if (ai === null) return false;
  if (car.punctured) return true;
  if (car.lap >= LAPS) return false; // never on the final lap (except a puncture, above)
  if (car.lap >= ai.pitLap && car.pitStops === 0) return true;
  if (car.tyreWear >= AI_PIT_WEAR) return true;
  if (weather === 'wet' && car.compound !== WET_COMPOUND && rainStartedLap !== null && leaderLap >= rainStartedLap + ai.rainReactLaps) {
    return true;
  }
  return weather === 'dry' && car.compound === WET_COMPOUND;
}

function stopCompound(car: CarState, weather: Weather): Compound {
  if (weather === 'wet') return WET_COMPOUND;
  if (car.ai !== null) return car.ai.stopCompound;
  return PLAN_COMPOUND[car.plan];
}

const onTrack = (car: CarState): boolean => car.finishTime === null && car.pitTimeRemaining === 0;

export function step(state: RaceState, commands: readonly Command[], rng: Rng): RaceState {
  if (state.phase === 'finished') return state;

  const tick = state.tick;
  const startLap = state.leaderLap;
  const events: RaceEvent[] = [];
  const emit = (body: EventBody, lap: number = startLap): void => {
    events.push({ tick, lap, ...body });
  };
  const cars: CarState[] = state.cars.map((c) => ({ ...c }));

  // 1. Player commands.
  const player = at(cars, PLAYER_ID);
  for (const command of commands) {
    applyCommand(player, command);
    emit({ type: 'COMMAND_APPLIED', carId: PLAYER_ID, command });
  }

  // 2. Scheduled events.
  const { schedule } = state;
  let weather: Weather = state.weather;
  let rainStartedLap = state.rainStartedLap;
  let safetyCar: SafetyCarState = state.safetyCar;
  const leaderDistance = at(cars, at(state.order, 0)).distance;

  if (
    schedule.safetyCarLap !== null &&
    !safetyCar.active &&
    startLap >= schedule.safetyCarLap &&
    !hasEvent(state.eventLog, 'SAFETY_CAR_DEPLOYED')
  ) {
    safetyCar = { active: true, endsAtLeaderDistance: leaderDistance + schedule.safetyCarLaps };
    emit({ type: 'SAFETY_CAR_DEPLOYED' });
  } else if (safetyCar.active && safetyCar.endsAtLeaderDistance !== null && leaderDistance >= safetyCar.endsAtLeaderDistance) {
    safetyCar = { active: false, endsAtLeaderDistance: null };
    emit({ type: 'SAFETY_CAR_IN' });
  }

  if (schedule.rainLap !== null && weather === 'dry' && startLap >= schedule.rainLap) {
    weather = 'wet';
    rainStartedLap = startLap;
    emit({ type: 'RAIN_START' });
  }

  if (schedule.puncture !== null) {
    const victim = cars[schedule.puncture.carId];
    if (
      victim !== undefined &&
      !victim.punctured &&
      onTrack(victim) &&
      victim.lap >= schedule.puncture.lap &&
      !hasEvent(state.eventLog, 'PUNCTURE')
    ) {
      victim.punctured = true;
      if (!victim.isPlayer) victim.boxQueued = true;
      emit({ type: 'PUNCTURE', carId: victim.id });
    }
  }

  // 3. AI decisions (pure, no RNG).
  for (const car of cars) {
    if (car.ai === null || car.finishTime !== null) continue;
    if (!car.boxQueued && aiWantsBox(car, weather, rainStartedLap, startLap)) car.boxQueued = true;
    car.mode = car.lap > LAPS - AI_PUSH_FINAL_LAPS && car.tyreWear < AI_PUSH_MAX_WEAR ? 'push' : 'normal';
  }

  // 4. Move cars.
  const conditions = { weather, safetyCar };
  const leaderId = at(state.order, 0);
  const prevDistance = cars.map((c) => c.distance);
  for (const car of cars) {
    if (car.finishTime !== null) continue;
    if (car.pitTimeRemaining > 0) {
      car.pitTimeRemaining = Math.max(0, car.pitTimeRemaining - SIM_DT);
      continue;
    }
    const lapFraction = SIM_DT / effectiveLapTime(car, conditions, car.id === leaderId);
    const from = car.distance;
    const to = from + lapFraction;
    car.distance = to;

    const wearBefore = car.tyreWear;
    car.tyreWear = clamp(wearBefore + WEAR_PER_LAP[car.compound][weather] * MODE_WEAR[car.mode] * lapFraction, 0, 100);
    if (wearBefore < TYRE_CRITICAL_WEAR && car.tyreWear >= TYRE_CRITICAL_WEAR) {
      emit({ type: 'TYRES_CRITICAL', carId: car.id });
    }
    car.fuel = Math.max(0, car.fuel - FUEL_PER_LAP * MODE_FUEL[car.mode] * lapFraction);

    const line = Math.floor(to);
    if (line <= Math.floor(from) || line < 1) continue; // no crossing (line 0 is the grid start, not a lap)
    const crossTime = state.time + ((line - from) / (to - from)) * SIM_DT;
    car.lastLapTime = crossTime - car.lapStartTime;
    car.lapStartTime = crossTime;
    car.tyreAgeLaps += 1;
    if (line >= LAPS) {
      car.finishTime = crossTime;
      emit({ type: 'CHEQUERED_FLAG', carId: car.id });
    } else if (car.boxQueued) {
      const compound = stopCompound(car, weather);
      car.compound = compound;
      car.tyreWear = 0;
      car.tyreAgeLaps = 0;
      car.punctured = false;
      car.pitTimeRemaining = safetyCar.active ? PIT_LOSS_SC : PIT_LOSS;
      car.pitStops += 1;
      car.boxQueued = false;
      car.distance = line; // parked on the line for the stop
      emit({ type: 'PIT_STOP', carId: car.id, compound });
    }
  }

  // 5. Racing / overtakes. Exactly FIELD_SIZE − 1 draws, one per adjacent pair, always.
  const seq = [...state.order];
  for (let i = 1; i < FIELD_SIZE; i += 1) {
    const roll = rng();
    const behind = at(cars, at(seq, i));
    if (!onTrack(behind)) continue;
    let j = i - 1;
    while (j >= 0 && !onTrack(at(cars, at(seq, j)))) j -= 1;
    if (j < 0) continue;
    const ahead = at(cars, at(seq, j));
    if (behind.distance <= ahead.distance - FOLLOW_GAP_LAPS) continue; // not close enough to matter

    const paceDelta = lapTimeFor(ahead, conditions) - lapTimeFor(behind, conditions);
    const p =
      clamp(paceDelta * OVERTAKE_PROB_PER_S, 0, OVERTAKE_PROB_MAX) *
      (ahead.mode === 'defend' ? OVERTAKE_DEFEND_FACTOR : 1);
    // A pass never straddles the start/finish line, so swapping distances cannot add or
    // remove a lap crossing that phase 4 already processed.
    const sameLap = Math.floor(behind.distance) === Math.floor(ahead.distance);
    if (!safetyCar.active && sameLap && roll < p) {
      if (behind.distance < ahead.distance) {
        const passed = ahead.distance;
        ahead.distance = behind.distance;
        behind.distance = passed;
      }
      seq[j] = behind.id;
      seq[i] = ahead.id;
      emit({ type: 'OVERTAKE', carId: behind.id, otherCarId: ahead.id });
    } else {
      // Held at the follow gap, but never moved back past where it started this tick or
      // back over a line it crossed this tick (that would count the lap twice).
      const from = at(prevDistance, behind.id);
      const line = Math.floor(behind.distance);
      const floorDistance = line > Math.floor(from) && line >= 1 ? line : from;
      behind.distance = Math.max(floorDistance, Math.min(behind.distance, ahead.distance - FOLLOW_GAP_LAPS));
    }
  }

  // 6. Order, positions, gaps, leader lap.
  const time = state.time + SIM_DT;
  const order = computeOrder(cars);
  const standings = withStandings(cars, order, time, weather);
  const leaderLap = clamp(Math.floor(at(standings, at(order, 0)).distance) + 1, 1, LAPS);
  if (startLap < LAPS && leaderLap === LAPS) emit({ type: 'FINAL_LAP' }, leaderLap);

  // 7. Clock and phase.
  const nextTick = tick + 1;
  const allFinished = standings.every((c) => c.finishTime !== null);
  return {
    ...state,
    tick: nextTick,
    time,
    phase: allFinished || nextTick >= RACE_TICK_LIMIT ? 'finished' : 'racing',
    weather,
    rainStartedLap,
    safetyCar,
    leaderLap,
    cars: standings,
    order,
    tickEvents: events,
    eventLog: events.length > 0 ? [...state.eventLog, ...events] : state.eventLog,
  };
}
