import { useGameStore } from '../state/store';
import styles from './ModelStatus.module.css';

const MODEL_NAME: Record<string, string> = {
  'onnx-community/whisper-base.en': 'Whisper base',
  'onnx-community/whisper-tiny.en': 'Whisper tiny',
};

/** Voice readiness: model download, model error and mic access. Never blocks the keys. */
export function ModelStatus() {
  const model = useGameStore((s) => s.voice.model);
  const progress = useGameStore((s) => s.voice.progress);
  const modelId = useGameStore((s) => s.voice.modelId);
  const device = useGameStore((s) => s.voice.device);
  const error = useGameStore((s) => s.voice.error);
  const mic = useGameStore((s) => s.voice.mic);
  const pct = Math.round(Math.max(0, Math.min(100, progress)));

  return (
    <section className={styles.panel} aria-labelledby="voice-status-title">
      <h2 id="voice-status-title" className={styles.title}>Team radio</h2>

      <div className={styles.row} role="status">
        {model === 'idle' && <span className={styles.muted}>Voice model waiting to load…</span>}
        {model === 'loading' && (
          <div className={styles.loading}>
            <span>Downloading voice model · {pct}%</span>
            <progress className={styles.progress} max={100} value={pct} aria-label="Voice model download">{pct}%</progress>
            <span className={styles.muted}>You can race on the keys while it loads.</span>
          </div>
        )}
        {model === 'ready' && (
          <span>
            <span className={styles.okDot} aria-hidden="true" />
            Radio ready · {modelId ? MODEL_NAME[modelId] ?? modelId : 'Whisper'}
            {device && <span className={styles.muted}> on {device === 'webgpu' ? 'WebGPU' : 'WASM'}</span>}
          </span>
        )}
        {model === 'error' && (
          <span className={styles.error}>
            Voice is off{error ? `: ${error}` : ''}. Use the keys to make your calls.
          </span>
        )}
      </div>

      <div className={styles.row}>
        {mic === 'unavailable' && <span className={styles.error}>Mic blocked — use the keys.</span>}
        {mic === 'requesting' && <span className={styles.muted}>Waiting for mic permission…</span>}
        {mic === 'ready' && <span className={styles.muted}>Mic connected.</span>}
        {mic === 'idle' && <span className={styles.muted}>Mic is requested the first time you hold Space.</span>}
      </div>
    </section>
  );
}
