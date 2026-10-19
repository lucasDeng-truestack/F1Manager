import { useEffect, useState } from 'react';
import { useGameStore } from '../state/store';
import type { PttStatus } from '../state/types';
import styles from './PttIndicator.module.css';

/** How long a voice error stays under the lamp before it fades out of the way. */
const NOTICE_MS = 6000;

interface Notice { text: string }

/**
 * Shows voice.error under the lamp for a few seconds. The store keeps an error until the model
 * is ready or a transcript lands, so the notice is driven by transitions instead: it appears when
 * the error changes while off-air, or when a call ends (ptt back to 'off') with an error set — that
 * covers the same message twice in a row. A new Space press hides it; a cleared error hides it.
 */
function useVoiceNotice(error: string | null, ptt: PttStatus): Notice | null {
  const [seen, setSeen] = useState({ error, ptt });
  const [notice, setNotice] = useState<Notice | null>(error !== null && ptt !== 'live' ? { text: error } : null);

  // Adjust state while rendering (React's pattern for reacting to prop changes, no effect).
  if (seen.error !== error || seen.ptt !== ptt) {
    setSeen({ error, ptt });
    if (error === null || ptt === 'live') {
      setNotice(null);
    } else if (seen.error !== error || (ptt === 'off' && seen.ptt !== 'off')) {
      setNotice({ text: error });
    }
  }

  useEffect(() => {
    if (notice === null) return;
    const timer = setTimeout(() => setNotice((n) => (n === notice ? null : n)), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  return notice;
}

/** On-air lamp: off / LIVE while Space is held / thinking while Whisper runs, plus voice errors. */
export function PttIndicator() {
  const ptt = useGameStore((s) => s.voice.ptt);
  const mic = useGameStore((s) => s.voice.mic);
  const model = useGameStore((s) => s.voice.model);
  const error = useGameStore((s) => s.voice.error);
  const notice = useVoiceNotice(error, ptt);

  const unavailable = mic === 'unavailable' || model === 'error';
  const notReady = model !== 'ready';

  let label: string;
  let hint: string;
  if (unavailable) {
    label = 'NO RADIO';
    hint = mic === 'unavailable' ? 'Mic blocked — use the keys' : 'Voice off — use the keys';
  } else if (ptt === 'live') {
    label = 'LIVE';
    hint = 'Release Space to send';
  } else if (ptt === 'thinking') {
    label = 'COPY…';
    hint = 'Decoding your call';
  } else if (notReady) {
    label = 'RADIO';
    hint = model === 'loading' ? 'Voice model loading — keys work now' : 'Voice not ready — keys work now';
  } else {
    label = 'RADIO';
    hint = 'Hold Space to talk';
  }

  const state = unavailable || notReady ? styles.disabled : ptt === 'live' ? styles.live : ptt === 'thinking' ? styles.thinking : styles.off;

  return (
    <div className={styles.root} role="status" aria-live="polite">
      <div className={`${styles.wrap} ${state}`}>
        <span className={styles.lamp} aria-hidden="true" />
        <span className={styles.text}>
          <span className={styles.label}>{label}</span>
          <span className={styles.hint}>{hint}</span>
        </span>
      </div>
      {notice !== null && (
        <p className={styles.notice}>
          <span className={styles.noticeLabel}>NO COPY</span> {notice.text}
        </p>
      )}
    </div>
  );
}
