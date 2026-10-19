// Push-to-talk capture: hold Space → MediaRecorder → decode → 16 kHz mono Float32Array.
// Talks to the rest of the app only through the handlers it is given (no store imports).
import { isEditableTarget } from './editable';
import type { MicStatus } from './protocol';

/** Clips held for less than this are accidental taps and are dropped (onClip not called). */
export const MIN_CLIP_MS = 250;
/** Whisper's expected input rate. */
export const TARGET_SAMPLE_RATE = 16_000;

export interface PushToTalkHandlers {
  onMic(s: MicStatus): void;
  onLive(live: boolean): void;
  onClip(audio: Float32Array): void;
}

const MIC_CONSTRAINTS: MediaStreamConstraints = {
  audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
};

const isSpace = (e: KeyboardEvent): boolean => e.code === 'Space' || e.key === ' ';
/** Ctrl/Alt/Meta+Space (IME and OS shortcuts) and IME composition are not push-to-talk. */
const isPttKey = (e: KeyboardEvent): boolean => isSpace(e) && !e.ctrlKey && !e.altKey && !e.metaKey && !e.isComposing;

function captureSupported(): boolean {
  return (
    typeof navigator.mediaDevices?.getUserMedia === 'function' &&
    typeof MediaRecorder !== 'undefined' &&
    typeof AudioContext !== 'undefined' &&
    typeof OfflineAudioContext !== 'undefined'
  );
}

/** Downmix to mono and resample to 16 kHz by rendering through a 1-channel OfflineAudioContext. */
async function toMono16k(decoded: AudioBuffer): Promise<Float32Array> {
  const length = Math.max(1, Math.ceil(decoded.duration * TARGET_SAMPLE_RATE));
  const offline = new OfflineAudioContext(1, length, TARGET_SAMPLE_RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded; // 1-channel destination applies the standard speaker downmix
  source.connect(offline.destination);
  source.start(0);
  const rendered = await offline.startRendering();
  // Copy once into a buffer we own outright, so the client can transfer it to the worker.
  const out = new Float32Array(rendered.length);
  rendered.copyFromChannel(out, 0);
  return out;
}

/** One press of Space: its recorder plus a hook that stamps the key-up time. */
interface Session {
  rec: MediaRecorder;
  release(): void;
}

export function attachPushToTalk(h: PushToTalkHandlers): () => void {
  let status: MicStatus = 'idle';
  let stream: MediaStream | null = null;
  let micRequest: Promise<void> | null = null;
  let session: Session | null = null;
  let decodeCtx: AudioContext | null = null;
  let keyHeld = false;
  let live = false;
  let detached = false;

  const setMic = (s: MicStatus): void => {
    if (detached || s === status) return;
    status = s;
    h.onMic(s);
  };

  const setLive = (next: boolean): void => {
    if (detached || next === live) return;
    live = next;
    h.onLive(next);
  };

  const onTrackEnded = (): void => {
    // Device unplugged or permission revoked mid-session: drop the stream and ask again next press.
    stopRecording();
    releaseStream();
    setMic('idle');
  };

  function releaseStream(): void {
    if (!stream) return;
    for (const track of stream.getTracks()) {
      track.removeEventListener('ended', onTrackEnded);
      track.stop();
    }
    stream = null;
  }

  async function processClip(chunks: Blob[], mimeType: string, heldMs: number): Promise<void> {
    if (detached || heldMs < MIN_CLIP_MS || chunks.length === 0) return;
    try {
      const blob = new Blob(chunks, mimeType ? { type: mimeType } : undefined);
      decodeCtx ??= new AudioContext();
      const decoded = await decodeCtx.decodeAudioData(await blob.arrayBuffer());
      if (decoded.length === 0) return;
      const audio = await toMono16k(decoded);
      if (!detached && audio.length > 0) h.onClip(audio);
    } catch {
      // Undecodable clip (or the context was closed by detach): drop it. The contract has no
      // error channel for the recorder; the player simply gets no transcript and can retry.
    }
  }

  function startRecording(): void {
    if (detached || !stream || session) return;
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(stream);
    } catch {
      releaseStream();
      setMic('unavailable');
      return;
    }
    const chunks: Blob[] = [];
    let startedAt: number | null = null;
    let releasedAt: number | null = null;
    const current: Session = {
      rec,
      release: () => {
        releasedAt = performance.now();
      },
    };
    rec.addEventListener('dataavailable', (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    });
    rec.addEventListener('start', () => {
      startedAt = performance.now();
      // If Space was already released, the session is gone and stop() is queued: stay off air.
      if (session === current) setLive(true);
    });
    rec.addEventListener('stop', () => {
      if (session === current) session = null; // stopped by the browser, not by key-up
      setLive(false);
      // Held time is measured from the real recording start to key-up; a release before the
      // start event gives a negative value, i.e. a tap.
      const heldMs = startedAt === null ? 0 : (releasedAt ?? performance.now()) - startedAt;
      void processClip(chunks, rec.mimeType, heldMs);
    });
    rec.addEventListener('error', () => {
      if (session === current) session = null;
      setLive(false);
    });
    session = current;
    try {
      rec.start();
    } catch {
      session = null;
      setLive(false);
    }
  }

  function stopRecording(): void {
    const current = session;
    if (!current) return;
    session = null;
    current.release();
    if (current.rec.state !== 'inactive') current.rec.stop();
    setLive(false);
  }

  async function requestMic(): Promise<void> {
    if (!captureSupported()) {
      setMic('unavailable');
      return;
    }
    setMic('requesting');
    try {
      const s = await navigator.mediaDevices.getUserMedia(MIC_CONSTRAINTS);
      if (detached) {
        for (const track of s.getTracks()) track.stop();
        return;
      }
      stream = s;
      for (const track of s.getAudioTracks()) track.addEventListener('ended', onTrackEnded);
      setMic('ready');
      // Only record if Space is still down — releasing during the prompt means "never mind".
      if (keyHeld) startRecording();
    } catch {
      // Denied, no device, insecure context, …: stay unavailable for the session (no re-prompt).
      setMic('unavailable');
    }
  }

  const onKeyDown = (e: KeyboardEvent): void => {
    if (!isPttKey(e) || isEditableTarget(e.target)) return;
    e.preventDefault(); // no page scroll, no activation of a focused button
    if (e.repeat || keyHeld) return;
    keyHeld = true;
    if (status === 'unavailable') return;
    if (stream) {
      startRecording();
      return;
    }
    micRequest ??= requestMic().finally(() => {
      micRequest = null;
    });
  };

  const onKeyUp = (e: KeyboardEvent): void => {
    if (!isSpace(e)) return;
    if (!isEditableTarget(e.target)) e.preventDefault();
    keyHeld = false;
    stopRecording();
  };

  const onBlur = (): void => {
    // Key-up is lost when the window loses focus while Space is held.
    keyHeld = false;
    stopRecording();
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  return () => {
    if (detached) return;
    keyHeld = false;
    stopRecording(); // emits onLive(false) if we were live
    detached = true;
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
    releaseStream();
    if (decodeCtx) {
      void decodeCtx.close().catch(() => undefined);
      decodeCtx = null;
    }
  };
}
