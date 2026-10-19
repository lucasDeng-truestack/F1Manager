export type Compound = 'S' | 'M' | 'H' | 'I';
export type CarMode = 'normal' | 'push' | 'save' | 'defend';
export type Weather = 'dry' | 'wet';
export type Plan = 'A' | 'B';
export type Command = 'BOX' | 'PUSH' | 'SAVE_TYRES' | 'DEFEND' | 'PLAN_B' | 'COPY';
export type ParsedCommand = Command | 'UNKNOWN';
/** A seedrandom PRNG (or any () => [0,1) function). Stateful; never shared across streams. */
export type Rng = () => number;

export interface CommandInput { tick: number; command: Command } // applied to the player at the start of `tick`

export interface AiPlan { pitLap: number; stopCompound: Compound; rainReactLaps: number }

export interface CarState {
  id: number;                 // 0..FIELD_SIZE-1, PLAYER_ID = 0
  code: string;               // CAR_CODES[id]
  isPlayer: boolean;
  basePace: number;           // s/lap on fresh mediums, dry, normal mode, no fuel effect
  distance: number;           // laps travelled (float); starts ≤ 0 on the grid; finished at ≥ LAPS
  lap: number;                // current lap, 1..LAPS
  position: number;           // 1..FIELD_SIZE
  gapToLeader: number;        // s (0 for the leader)
  gapToAhead: number;         // s (0 for the leader)
  compound: Compound;
  tyreWear: number;           // 0..100
  tyreAgeLaps: number;
  fuel: number;               // kg
  mode: CarMode;
  plan: Plan;
  boxQueued: boolean;
  pitTimeRemaining: number;   // sim s left stationary in the pit; 0 = on track
  pitStops: number;
  punctured: boolean;
  lastLapTime: number | null;
  lapStartTime: number;       // sim time the current lap began
  finishTime: number | null;  // sim time the car crossed the line at LAPS
  ai: AiPlan | null;          // null for the player
}

export type RaceEventType =
  | 'LIGHTS_OUT' | 'FINAL_LAP' | 'CHEQUERED_FLAG'
  | 'SAFETY_CAR_DEPLOYED' | 'SAFETY_CAR_IN' | 'RAIN_START' | 'PUNCTURE'
  | 'PIT_STOP' | 'OVERTAKE' | 'TYRES_CRITICAL' | 'COMMAND_APPLIED';

export interface RaceEvent {
  tick: number;
  lap: number;                // leader lap when it happened
  type: RaceEventType;
  carId?: number;             // subject (OVERTAKE: the car that passed)
  otherCarId?: number;        // OVERTAKE: the car that was passed
  compound?: Compound;        // PIT_STOP: compound fitted
  command?: Command;          // COMMAND_APPLIED
}

export interface EventSchedule {
  safetyCarLap: number | null;   // leader lap on which SC deploys
  safetyCarLaps: number;         // duration in leader laps
  rainLap: number | null;
  puncture: { carId: number; lap: number } | null;
}

export interface SafetyCarState { active: boolean; endsAtLeaderDistance: number | null }

export interface RaceState {
  seed: string;
  tick: number;               // ticks completed; the next step processes this tick index
  time: number;               // sim seconds elapsed
  phase: 'racing' | 'finished';
  weather: Weather;
  rainStartedLap: number | null;
  safetyCar: SafetyCarState;
  leaderLap: number;          // 1..LAPS
  cars: CarState[];           // always ordered by id
  order: number[];            // car ids by position (sort: finished first by finishTime, then distance desc, tie → lower id)
  schedule: EventSchedule;
  tickEvents: RaceEvent[];    // events produced by the last step only
  eventLog: RaceEvent[];      // all events so far
}

export interface CallImpact {
  tick: number;
  lap: number;
  command: Command;
  timeDelta: number;          // s; positive = this call gained time vs not making it
  positionDelta: number;      // positive = finished higher because of it
}
