// Keyboard fallback: one key per command, through the same issueCommand as voice.
// Space is push-to-talk and belongs to src/voice/recorder.ts — never handled here.
import type { Command } from '../sim/types';
import { isEditableTarget } from '../voice/editable';
import { useGameStore } from './store';

// Shared with Space push-to-talk so both agree on "typing in a field"; re-exported for existing imports.
export { isEditableTarget };

/** The single source of the key map; the UI's key hints read this too. */
export const KEY_BINDINGS: readonly { key: string; command: Command }[] = [
  { key: 'B', command: 'BOX' },
  { key: 'P', command: 'PUSH' },
  { key: 'S', command: 'SAVE_TYRES' },
  { key: 'D', command: 'DEFEND' },
  { key: 'A', command: 'PLAN_B' },
  { key: 'C', command: 'COPY' },
];

/** The parts of a KeyboardEvent the mapping looks at (keeps it testable without a DOM). */
export interface KeyLike {
  key: string;
  code?: string;
  repeat?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  isComposing?: boolean;
  target?: EventTarget | null;
}

const LATIN_LETTER = /^[a-z]$/i;

/**
 * The command a key press means, or null. Matches the typed letter (so AZERTY's A is A);
 * on a non-Latin layout, where the letter is not a-z, falls back to the physical key.
 */
export function commandForKey(e: KeyLike): Command | null {
  if (e.repeat === true || e.ctrlKey === true || e.metaKey === true || e.altKey === true) return null;
  if (e.isComposing === true || isEditableTarget(e.target)) return null;
  const typed = LATIN_LETTER.test(e.key) ? e.key.toUpperCase() : null;
  const binding = KEY_BINDINGS.find((b) => (typed !== null ? b.key === typed : e.code === `Key${b.key}`));
  return binding?.command ?? null;
}

let users = 0;
let detach: (() => void) | null = null;

/**
 * Listens for the fallback keys on window. Reference counted: attaching twice (StrictMode)
 * still means one listener; each returned cleanup counts once.
 */
export function attachKeyboard(): () => void {
  users += 1;
  if (detach === null) {
    const onKeyDown = (e: KeyboardEvent): void => {
      const command = commandForKey(e);
      if (command === null) return;
      const store = useGameStore.getState();
      if (store.screen === 'race') e.preventDefault(); // elsewhere the letter keeps its default
      store.issueCommand(command, 'keyboard');
    };
    window.addEventListener('keydown', onKeyDown);
    detach = () => window.removeEventListener('keydown', onKeyDown);
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    users -= 1;
    if (users === 0 && detach !== null) {
      detach();
      detach = null;
    }
  };
}
