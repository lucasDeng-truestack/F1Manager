import { useGameStore } from '../state/store';
import type { CarState } from '../sim/types';
import { formatGap } from './format';
import { TyreChip } from './Tyre';
import styles from './TimingTower.module.css';

function flagFor(car: CarState): { text: string; cls: string | undefined } | null {
  if (car.finishTime !== null) return { text: 'FIN', cls: styles.fin };
  if (car.pitTimeRemaining > 0) return { text: 'PIT', cls: styles.pit };
  if (car.punctured) return { text: 'PUNC', cls: styles.danger };
  if (car.boxQueued) return { text: 'BOX', cls: styles.box };
  return null;
}

export function TimingTower() {
  const order = useGameStore((s) => s.race?.order);
  const cars = useGameStore((s) => s.race?.cars);
  const started = useGameStore((s) => (s.race ? s.race.tick > 0 : false));

  if (!order || !cars) return null;

  return (
    <section className={styles.tower} aria-labelledby="tower-title">
      <h2 id="tower-title" className={styles.title}>Timing</h2>
      <table className={styles.table}>
        <thead className="visually-hidden">
          <tr>
            <th scope="col">Position</th>
            <th scope="col">Driver</th>
            <th scope="col">Gap to leader</th>
            <th scope="col">Interval</th>
            <th scope="col">Tyre</th>
            <th scope="col">Wear</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {order.map((id, i) => {
            const car = cars[id];
            if (!car) return null;
            const flag = flagFor(car);
            const leader = i === 0;
            return (
              <tr key={id} className={car.isPlayer ? styles.player : undefined} aria-current={car.isPlayer ? 'true' : undefined}>
                <td className={styles.pos}>{i + 1}</td>
                <td className={styles.code}>{car.code}</td>
                <td className={styles.gap}>{leader ? (started ? 'Leader' : 'Pole') : formatGap(car.gapToLeader)}</td>
                <td className={`${styles.gap} ${styles.interval}`}>{leader ? '' : formatGap(car.gapToAhead)}</td>
                <td className={styles.tyre}><TyreChip compound={car.compound} /></td>
                <td className={styles.wear}>{Math.round(car.tyreWear)}%</td>
                <td className={styles.flagCell}>{flag && <span className={`${styles.flag} ${flag.cls ?? ''}`}>{flag.text}</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
