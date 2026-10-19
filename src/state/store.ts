// The game store: race, command log, radio log, voice status. No sim logic here — `step`
// does the racing; this file only sequences it and records what the engineer said.
// No DOM, worker or timer side effects (loop.ts, voice.ts and keyboard.ts own those).
import { create } from 'zustand';
import { createRadioMemory, respond, unpromptedCalls, type RadioMemory } from '../content';
import { DEFAULT_SEED, PLAYER_ID, createRace, createRng, step } from '../sim';
import type { Command, ParsedCommand, RaceState, Rng } from '../sim/types';
import { parse } from '../voice/parser';
import type { GameState, GameStore, RadioLine, VoiceState } from './types';

/** What the engineer's own line reads as when a call came from a key, not the mic. */
export const ENGINEER_PHRASES: Readonly<Record<ParsedCommand, string>> = {
  BOX: 'Box, box.',
  PUSH: 'Push now.',
  SAVE_TYRES: 'Save the tyres.',
  DEFEND: 'Defend.',
  PLAN_B: 'Plan B.',
  COPY: 'Copy.',
  UNKNOWN: 'Radio check.',
};

export const INITIAL_VOICE: Readonly<VoiceState> = {
  model: 'idle', modelId: null, device: null, progress: 0, mic: 'idle', ptt: 'off', error: null,
};

/**
 * Per-race, module-local (never in the store, never shared). `raceRng` is the one
 * `createRng(seed, 'race')` of the live race and is drawn from by `step` only.
 */
interface RaceSession {
  race: RaceState;  // the latest state of the race these belong to (identity = stale guard)
  raceRng: Rng;
  radioRng: Rng;
  memory: RadioMemory;
  nextLineId: number;
}
let session: RaceSession | null = null;

/** The session of `race`, or null if it belongs to another (or no) race. */
function sessionFor(race: RaceState | null): RaceSession | null {
  return race !== null && session !== null && session.race === race ? session : null;
}

function line(s: RaceSession, race: RaceState, tick: number, speaker: RadioLine['speaker'], text: string): RadioLine {
  return { id: s.nextLineId++, tick, lap: race.leaderLap, speaker, text };
}

function isRacing(state: GameState): state is GameState & { race: RaceState } {
  return state.screen === 'race' && state.race !== null && state.race.phase === 'racing';
}

/** Commands recorded for `tick`, in issue order. Inputs are appended in tick order. */
function commandsAt(inputs: GameState['inputs'], tick: number): Command[] {
  const out: Command[] = [];
  for (let i = inputs.length - 1; i >= 0; i--) {
    const input = inputs[i];
    if (input === undefined || input.tick < tick) break;
    if (input.tick === tick) out.push(input.command);
  }
  return out.reverse();
}

export function initialGameState(): GameState {
  return {
    screen: 'start',
    seed: DEFAULT_SEED,
    race: null,
    prevRace: null,
    inputs: [],
    calls: [],
    radio: [],
    voice: { ...INITIAL_VOICE },
    impacts: [],
  };
}

export const useGameStore = create<GameStore>()((set, get) => ({
  ...initialGameState(),

  setSeed(seed) {
    set({ seed });
  },

  startRace() {
    const seed = get().seed.trim() || DEFAULT_SEED;
    const race = createRace(seed);
    const s: RaceSession = {
      race,
      raceRng: createRng(seed, 'race'),
      radioRng: createRng(seed, 'radio'),
      memory: createRadioMemory(),
      nextLineId: 1,
    };
    session = s;
    // createRace carries LIGHTS_OUT in its tickEvents; the first step never repeats it.
    const { lines, memory } = unpromptedCalls(race, race, s.memory, s.radioRng);
    s.memory = memory;
    set({
      screen: 'race',
      seed,
      race,
      prevRace: null,
      inputs: [],
      calls: [],
      radio: lines.map((text) => line(s, race, race.tick, 'driver', text)),
      impacts: [],
    });
  },

  advance() {
    const state = get();
    if (!isRacing(state)) return;
    const s = sessionFor(state.race);
    if (s === null) return;
    const prev = state.race;
    const next = step(prev, commandsAt(state.inputs, prev.tick), s.raceRng);
    s.race = next;
    const { lines, memory } = unpromptedCalls(prev, next, s.memory, s.radioRng);
    s.memory = memory;
    set({
      prevRace: prev,
      race: next,
      radio: lines.length === 0
        ? state.radio
        : [...state.radio, ...lines.map((text) => line(s, next, prev.tick, 'driver', text))],
    });
  },

  issueCommand(cmd, source, transcript) {
    const state = get();
    if (!isRacing(state)) return;
    const s = sessionFor(state.race);
    if (s === null) return;
    const race = state.race;
    // The player has taken the flag (the rest of the field may still be racing): nothing it
    // says changes its race any more. Return before anything is recorded — the debrief pairs
    // every non-UNKNOWN call with exactly one input.
    const player = race.cars[PLAYER_ID];
    if (player !== undefined && player.finishTime !== null) return;
    const spoken = transcript?.trim() ?? '';
    // A call made while race.tick === T is applied by the step that processes tick T.
    const tick = race.tick;
    const engineer = line(s, race, tick, 'engineer', spoken === '' ? ENGINEER_PHRASES[cmd] : spoken);
    const driver = line(s, race, tick, 'driver', respond(race, cmd, s.radioRng));
    set({
      inputs: cmd === 'UNKNOWN' ? state.inputs : [...state.inputs, { tick, command: cmd }],
      calls: [...state.calls, { tick, lap: race.leaderLap, command: cmd, source, transcript: spoken === '' ? null : spoken }],
      radio: [...state.radio, engineer, driver],
    });
  },

  handleTranscript(text) {
    const { voice } = get();
    if (voice.ptt === 'thinking') set({ voice: { ...voice, ptt: 'off' } });
    const spoken = text.trim();
    if (spoken === '') return;
    if (!isRacing(get())) return;
    get().issueCommand(parse(spoken).command, 'voice', spoken);
  },

  setVoice(patch) {
    set((state) => ({ voice: { ...state.voice, ...patch } }));
  },

  backToStart() {
    session = null;
    set({ screen: 'start', race: null, prevRace: null, inputs: [], calls: [], radio: [], impacts: [] });
  },
}));
