// Voice wiring: Whisper worker + push-to-talk → transcript → store.handleTranscript.
// The store only sees VoiceState patches and transcripts; no audio or worker code leaks in.
import type { WorkerResponse } from '../voice/protocol';
import { MIN_CLIP_MS, attachPushToTalk } from '../voice/recorder';
import { createWhisperClient, type WhisperClient } from '../voice/whisperClient';
import { INITIAL_VOICE, useGameStore } from './store';
import type { PttStatus, VoiceState } from './types';

/**
 * After a long-enough press, how long to wait for the recorder's clip. The recorder drops
 * undecodable clips without telling anyone; this keeps 'thinking' from sticking.
 */
const CLIP_WAIT_MS = 3000;
/** A transcription with no answer after this long is given up on (worker hung or crashed). */
const TRANSCRIBE_TIMEOUT_MS = 30_000;

export const MODEL_NOT_READY_MESSAGE = 'Speech model is still loading. Use the keys for now.';
export const NO_REPLY_MESSAGE = 'No transcript came back. Try again or use the keys.';

type Timer = ReturnType<typeof setTimeout>;

function voice(): VoiceState {
  return useGameStore.getState().voice;
}

function setVoice(patch: Partial<VoiceState>): void {
  useGameStore.getState().setVoice(patch);
}

/** One worker + one push-to-talk listener. Everything is ignored after `dispose`. */
function startVoice(): () => void {
  let disposed = false;
  let liveSince: number | null = null;
  let clipTimer: Timer | null = null;
  const pending = new Map<number, Timer>(); // transcription id → give-up timer

  const clearClipTimer = (): void => {
    if (clipTimer !== null) clearTimeout(clipTimer);
    clipTimer = null;
  };

  /** Off air: 'thinking' while a clip or a transcript is still on its way, else 'off'. */
  const offAirPtt = (): PttStatus => (clipTimer !== null || pending.size > 0 ? 'thinking' : 'off');

  /** Re-derives the indicator after something finished; never interrupts a live press. */
  const settlePtt = (): void => {
    const ptt = offAirPtt();
    if (voice().ptt !== 'live' && voice().ptt !== ptt) setVoice({ ptt });
  };

  const forget = (id: number): void => {
    const timer = pending.get(id);
    if (timer !== undefined) clearTimeout(timer);
    pending.delete(id);
  };

  const forgetAll = (): void => {
    for (const id of [...pending.keys()]) forget(id);
  };

  const onMessage = (m: WorkerResponse): void => {
    if (disposed) return;
    switch (m.type) {
      case 'progress':
        if (voice().model !== 'ready') setVoice({ model: 'loading', progress: Math.min(100, Math.max(0, m.progress)) });
        break;
      case 'ready':
        setVoice({ model: 'ready', modelId: m.model, device: m.device, progress: 100, error: null });
        break;
      case 'transcript':
        // Only answer a clip still in flight: one already given up on (TRANSCRIBE_TIMEOUT_MS,
        // worker error) must not fire a stale call laps later — a late BOX would toggle.
        if (!pending.has(m.id)) break;
        forget(m.id);
        if (voice().error !== null && voice().model === 'ready') setVoice({ error: null });
        useGameStore.getState().handleTranscript(m.text); // 'thinking' → 'off', then routes the call
        settlePtt(); // back to 'thinking' if another clip is still in flight
        break;
      case 'error':
        if (m.fatal) {
          clearClipTimer();
          forgetAll();
          setVoice({ model: 'error', error: m.message });
        } else {
          // An error with an id answers that clip; one without (worker crash after ready)
          // may have eaten any clip in flight, so stop waiting for all of them. A late error
          // for a clip already given up on is ignored, like a late transcript.
          if (m.id !== undefined) {
            if (!pending.has(m.id)) break;
            forget(m.id);
          } else {
            forgetAll();
          }
          setVoice({ error: m.message });
        }
        settlePtt();
        break;
    }
  };

  let client: WhisperClient | null = null;
  try {
    client = createWhisperClient(onMessage);
    setVoice({ model: 'loading', progress: 0, error: null });
    client.load();
  } catch (e) {
    setVoice({ model: 'error', error: `Speech worker could not start: ${e instanceof Error ? e.message : String(e)}` });
  }

  const detachPtt = attachPushToTalk({
    onMic(mic) {
      if (!disposed) setVoice({ mic });
    },
    onLive(live) {
      if (disposed) return;
      if (live) {
        liveSince = performance.now();
        setVoice({ ptt: 'live' });
        return;
      }
      // The recorder drops presses shorter than MIN_CLIP_MS: no clip will follow those.
      const heldMs = liveSince === null ? 0 : performance.now() - liveSince;
      liveSince = null;
      clearClipTimer();
      if (heldMs >= MIN_CLIP_MS) {
        clipTimer = setTimeout(() => {
          clipTimer = null;
          settlePtt();
        }, CLIP_WAIT_MS);
      }
      setVoice({ ptt: offAirPtt() });
    },
    onClip(audio) {
      if (disposed) return;
      clearClipTimer();
      if (client === null || voice().model !== 'ready') {
        // Keep a fatal model error visible; otherwise say why nothing happened.
        if (voice().model !== 'error') setVoice({ error: MODEL_NOT_READY_MESSAGE });
        settlePtt();
        return;
      }
      const id = client.transcribe(audio);
      pending.set(id, setTimeout(() => {
        pending.delete(id);
        setVoice({ error: NO_REPLY_MESSAGE });
        settlePtt();
      }, TRANSCRIBE_TIMEOUT_MS));
      settlePtt();
    },
  });

  return () => {
    disposed = true;
    clearClipTimer();
    forgetAll();
    detachPtt();
    client?.dispose();
    setVoice({ ...INITIAL_VOICE });
  };
}

let users = 0;
let stopActive: (() => void) | null = null;
let teardown: Timer | null = null;

/**
 * Creates the Whisper worker (model download starts now) and attaches push-to-talk.
 * Reference counted with a deferred teardown: StrictMode's mount → cleanup → mount reuses
 * the same worker instead of killing a half-finished model download. Each returned cleanup
 * counts once; the last one disposes the worker and detaches PTT on the next macrotask.
 */
export function initVoice(): () => void {
  users += 1;
  if (teardown !== null) {
    clearTimeout(teardown);
    teardown = null;
  }
  stopActive ??= startVoice();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    users -= 1;
    if (users > 0 || teardown !== null) return;
    teardown = setTimeout(() => {
      teardown = null;
      if (users > 0 || stopActive === null) return;
      const stop = stopActive;
      stopActive = null;
      stop();
    }, 0);
  };
}
