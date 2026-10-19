import type { CallImpact, CarMode, Command, Compound, ParsedCommand } from '../sim/types';
import type { CallRecord } from '../state/types';

export const COMMAND_LABEL: Record<ParsedCommand, string> = {
  BOX: 'Box',
  PUSH: 'Push',
  SAVE_TYRES: 'Save tyres',
  DEFEND: 'Defend',
  PLAN_B: 'Plan B',
  COPY: 'Copy',
  UNKNOWN: 'Not understood',
};

export const COMPOUND_NAME: Record<Compound, string> = { S: 'Soft', M: 'Medium', H: 'Hard', I: 'Inter' };
export const MODE_LABEL: Record<CarMode, string> = { normal: 'Normal', push: 'Push', save: 'Save', defend: 'Defend' };

/** Unicode minus so negative numbers line up with the plus sign. */
const MINUS = '−';

/** Gap in seconds → "+1.234". */
export function formatGap(seconds: number): string {
  if (!Number.isFinite(seconds)) return '—';
  return `+${Math.max(0, seconds).toFixed(3)}`;
}

/** Sim seconds → "m:ss.s". */
export function formatRaceTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

/** Impact time delta (+ = gained) → "+1.8 s" / "−3.2 s" / "±0.0 s". */
export function formatTimeDelta(delta: number): string {
  const r = Math.round(delta * 10) / 10;
  if (r === 0) return '±0.0 s';
  return `${r > 0 ? '+' : MINUS}${Math.abs(r).toFixed(1)} s`;
}

/** Position delta (+ = finished higher) → "+2 pos" / "−1 pos" / "" when zero. */
export function formatPositionDelta(delta: number): string {
  if (delta === 0) return '';
  const n = Math.abs(delta);
  return `${delta > 0 ? '+' : MINUS}${n} ${n === 1 ? 'place' : 'places'}`;
}

export type Tone = 'gain' | 'loss' | 'neutral';

/** Overall verdict for an impact: positions dominate, then time (0.05 s dead band). */
export function impactTone(impact: Pick<CallImpact, 'timeDelta' | 'positionDelta'>): Tone {
  if (impact.positionDelta > 0) return 'gain';
  if (impact.positionDelta < 0) return 'loss';
  if (impact.timeDelta > 0.05) return 'gain';
  if (impact.timeDelta < -0.05) return 'loss';
  return 'neutral';
}

export function ordinal(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

export type CallRow =
  | { call: CallRecord; kind: 'unknown' }
  | { call: CallRecord; kind: 'pending'; command: Command }
  | { call: CallRecord; kind: 'scored'; command: Command; impact: CallImpact };

/**
 * Pair each call with its impact. `impacts[i]` belongs to `inputs[i]`; UNKNOWN calls never
 * produce an input, so walk the calls in order and consume one input per recognised call.
 * Impacts are pending until `impacts.length === inputCount`.
 */
export function pairCallsWithImpacts(calls: readonly CallRecord[], impacts: readonly CallImpact[], inputCount: number): CallRow[] {
  const ready = impacts.length === inputCount;
  let next = 0;
  return calls.map((call): CallRow => {
    if (call.command === 'UNKNOWN') return { call, kind: 'unknown' };
    const command = call.command;
    const impact = ready ? impacts[next] : undefined;
    next += 1;
    return impact ? { call, kind: 'scored', command, impact } : { call, kind: 'pending', command };
  });
}
