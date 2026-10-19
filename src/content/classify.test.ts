import { describe, expect, it } from 'vitest';
import {
  DEFEND_RANGE_S, LAPS, RADIO_FRESH_TYRES_WEAR, RADIO_LATE_RACE_LAPS, RADIO_POINTLESS_STOP_WEAR,
  RADIO_PUSH_DEAD_WEAR, TYRE_CRITICAL_WEAR,
} from '../sim/constants';
import type { ParsedCommand, RaceState } from '../sim/types';
import { classify } from './classify';
import { makeRace } from './testFixtures';

type Case = [name: string, command: ParsedCommand, state: RaceState, expected: string];

const sc = { safetyCar: { active: true, endsAtLeaderDistance: 8 } };
// Thresholds come from src/sim/constants.ts so retuning them never breaks these cases.
const DEAD = TYRE_CRITICAL_WEAR + 1;
const LATE_LAP = LAPS - RADIO_LATE_RACE_LAPS;

const cases: Case[] = [
  // BOX — first match wins, in this order
  ['box cancel', 'BOX', makeRace({ player: { boxQueued: true, punctured: true } }), 'box_cancel'],
  ['box puncture', 'BOX', makeRace({ player: { punctured: true, lap: LAPS } }), 'box_puncture'],
  ['box final lap', 'BOX', makeRace({ player: { lap: LAPS }, state: { weather: 'wet' } }), 'box_final_lap'],
  ['box rain on slicks', 'BOX', makeRace({ state: { weather: 'wet', ...sc } }), 'box_rain_slicks'],
  ['box dry on inters', 'BOX', makeRace({ player: { compound: 'I' }, state: sc }), 'box_dry_inters'],
  ['box under SC', 'BOX', makeRace({ player: { tyreWear: 5 }, state: sc }), 'box_under_sc'],
  ['late dead tyres', 'BOX', makeRace({ player: { tyreWear: DEAD, lap: LATE_LAP } }), 'late_dead_tyres'],
  ['late but wear at the threshold', 'BOX', makeRace({ player: { tyreWear: TYRE_CRITICAL_WEAR, lap: LATE_LAP } }), 'default'],
  ['pointless stop', 'BOX', makeRace({ player: { tyreWear: RADIO_POINTLESS_STOP_WEAR - 0.1 } }), 'pointless_stop'],
  ['pointless stop boundary', 'BOX', makeRace({ player: { tyreWear: RADIO_POINTLESS_STOP_WEAR } }), 'default'],
  ['box default (dead tyres, not late)', 'BOX', makeRace({ player: { tyreWear: DEAD, lap: LATE_LAP - 1 } }), 'default'],
  ['box default (wet on inters)', 'BOX', makeRace({ player: { compound: 'I' }, state: { weather: 'wet' } }), 'default'],
  // PUSH
  ['push under SC', 'PUSH', makeRace({ player: { tyreWear: 90 }, state: sc }), 'push_under_sc'],
  ['push dead tyres', 'PUSH', makeRace({ player: { tyreWear: RADIO_PUSH_DEAD_WEAR + 0.1, lap: LAPS } }), 'push_on_dead_tyres'],
  ['push final lap', 'PUSH', makeRace({ player: { lap: LAPS, mode: 'push' } }), 'push_final_lap'],
  ['push already', 'PUSH', makeRace({ player: { mode: 'push' } }), 'push_already'],
  ['push default (wear at the threshold)', 'PUSH', makeRace({ player: { tyreWear: RADIO_PUSH_DEAD_WEAR } }), 'default'],
  // SAVE_TYRES
  ['save final lap', 'SAVE_TYRES', makeRace({ player: { lap: LAPS, tyreWear: 5 } }), 'save_final_lap'],
  ['save fresh tyres', 'SAVE_TYRES', makeRace({ player: { tyreWear: RADIO_FRESH_TYRES_WEAR - 0.1, mode: 'save' } }), 'save_fresh_tyres'],
  ['save already', 'SAVE_TYRES', makeRace({ player: { mode: 'save' } }), 'save_already'],
  ['save default (wear at the threshold)', 'SAVE_TYRES', makeRace({ player: { tyreWear: RADIO_FRESH_TYRES_WEAR } }), 'default'],
  // DEFEND
  ['defend under SC', 'DEFEND', makeRace({ gapBehindPlayer: 0.5, state: sc }), 'defend_under_sc'],
  ['defend nobody (gap)', 'DEFEND', makeRace({ gapBehindPlayer: DEFEND_RANGE_S + 0.1 }), 'defend_nobody'],
  ['defend nobody (last)', 'DEFEND', makeRace({ playerPosition: 10, player: { mode: 'defend' } }), 'defend_nobody'],
  ['defend already', 'DEFEND', makeRace({ gapBehindPlayer: 0.5, player: { mode: 'defend' } }), 'defend_already'],
  ['defend default', 'DEFEND', makeRace({ gapBehindPlayer: DEFEND_RANGE_S }), 'default'],
  // PLAN_B
  ['to plan B', 'PLAN_B', makeRace({ player: { plan: 'A' } }), 'to_plan_b'],
  ['to plan A', 'PLAN_B', makeRace({ player: { plan: 'B' } }), 'to_plan_a'],
  // COPY / UNKNOWN
  ['copy default', 'COPY', makeRace({ player: { lap: LAPS }, state: sc }), 'default'],
  ['unknown', 'UNKNOWN', makeRace(), 'say_again'],
];

describe('classify', () => {
  it.each(cases)('%s', (_name, command, state, expected) => {
    expect(classify(state, command)).toBe(expected);
  });

  it('works before the race has started (tick 0, lap 1, grid)', () => {
    const grid = makeRace({ player: { lap: 1, tyreWear: 0, distance: -0.01 }, state: { tick: 0 } });
    expect(classify(grid, 'BOX')).toBe('pointless_stop');
    expect(classify(grid, 'SAVE_TYRES')).toBe('save_fresh_tyres');
  });

  it('PLAN_B default pool is unreachable but classify never throws for a missing player', () => {
    const empty = { ...makeRace(), cars: [] };
    expect(classify(empty, 'PLAN_B')).toBe('default');
  });
});
