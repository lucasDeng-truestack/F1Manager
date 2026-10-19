import type { CallImpact, CommandInput, ParsedCommand, RaceState } from '../sim/types';
import type { Device, MicStatus, ModelId } from '../voice/protocol';

export type Screen = 'start' | 'race' | 'debrief';
export type CommandSource = 'voice' | 'keyboard';
export type PttStatus = 'off' | 'live' | 'thinking';
export type ModelStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface VoiceState {
  model: ModelStatus; modelId: ModelId | null; device: Device | null;
  progress: number;           // 0..100
  mic: MicStatus; ptt: PttStatus; error: string | null;
}
export interface RadioLine { id: number; tick: number; lap: number; speaker: 'engineer' | 'driver'; text: string }
export interface CallRecord { tick: number; lap: number; command: ParsedCommand; source: CommandSource; transcript: string | null }

export interface GameState {
  screen: Screen;
  seed: string;
  race: RaceState | null;
  prevRace: RaceState | null; // previous tick, for canvas interpolation
  inputs: CommandInput[];     // replayable player commands (UNKNOWN never stored)
  calls: CallRecord[];        // everything the engineer said, incl. UNKNOWN
  radio: RadioLine[];
  voice: VoiceState;
  impacts: CallImpact[];      // filled when the race finishes
}
export interface GameActions {
  setSeed(seed: string): void;
  startRace(): void;
  advance(): void;            // one sim step; no-op unless screen 'race' and phase 'racing'
  issueCommand(cmd: ParsedCommand, source: CommandSource, transcript?: string): void;
  handleTranscript(text: string): void;
  setVoice(patch: Partial<VoiceState>): void;
  backToStart(): void;
}
export type GameStore = GameState & GameActions;
