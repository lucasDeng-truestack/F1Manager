import styles from './StartLights.module.css';

/** Five red start lights. `out` switches them off left to right (staggered in CSS). */
export function StartLights({ out = false }: { out?: boolean }) {
  return (
    <div className={`${styles.gantry} ${out ? styles.out : ''}`} aria-hidden="true">
      {[0, 1, 2, 3, 4].map((i) => (
        <span key={i} className={styles.pod}>
          <span className={styles.light} />
          <span className={styles.light} />
        </span>
      ))}
    </div>
  );
}
