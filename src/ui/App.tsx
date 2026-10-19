import { useEffect } from 'react';
import { attachKeyboard } from '../state/keyboard';
import { useGameStore } from '../state/store';
import { initVoice } from '../state/voice';
import { DebriefScreen } from './DebriefScreen';
import { RaceScreen } from './RaceScreen';
import { StartScreen } from './StartScreen';

export function App() {
  const screen = useGameStore((s) => s.screen);

  // Global wiring, once: model download + Space push-to-talk, and the B/P/S/D… fallback keys.
  useEffect(() => {
    const stopVoice = initVoice();
    const detachKeys = attachKeyboard();
    return () => {
      detachKeys();
      stopVoice();
    };
  }, []);

  if (screen === 'race') return <RaceScreen />;
  if (screen === 'debrief') return <DebriefScreen />;
  return <StartScreen />;
}
