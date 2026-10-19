import type { CarMode, Compound, Plan, Weather } from './types';

export const LAPS = 15;
export const FIELD_SIZE = 10;
export const PLAYER_ID = 0;
export const CAR_CODES: readonly string[] = ['YOU', 'RAV', 'KOV', 'DUM', 'SAL', 'OKA', 'BRN', 'VEL', 'MAR', 'TIK'];
export const DEFAULT_SEED = 'monza-42';

// Time
export const TICK_MS = 100;               // real ms per sim tick (game loop)
export const SIM_DT = 0.375;              // sim s per tick → 90 s lap ≈ 240 ticks ≈ 24 s real
export const MAX_TICKS_PER_FRAME = 5;     // accumulator clamp after tab switch
export const RACE_TICK_LIMIT = 12000;     // hard stop safety net

// Pace
export const BASE_LAP_TIME = 90;
export const CAR_PACE_SPREAD = 1.2;       // AI basePace ∈ BASE_LAP_TIME ± spread/2
export const PLAYER_PACE_OFFSET = 0;
export const PLAYER_GRID_MIN = 4;         // seeded start position, 1-based inclusive
export const PLAYER_GRID_MAX = 7;
export const GRID_GAP_S = 0.3;
export const PLAYER_START_COMPOUND: Compound = 'M';
export const AI_START_COMPOUNDS: readonly Compound[] = ['S', 'M'];
export const COMPOUND_PACE: Record<Compound, Record<Weather, number>> = {
  S: { dry: -0.8, wet: 7 }, M: { dry: 0, wet: 7.5 }, H: { dry: 0.6, wet: 8 }, I: { dry: 3, wet: 0 },
};
export const RAIN_LAP_TIME_DELTA = 6;

// Tyres
export const WEAR_PER_LAP: Record<Compound, Record<Weather, number>> = {
  S: { dry: 9, wet: 9 }, M: { dry: 6.5, wet: 6 }, H: { dry: 4, wet: 4 }, I: { dry: 12, wet: 4 },
};
export const WEAR_PACE_LOSS = 4.5;        // s/lap at 100 % (linear part)
export const WEAR_CLIFF = 75;
export const WEAR_CLIFF_LOSS_PER_PCT = 0.4;
export const TYRE_CRITICAL_WEAR = 80;

// Fuel
export const FUEL_START = 110;
export const FUEL_PER_LAP = 7;
export const FUEL_PACE_PER_KG = 0.03;

// Modes
export const MODE_PACE: Record<CarMode, number> = { normal: 0, push: -0.6, save: 0.8, defend: 0.3 };
export const MODE_WEAR: Record<CarMode, number> = { normal: 1, push: 1.6, save: 0.7, defend: 1.1 };
export const MODE_FUEL: Record<CarMode, number> = { normal: 1, push: 1.15, save: 0.9, defend: 1 };

// Pit
export const PIT_LOSS = 22;
export const PIT_LOSS_SC = 12;
export const PLAN_COMPOUND: Record<Plan, Compound> = { A: 'H', B: 'S' };
export const WET_COMPOUND: Compound = 'I';

// Racing
export const MIN_FOLLOW_GAP_S = 0.3;
export const OVERTAKE_PROB_PER_S = 0.04;  // per tick, per s/lap of pace advantage
export const OVERTAKE_PROB_MAX = 0.08;
export const OVERTAKE_DEFEND_FACTOR = 0.35;
export const DEFEND_RANGE_S = 1.0;

// Events (scheduled once per race from the `${seed}:events` stream)
export const SAFETY_CAR_PROB = 0.35;
export const SC_LAP_MIN = 3;
export const SC_LAP_MAX = 11;
export const SC_DURATION_MIN = 2;
export const SC_DURATION_MAX = 3;
export const SC_LAP_TIME = 120;
export const SC_CATCHUP_LAP_TIME = 100;
export const SC_TRAIN_GAP_S = 0.8;
export const RAIN_PROB = 0.3;
export const RAIN_LAP_MIN = 4;
export const RAIN_LAP_MAX = 12;
export const PUNCTURE_PROB = 0.25;
export const PUNCTURE_PLAYER_SHARE = 0.3;
export const PUNCTURE_LAP_MIN = 2;
export const PUNCTURE_LAP_MAX = 13;
export const PUNCTURE_PACE_LOSS = 25;

// AI
export const AI_PIT_LAP_MIN = 5;
export const AI_PIT_LAP_MAX = 10;
export const AI_PIT_WEAR = 65;
export const AI_RAIN_REACT_MAX_LAPS = 1;
export const AI_PUSH_FINAL_LAPS = 3;
export const AI_PUSH_MAX_WEAR = 60;       // AI only pushes late if wear is below this
export const AI_EARLY_STOP_COMPOUND: Compound = 'H'; // pitLap ≤ middle of the AI pit window
export const AI_LATE_STOP_COMPOUND: Compound = 'M';

// Radio (content)
export const RADIO_COOLDOWN_TICKS = 160;  // ~16 s real between repeats of one unprompted trigger
export const RADIO_LATE_RACE_LAPS = 3;      // late_dead_tyres: lap >= LAPS - this
export const RADIO_PUSH_DEAD_WEAR = 70;     // push_on_dead_tyres: wear > this
export const RADIO_POINTLESS_STOP_WEAR = 20; // pointless_stop: wear < this
export const RADIO_FRESH_TYRES_WEAR = 15;   // save_fresh_tyres: wear < this
export const RADIO_PODIUM_LAST = 3;         // finish lines: podium up to this position
export const RADIO_POINTS_LAST = 6;         // finish lines: points up to this position
