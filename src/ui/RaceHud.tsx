import { LAPS, PLAN_COMPOUND, PLAYER_ID, TYRE_CRITICAL_WEAR } from '../sim/constants';
import { useGameStore } from '../state/store';
import { MODE_LABEL } from './format';
import { TyreChip, WearBar } from './Tyre';
import styles from './RaceHud.module.css';

/** Race-wide banner strip plus the player's car telemetry. */
export function RaceHud() {
  const lap = useGameStore((s) => s.race?.leaderLap ?? 0);
  const phase = useGameStore((s) => s.race?.phase);
  const weather = useGameStore((s) => s.race?.weather);
  const scActive = useGameStore((s) => s.race?.safetyCar.active ?? false);
  const started = useGameStore((s) => (s.race ? s.race.tick > 0 : false));
  const me = useGameStore((s) => s.race?.cars[PLAYER_ID]);

  if (!me) return null;

  const finished = me.finishTime !== null;
  const inPit = me.pitTimeRemaining > 0;
  const critical = me.tyreWear >= TYRE_CRITICAL_WEAR;
  const lapText = phase === 'finished' ? 'FINISH' : `${Math.min(lap, LAPS)}/${LAPS}`;

  return (
    <header className={styles.hud}>
      <div className={styles.race}>
        <div className={styles.cell}>
          <span className={styles.k}>Lap</span>
          <span className={styles.lap}>{lapText}</span>
        </div>
        {!started && <span className={styles.badge}>On the grid</span>}
        {started && lap === LAPS && phase === 'racing' && <span className={styles.badge}>Final lap</span>}
        <span className={`${styles.badge} ${weather === 'wet' ? styles.rain : ''}`}>
          {weather === 'wet' ? 'Rain' : 'Dry'}
        </span>
        {scActive && <span className={`${styles.badge} ${styles.sc}`} role="status">Safety car</span>}
      </div>

      <dl className={styles.car} aria-label="Your car">
        <div className={styles.cell}>
          <dt className={styles.k}>Pos</dt>
          <dd className={styles.v}>P{me.position}</dd>
        </div>
        <div className={`${styles.cell} ${styles.tyre}`}>
          <dt className={styles.k}>Tyres</dt>
          <dd className={styles.v}>
            <TyreChip compound={me.compound} />
            <span className={critical ? styles.critical : undefined}>{Math.round(me.tyreWear)}%</span>
            <span className={styles.age}>{me.tyreAgeLaps}L</span>
          </dd>
          <dd className={styles.bar}><WearBar wear={me.tyreWear} label="Your tyre wear" /></dd>
        </div>
        <div className={styles.cell}>
          <dt className={styles.k}>Fuel</dt>
          <dd className={styles.v}>{me.fuel.toFixed(1)} kg</dd>
        </div>
        <div className={styles.cell}>
          <dt className={styles.k}>Plan</dt>
          <dd className={styles.v}>
            {me.plan} <TyreChip compound={PLAN_COMPOUND[me.plan]} />
          </dd>
        </div>
        <div className={styles.cell}>
          <dt className={styles.k}>Mode</dt>
          <dd className={styles.v}>{MODE_LABEL[me.mode]}</dd>
        </div>
        <div className={styles.flags}>
          {finished && <span className={styles.badge}>Finished</span>}
          {!finished && inPit && <span className={`${styles.badge} ${styles.pit}`}>In pit</span>}
          {!finished && !inPit && me.boxQueued && <span className={`${styles.badge} ${styles.box}`}>Box this lap</span>}
          {!finished && me.punctured && <span className={`${styles.badge} ${styles.danger}`}>Puncture</span>}
          {!finished && critical && !inPit && <span className={`${styles.badge} ${styles.danger}`}>Tyres critical</span>}
        </div>
      </dl>
    </header>
  );
}
