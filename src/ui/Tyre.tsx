import { TYRE_CRITICAL_WEAR } from '../sim/constants';
import type { Compound } from '../sim/types';
import { COMPOUND_NAME } from './format';
import styles from './Tyre.module.css';

const COMPOUND_CLASS: Record<Compound, string | undefined> = {
  S: styles.soft, M: styles.medium, H: styles.hard, I: styles.inter,
};

export function TyreChip({ compound }: { compound: Compound }) {
  return (
    <span className={`${styles.chip} ${COMPOUND_CLASS[compound] ?? ''}`} title={COMPOUND_NAME[compound]}>
      <span aria-hidden="true">{compound}</span>
      <span className="visually-hidden">{COMPOUND_NAME[compound]} tyres</span>
    </span>
  );
}

/** Wear 0..100 as a bar; warns from half way, critical at TYRE_CRITICAL_WEAR. */
export function WearBar({ wear, label }: { wear: number; label?: string }) {
  const pct = Math.max(0, Math.min(100, wear));
  const level = pct >= TYRE_CRITICAL_WEAR ? styles.critical : pct >= 50 ? styles.warn : styles.ok;
  return (
    <span
      className={styles.bar}
      role="meter"
      aria-label={label ?? 'Tyre wear'}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
    >
      <span className={`${styles.fill} ${level}`} style={{ inlineSize: `${pct}%` }} />
    </span>
  );
}
