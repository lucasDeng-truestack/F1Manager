import { PLAYER_ID, RADIO_COOLDOWN_TICKS, RADIO_PODIUM_LAST, RADIO_POINTS_LAST } from '../sim/constants';
import type { Compound, ParsedCommand, RaceEvent, RaceState, Rng } from '../sim/types';
import {
  classifyBox, classifyDefend, classifyPlan, classifyPush, classifySave,
} from './classify';
import { responses, sayAgain, type Pool } from './responses';
import { pitExit, unprompted, type UnpromptedTrigger } from './unprompted';

export type RadioMemory = { lastFired: Partial<Record<UnpromptedTrigger, number>> };

/** At most this many unprompted driver lines per sim step. */
export const MAX_UNPROMPTED_PER_STEP = 2;

/**
 * Unprompted priority, highest first. When more triggers fire in one step than
 * MAX_UNPROMPTED_PER_STEP allows, the lower ones are dropped (and not marked as fired).
 */
export const UNPROMPTED_PRIORITY: readonly UnpromptedTrigger[] = [
  'finish_win', 'finish_podium', 'finish_points', 'finish_back',
  'puncture',
  'safety_car_out',
  'rain',
  'tyres_gone',
  'overtake_lost',
  'overtake_made',
  'pit_exit',
  'safety_car_in',
  'final_lap',
  'lights_out',
];

/** Deterministic line pick from the passed-in RNG (one draw). */
export function pickLine(pool: Pool, rng: Rng): string {
  return pool[Math.floor(rng() * pool.length)] ?? pool[0];
}

export function createRadioMemory(): RadioMemory {
  return { lastFired: {} };
}

/** Driver reply to an engineer command. `state` is the state BEFORE the command is applied. */
export function respond(state: RaceState, command: ParsedCommand, rng: Rng): string {
  const car = state.cars[PLAYER_ID];
  if (command === 'UNKNOWN') return pickLine(sayAgain, rng);
  if (car === undefined) return pickLine(responses[command].default, rng);
  switch (command) {
    case 'BOX': return pickLine(responses.BOX[classifyBox(state, car)], rng);
    case 'PUSH': return pickLine(responses.PUSH[classifyPush(state, car)], rng);
    case 'SAVE_TYRES': return pickLine(responses.SAVE_TYRES[classifySave(car)], rng);
    case 'DEFEND': return pickLine(responses.DEFEND[classifyDefend(state, car)], rng);
    case 'PLAN_B': return pickLine(responses.PLAN_B[classifyPlan(car)], rng);
    case 'COPY': return pickLine(responses.COPY.default, rng);
  }
}

function finishTrigger(position: number): UnpromptedTrigger {
  if (position === 1) return 'finish_win';
  if (position <= RADIO_PODIUM_LAST) return 'finish_podium';
  if (position <= RADIO_POINTS_LAST) return 'finish_points';
  return 'finish_back';
}

function isPlayer(e: RaceEvent): boolean {
  return e.carId === PLAYER_ID;
}

/**
 * Compound the player rejoined on if this step released them from the pit box, else null.
 * The sim emits PIT_STOP when the car ENTERS the box (tyres fitted, pitTimeRemaining set), then
 * counts pitTimeRemaining down to 0 while the car sits there; the step where it reaches 0 is the
 * rejoin. The compound cannot change while stationary, so `next`'s compound is the one fitted.
 */
function pitExitCompound(prev: RaceState, next: RaceState): Compound | null {
  const before = prev.cars[PLAYER_ID];
  const after = next.cars[PLAYER_ID];
  if (before === undefined || after === undefined) return null;
  return before.pitTimeRemaining > 0 && after.pitTimeRemaining === 0 ? after.compound : null;
}

/** Triggers raised by this step (its events plus the pit-exit transition), and the pit-exit pool. */
function detectTriggers(prev: RaceState, next: RaceState): { triggers: Set<UnpromptedTrigger>; exitPool: Pool | null } {
  const triggers = new Set<UnpromptedTrigger>();
  const compound = pitExitCompound(prev, next);
  if (compound !== null) triggers.add('pit_exit');
  for (const e of next.tickEvents) {
    switch (e.type) {
      case 'LIGHTS_OUT': triggers.add('lights_out'); break;
      case 'FINAL_LAP': triggers.add('final_lap'); break;
      case 'SAFETY_CAR_DEPLOYED': triggers.add('safety_car_out'); break;
      case 'SAFETY_CAR_IN': triggers.add('safety_car_in'); break;
      case 'RAIN_START': triggers.add('rain'); break;
      case 'TYRES_CRITICAL': if (isPlayer(e)) triggers.add('tyres_gone'); break;
      case 'PUNCTURE': if (isPlayer(e)) triggers.add('puncture'); break;
      case 'PIT_STOP': break; // box entry; the driver speaks on rejoin (pitExitCompound)
      case 'OVERTAKE':
        if (e.carId === PLAYER_ID) triggers.add('overtake_made');
        if (e.otherCarId === PLAYER_ID) triggers.add('overtake_lost');
        break;
      case 'CHEQUERED_FLAG': {
        const pos = next.cars[PLAYER_ID]?.position;
        if (isPlayer(e) && pos !== undefined) triggers.add(finishTrigger(pos));
        break;
      }
      case 'COMMAND_APPLIED': break;
    }
  }
  return { triggers, exitPool: compound === null ? null : pitExit[compound] };
}

function coolingDown(memory: RadioMemory, trigger: UnpromptedTrigger, tick: number): boolean {
  const last = memory.lastFired[trigger];
  return last !== undefined && tick - last < RADIO_COOLDOWN_TICKS;
}

/**
 * Driver lines the driver radios in on their own after one sim step. Pure: returns a new memory.
 * `prev` is the state the step started from, `next` the state it produced (pass the same state
 * twice for the pre-race call). Draws from `rng` once per emitted line, in UNPROMPTED_PRIORITY order.
 */
export function unpromptedCalls(
  prev: RaceState, next: RaceState, memory: RadioMemory, rng: Rng,
): { lines: string[]; memory: RadioMemory } {
  const { triggers, exitPool } = detectTriggers(prev, next);
  const lastFired = { ...memory.lastFired };
  const lines: string[] = [];
  for (const trigger of UNPROMPTED_PRIORITY) {
    if (lines.length >= MAX_UNPROMPTED_PER_STEP) break;
    if (!triggers.has(trigger) || coolingDown(memory, trigger, next.tick)) continue;
    const pool = trigger === 'pit_exit' ? exitPool : unprompted[trigger];
    if (pool === null) continue; // unreachable: pit_exit is only raised alongside its pool
    lines.push(pickLine(pool, rng));
    lastFired[trigger] = next.tick;
  }
  return { lines, memory: { lastFired } };
}
