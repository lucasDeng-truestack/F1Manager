import {
  DEFEND_RANGE_S, LAPS, PLAYER_ID, RADIO_FRESH_TYRES_WEAR, RADIO_LATE_RACE_LAPS, RADIO_POINTLESS_STOP_WEAR,
  RADIO_PUSH_DEAD_WEAR, TYRE_CRITICAL_WEAR,
} from '../sim/constants';
import type { CarState, ParsedCommand, RaceState } from '../sim/types';
import type { Situations } from './responses';

export type Situation = Situations[keyof Situations] | 'say_again';

function isFinalLap(car: CarState): boolean {
  return car.lap === LAPS;
}

/** True when nobody is within DEFEND_RANGE_S behind the player (or the player is last). */
function nobodyBehind(state: RaceState): boolean {
  const idx = state.order.indexOf(PLAYER_ID);
  if (idx < 0) return true;
  const behindId = state.order[idx + 1];
  if (behindId === undefined) return true;
  const behind = state.cars[behindId];
  return behind === undefined || behind.gapToAhead > DEFEND_RANGE_S;
}

export function classifyBox(state: RaceState, car: CarState): Situations['BOX'] {
  if (car.boxQueued) return 'box_cancel';
  if (car.punctured) return 'box_puncture';
  if (isFinalLap(car)) return 'box_final_lap';
  if (state.weather === 'wet' && car.compound !== 'I') return 'box_rain_slicks';
  if (state.weather === 'dry' && car.compound === 'I') return 'box_dry_inters';
  if (state.safetyCar.active) return 'box_under_sc';
  if (car.tyreWear > TYRE_CRITICAL_WEAR && car.lap >= LAPS - RADIO_LATE_RACE_LAPS) return 'late_dead_tyres';
  if (car.tyreWear < RADIO_POINTLESS_STOP_WEAR) return 'pointless_stop';
  return 'default';
}

export function classifyPush(state: RaceState, car: CarState): Situations['PUSH'] {
  if (state.safetyCar.active) return 'push_under_sc';
  if (car.tyreWear > RADIO_PUSH_DEAD_WEAR) return 'push_on_dead_tyres';
  if (isFinalLap(car)) return 'push_final_lap';
  if (car.mode === 'push') return 'push_already';
  return 'default';
}

export function classifySave(car: CarState): Situations['SAVE_TYRES'] {
  if (isFinalLap(car)) return 'save_final_lap';
  if (car.tyreWear < RADIO_FRESH_TYRES_WEAR) return 'save_fresh_tyres';
  if (car.mode === 'save') return 'save_already';
  return 'default';
}

export function classifyDefend(state: RaceState, car: CarState): Situations['DEFEND'] {
  if (state.safetyCar.active) return 'defend_under_sc';
  if (nobodyBehind(state)) return 'defend_nobody';
  if (car.mode === 'defend') return 'defend_already';
  return 'default';
}

export function classifyPlan(car: CarState): Situations['PLAN_B'] {
  if (car.plan === 'A') return 'to_plan_b';
  if (car.plan === 'B') return 'to_plan_a';
  return 'default';
}

/**
 * Situation key for the driver's reply. `state` is the state BEFORE the command is applied.
 * Falls back to `default` if the player car is missing (should never happen).
 */
export function classify(state: RaceState, command: ParsedCommand): Situation {
  if (command === 'UNKNOWN') return 'say_again';
  const car = state.cars[PLAYER_ID];
  if (car === undefined) return 'default';
  switch (command) {
    case 'BOX': return classifyBox(state, car);
    case 'PUSH': return classifyPush(state, car);
    case 'SAVE_TYRES': return classifySave(car);
    case 'DEFEND': return classifyDefend(state, car);
    case 'PLAN_B': return classifyPlan(car);
    case 'COPY': return 'default';
  }
}
