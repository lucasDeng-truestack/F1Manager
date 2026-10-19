import { useEffect } from 'react';
import { PLAYER_ID } from '../sim/constants';
import { startGameLoop } from '../state/loop';
import { useGameStore } from '../state/store';
import { CommandButtons } from './CommandButtons';
import { ordinal } from './format';
import { KeyHints } from './KeyHints';
import { PttIndicator } from './PttIndicator';
import { RaceHud } from './RaceHud';
import { RadioLog } from './RadioLog';
import { TimingTower } from './TimingTower';
import { TrackCanvas } from './TrackCanvas';
import styles from './RaceScreen.module.css';

function ChequeredFlag() {
  const finished = useGameStore((s) => s.race?.phase === 'finished');
  const position = useGameStore((s) => s.race?.cars[PLAYER_ID]?.position);
  if (!finished) return null;
  return (
    <div className={styles.flag} role="status">
      <div className={styles.flagCard}>
        <span className={styles.flagTitle}>Chequered flag</span>
        {position !== undefined && <span className={styles.flagPos}>You finish {ordinal(position)}</span>}
        <span className={styles.flagSub}>Debrief coming up…</span>
      </div>
    </div>
  );
}

export function RaceScreen() {
  const hasRace = useGameStore((s) => s.race !== null);

  useEffect(() => startGameLoop(), []);

  if (!hasRace) {
    return <main className={styles.screen}><p className={styles.waiting}>Getting the cars on the grid…</p></main>;
  }

  return (
    <main className={styles.screen}>
      <div className={styles.hud}><RaceHud /></div>
      <div className={styles.tower}><TimingTower /></div>
      <div className={styles.track}>
        <TrackCanvas />
        <ChequeredFlag />
      </div>
      <div className={styles.side}>
        <PttIndicator />
        <RadioLog />
      </div>
      <div className={styles.controls}>
        <CommandButtons />
        <div className={styles.hints}><KeyHints /></div>
      </div>
    </main>
  );
}
