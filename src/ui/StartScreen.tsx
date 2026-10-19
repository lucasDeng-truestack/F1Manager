import { useEffect, useRef, useState, type FormEvent } from 'react';
import { DEFAULT_SEED, LAPS } from '../sim/constants';
import { useGameStore } from '../state/store';
import { KeyHints } from './KeyHints';
import { ModelStatus } from './ModelStatus';
import { StartLights } from './StartLights';
import styles from './StartScreen.module.css';

/** Time the five lights take to go out before the race starts (matches theme --dur-light-step × 5). */
function lightsOutDelayMs(): number {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return 0;
  const step = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dur-light-step'));
  return Number.isFinite(step) ? step * 5 : 0;
}

export function StartScreen() {
  const seed = useGameStore((s) => s.seed);
  const setSeed = useGameStore((s) => s.setSeed);
  const startRace = useGameStore((s) => s.startRace);
  const [lightsOut, setLightsOut] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (lightsOut) return;
    if (seed.trim() === '') setSeed(DEFAULT_SEED);
    setLightsOut(true);
    timer.current = window.setTimeout(() => startRace(), lightsOutDelayMs());
  };

  return (
    <main className={styles.screen}>
      <div className={styles.column}>
        <StartLights out={lightsOut} />
        <h1 className={styles.title}>BOX BOX!</h1>
        <p className={styles.premise}>
          You are the race engineer. {LAPS} laps, nine rivals, one radio. Your driver does what you say.
        </p>

        <form className={styles.form} onSubmit={onSubmit}>
          <label className={styles.label} htmlFor="seed">Race seed</label>
          <div className={styles.formRow}>
            <input
              id="seed"
              className={styles.input}
              value={seed}
              onChange={(e) => setSeed(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              aria-describedby="seed-help"
            />
            <button type="submit" className={styles.go} disabled={lightsOut}>Lights out</button>
          </div>
          <p id="seed-help" className={styles.help}>Same seed, same race — weather, safety car and all.</p>
        </form>

        <ModelStatus />

        <section className={styles.howto} aria-labelledby="howto-title">
          <h2 id="howto-title" className={styles.h2}>On the radio</h2>
          <p className={styles.help}>
            Hold <strong>Space</strong> and say “box box”, “push”, “save tyres”, “defend” or “plan B”.
            No mic? The keys and on-screen buttons make the same calls.
          </p>
          <KeyHints />
        </section>
      </div>
    </main>
  );
}
