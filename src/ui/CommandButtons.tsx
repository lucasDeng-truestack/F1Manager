import { useGameStore } from '../state/store';
import { KEY_BINDINGS } from '../state/keyboard';
import { COMMAND_LABEL } from './format';
import styles from './CommandButtons.module.css';

/**
 * Tap/click targets for every command (phones have no keyboard). Same path as the keys:
 * issueCommand(cmd, 'keyboard').
 */
export function CommandButtons() {
  const issueCommand = useGameStore((s) => s.issueCommand);
  const racing = useGameStore((s) => s.race?.phase === 'racing');

  return (
    <div className={styles.grid} role="group" aria-label="Radio calls">
      {KEY_BINDINGS.map((b) => (
        <button
          key={b.key}
          type="button"
          className={`${styles.button} ${b.command === 'BOX' ? styles.box : ''}`}
          disabled={!racing}
          onClick={() => issueCommand(b.command, 'keyboard')}
          aria-keyshortcuts={b.key.toUpperCase()}
        >
          <span className={styles.label}>{COMMAND_LABEL[b.command]}</span>
          <kbd className={styles.key}>{b.key.toUpperCase()}</kbd>
        </button>
      ))}
    </div>
  );
}
