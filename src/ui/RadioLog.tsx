import { useEffect, useRef } from 'react';
import { useGameStore } from '../state/store';
import styles from './RadioLog.module.css';

export function RadioLog() {
  const radio = useGameStore((s) => s.radio);
  const listRef = useRef<HTMLOListElement>(null);
  const stickRef = useRef(true);

  // Follow the newest line unless the user has scrolled up to read history.
  useEffect(() => {
    const el = listRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [radio.length]);

  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < el.clientHeight / 4;
  };

  return (
    <section className={styles.panel} aria-labelledby="radio-title">
      <h2 id="radio-title" className={styles.title}>Radio</h2>
      <ol ref={listRef} className={styles.log} aria-live="polite" aria-relevant="additions" onScroll={onScroll} tabIndex={0}>
        {radio.length === 0 && <li className={styles.empty}>Channel open. Make a call.</li>}
        {radio.map((line) => (
          <li key={line.id} className={`${styles.line} ${line.speaker === 'engineer' ? styles.engineer : styles.driver}`}>
            <span className={styles.meta}>
              L{line.lap} {line.speaker === 'engineer' ? 'ENG' : 'DRV'}
            </span>
            <span className={styles.text}>{line.text}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
