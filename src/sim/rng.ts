import seedrandom from 'seedrandom';
import type { Rng } from './types';

/**
 * One named sub-stream per concern: `grid`, `events`, `ai` (consumed in createRace),
 * `race` (created by the caller, threaded through `step`), `radio` (src/content only).
 * A new source of randomness gets a new stream so existing races never shift.
 */
export function createRng(seed: string, stream: string): Rng {
  return seedrandom(`${seed}:${stream}`);
}

/** Integer in [min, max] inclusive from one draw. */
export function randInt(rng: Rng, min: number, max: number): number {
  return Math.min(max, min + Math.floor(rng() * (max - min + 1)));
}

/** Element of a non-empty list from one draw. */
export function pick<T>(rng: Rng, items: readonly T[]): T {
  const item = items[Math.min(items.length - 1, Math.floor(rng() * items.length))];
  if (item === undefined) throw new Error('pick: empty list');
  return item;
}
