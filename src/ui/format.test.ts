import { describe, expect, it } from 'vitest';
import type { CallImpact } from '../sim/types';
import type { CallRecord } from '../state/types';
import {
  formatGap, formatPositionDelta, formatRaceTime, formatTimeDelta, impactTone, ordinal, pairCallsWithImpacts,
} from './format';

const call = (command: CallRecord['command'], tick: number): CallRecord => ({ tick, lap: 1, command, source: 'keyboard', transcript: null });
const impact = (tick: number, timeDelta: number, positionDelta = 0): CallImpact => ({ tick, lap: 1, command: 'PUSH', timeDelta, positionDelta });

describe('format helpers', () => {
  it('formats gaps and race time', () => {
    expect(formatGap(1.23456)).toBe('+1.235');
    expect(formatGap(-0.1)).toBe('+0.000');
    expect(formatRaceTime(1365.04)).toBe('22:45.0');
    expect(formatRaceTime(65.4)).toBe('1:05.4');
  });

  it('formats signed deltas with a real minus sign', () => {
    expect(formatTimeDelta(1.84)).toBe('+1.8 s');
    expect(formatTimeDelta(-3.16)).toBe('−3.2 s');
    expect(formatTimeDelta(0.02)).toBe('±0.0 s');
    expect(formatPositionDelta(2)).toBe('+2 places');
    expect(formatPositionDelta(-1)).toBe('−1 place');
    expect(formatPositionDelta(0)).toBe('');
  });

  it('picks a tone, positions first', () => {
    expect(impactTone({ timeDelta: -2, positionDelta: 1 })).toBe('gain');
    expect(impactTone({ timeDelta: 2, positionDelta: -1 })).toBe('loss');
    expect(impactTone({ timeDelta: 0.01, positionDelta: 0 })).toBe('neutral');
  });

  it('ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st']);
  });
});

describe('pairCallsWithImpacts', () => {
  const calls = [call('PUSH', 10), call('UNKNOWN', 20), call('BOX', 30)];

  it('skips UNKNOWN when consuming impacts', () => {
    const rows = pairCallsWithImpacts(calls, [impact(10, 1), impact(30, -2)], 2);
    expect(rows.map((r) => r.kind)).toEqual(['scored', 'unknown', 'scored']);
    expect(rows[2]?.kind === 'scored' && rows[2].impact.tick).toBe(30);
  });

  it('is pending until every input has an impact', () => {
    const rows = pairCallsWithImpacts(calls, [impact(10, 1)], 2);
    expect(rows.map((r) => r.kind)).toEqual(['pending', 'unknown', 'pending']);
  });

  it('handles zero calls', () => {
    expect(pairCallsWithImpacts([], [], 0)).toEqual([]);
  });
});
