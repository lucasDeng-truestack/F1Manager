import { KEY_BINDINGS } from '../state/keyboard';
import { COMMAND_LABEL } from './format';
import styles from './KeyHints.module.css';

/** The keyboard fallback, rendered from the same table the key handler uses. */
export function KeyHints({ showTalk = true }: { showTalk?: boolean }) {
  return (
    <ul className={styles.list} aria-label="Keyboard controls">
      {showTalk && (
        <li className={styles.item}>
          <kbd className={`${styles.key} ${styles.wide}`}>Space</kbd>
          <span>Hold to talk</span>
        </li>
      )}
      {KEY_BINDINGS.map((b) => (
        <li key={b.key} className={styles.item}>
          <kbd className={styles.key}>{b.key.toUpperCase()}</kbd>
          <span>{COMMAND_LABEL[b.command]}</span>
        </li>
      ))}
    </ul>
  );
}
