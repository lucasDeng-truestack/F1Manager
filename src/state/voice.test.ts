import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkerResponse } from '../voice/protocol';
import type { PushToTalkHandlers } from '../voice/recorder';
import { INITIAL_VOICE, initialGameState, useGameStore } from './store';
import { MODEL_NOT_READY_MESSAGE, NO_REPLY_MESSAGE, initVoice } from './voice';

const h = vi.hoisted(() => ({
  onMessage: null as ((m: WorkerResponse) => void) | null,
  ptt: null as PushToTalkHandlers | null,
  load: vi.fn(),
  transcribe: vi.fn(),
  dispose: vi.fn(),
  detach: vi.fn(),
  createClient: vi.fn(),
  nextId: 1,
}));

vi.mock('../voice/whisperClient', () => ({
  createWhisperClient: (onMessage: (m: WorkerResponse) => void) => {
    h.createClient();
    h.onMessage = onMessage;
    return { load: h.load, transcribe: h.transcribe, dispose: h.dispose };
  },
}));

vi.mock('../voice/recorder', () => ({
  MIN_CLIP_MS: 250,
  attachPushToTalk: (handlers: PushToTalkHandlers) => {
    h.ptt = handlers;
    return h.detach;
  },
}));

const store = () => useGameStore.getState();
const voice = () => store().voice;
const worker = (m: WorkerResponse) => h.onMessage?.(m);
const ptt = (): PushToTalkHandlers => {
  if (h.ptt === null) throw new Error('push-to-talk not attached');
  return h.ptt;
};

let now = 0;
/** Holds Space for `ms`: live → off air. */
function hold(ms: number): void {
  ptt().onLive(true);
  now += ms;
  ptt().onLive(false);
}
const clip = () => new Float32Array(16);

let cleanups: (() => void)[] = [];
function init(): () => void {
  const cleanup = initVoice();
  cleanups.push(cleanup);
  return cleanup;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  useGameStore.setState(initialGameState());
  h.onMessage = null;
  h.ptt = null;
  h.nextId = 1;
  for (const fn of [h.load, h.transcribe, h.dispose, h.detach, h.createClient]) fn.mockReset();
  h.transcribe.mockImplementation(() => h.nextId++);
});

afterEach(() => {
  for (const c of cleanups) c();
  cleanups = [];
  vi.runAllTimers(); // deferred teardown
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('model loading', () => {
  it('starts the download at once and reports progress, then ready', () => {
    init();
    expect(h.load).toHaveBeenCalledTimes(1);
    expect(voice().model).toBe('loading');
    worker({ type: 'progress', file: 'encoder.onnx', progress: 42 });
    expect(voice()).toMatchObject({ model: 'loading', progress: 42 });
    worker({ type: 'ready', model: 'onnx-community/whisper-tiny.en', device: 'wasm' });
    expect(voice()).toMatchObject({ model: 'ready', modelId: 'onnx-community/whisper-tiny.en', device: 'wasm', progress: 100, error: null });
  });

  it('shows a fatal load error and keeps everything else working', () => {
    init();
    worker({ type: 'error', message: 'Could not load a speech model.', fatal: true });
    expect(voice()).toMatchObject({ model: 'error', error: 'Could not load a speech model.', ptt: 'off' });
    store().startRace();
    store().issueCommand('BOX', 'keyboard');
    expect(store().inputs).toHaveLength(1);
  });
});

describe('push-to-talk', () => {
  beforeEach(() => {
    init();
    worker({ type: 'ready', model: 'onnx-community/whisper-base.en', device: 'webgpu' });
    store().startRace();
  });

  it('goes live, thinks, transcribes and routes the call as voice', () => {
    ptt().onMic('requesting');
    ptt().onMic('ready');
    expect(voice().mic).toBe('ready');
    ptt().onLive(true);
    expect(voice().ptt).toBe('live');
    now += 600;
    ptt().onLive(false);
    expect(voice().ptt).toBe('thinking');
    const audio = clip();
    ptt().onClip(audio);
    expect(h.transcribe).toHaveBeenCalledWith(audio);
    expect(voice().ptt).toBe('thinking');
    worker({ type: 'transcript', id: 1, text: 'box box', ms: 300 });
    expect(voice().ptt).toBe('off');
    expect(store().calls).toEqual([{ tick: 0, lap: 1, command: 'BOX', source: 'voice', transcript: 'box box' }]);
  });

  it('goes straight back to off for a tap the recorder drops', () => {
    hold(100);
    expect(voice().ptt).toBe('off');
  });

  it('stops thinking when a long press never yields a clip', () => {
    hold(400);
    expect(voice().ptt).toBe('thinking');
    vi.advanceTimersByTime(3000);
    expect(voice().ptt).toBe('off');
  });

  it('keeps thinking until the last of two clips in flight answers', () => {
    hold(400);
    ptt().onClip(clip());
    hold(400);
    ptt().onClip(clip());
    worker({ type: 'transcript', id: 1, text: 'push', ms: 1 });
    expect(voice().ptt).toBe('thinking');
    worker({ type: 'transcript', id: 2, text: 'defend', ms: 1 });
    expect(voice().ptt).toBe('off');
    expect(store().calls.map((c) => c.command)).toEqual(['PUSH', 'DEFEND']);
  });

  it('does not cut a live press when an older transcript lands', () => {
    hold(400);
    ptt().onClip(clip());
    ptt().onLive(true);
    worker({ type: 'transcript', id: 1, text: 'push', ms: 1 });
    expect(voice().ptt).toBe('live');
  });

  it('turns off with an error when a transcription fails', () => {
    hold(400);
    ptt().onClip(clip());
    worker({ type: 'error', id: 1, message: 'Transcription failed: oops', fatal: false });
    expect(voice()).toMatchObject({ ptt: 'off', error: 'Transcription failed: oops', model: 'ready' });
    // The next good transcript clears it.
    hold(400);
    ptt().onClip(clip());
    worker({ type: 'transcript', id: 2, text: 'copy', ms: 1 });
    expect(voice().error).toBeNull();
  });

  it('gives up on a transcription that never answers', () => {
    hold(400);
    ptt().onClip(clip());
    vi.advanceTimersByTime(30_000);
    expect(voice()).toMatchObject({ ptt: 'off', error: NO_REPLY_MESSAGE });
  });

  it('ignores a transcript that lands after its clip was given up on', () => {
    hold(400);
    ptt().onClip(clip()); // id 1: "box" on WASM, slow
    vi.advanceTimersByTime(30_000);
    expect(voice()).toMatchObject({ ptt: 'off', error: NO_REPLY_MESSAGE });
    store().issueCommand('BOX', 'keyboard'); // the player boxes by hand instead
    hold(400);
    ptt().onClip(clip()); // id 2 still in flight
    worker({ type: 'transcript', id: 1, text: 'box box', ms: 31_000 });
    // No second BOX (it would cancel the stop), the timeout message stays, still thinking for id 2.
    expect(store().calls.map((c) => c.command)).toEqual(['BOX']);
    expect(store().inputs).toHaveLength(1);
    expect(voice()).toMatchObject({ ptt: 'thinking', error: NO_REPLY_MESSAGE });
    worker({ type: 'transcript', id: 2, text: 'push', ms: 1 });
    expect(store().calls.map((c) => c.command)).toEqual(['BOX', 'PUSH']);
    expect(voice()).toMatchObject({ ptt: 'off', error: null });
  });

  it('ignores a late error for a clip already given up on', () => {
    hold(400);
    ptt().onClip(clip());
    vi.advanceTimersByTime(30_000);
    hold(400);
    ptt().onClip(clip()); // id 2 still in flight
    worker({ type: 'error', id: 1, message: 'Transcription failed: late', fatal: false });
    expect(voice()).toMatchObject({ ptt: 'thinking', error: NO_REPLY_MESSAGE });
  });

  it('ignores a transcript for a clip dropped by an id-less worker error', () => {
    hold(400);
    ptt().onClip(clip());
    worker({ type: 'error', message: 'Speech worker crashed.', fatal: false });
    expect(voice()).toMatchObject({ ptt: 'off', error: 'Speech worker crashed.' });
    worker({ type: 'transcript', id: 1, text: 'box', ms: 1 });
    expect(store().calls).toEqual([]);
    expect(voice().error).toBe('Speech worker crashed.');
  });

  it('records an empty transcript as nothing', () => {
    hold(400);
    ptt().onClip(clip());
    worker({ type: 'transcript', id: 1, text: '', ms: 1 });
    expect(voice().ptt).toBe('off');
    expect(store().calls).toEqual([]);
  });

  it('ignores a transcript that lands after backToStart', () => {
    hold(400);
    ptt().onClip(clip());
    store().backToStart();
    worker({ type: 'transcript', id: 1, text: 'box', ms: 1 });
    expect(voice().ptt).toBe('off');
    expect(store().calls).toEqual([]);
  });

  it('reports a denied mic without breaking the keyboard path', () => {
    ptt().onMic('unavailable');
    expect(voice().mic).toBe('unavailable');
    store().issueCommand('PUSH', 'keyboard');
    expect(store().calls).toHaveLength(1);
  });
});

describe('clips before the model is ready', () => {
  it('does not transcribe and says why', () => {
    init();
    hold(400);
    ptt().onClip(clip());
    expect(h.transcribe).not.toHaveBeenCalled();
    expect(voice()).toMatchObject({ ptt: 'off', error: MODEL_NOT_READY_MESSAGE });
  });

  it('keeps a fatal model error rather than overwriting it', () => {
    init();
    worker({ type: 'error', message: 'fatal load', fatal: true });
    hold(400);
    ptt().onClip(clip());
    expect(voice()).toMatchObject({ ptt: 'off', error: 'fatal load', model: 'error' });
  });
});

describe('lifecycle', () => {
  it('reuses one worker across StrictMode mount → cleanup → mount', () => {
    const first = initVoice();
    first();
    cleanups.push(initVoice());
    vi.runAllTimers();
    expect(h.createClient).toHaveBeenCalledTimes(1);
    expect(h.load).toHaveBeenCalledTimes(1);
    expect(h.dispose).not.toHaveBeenCalled();
    expect(h.detach).not.toHaveBeenCalled();
  });

  it('disposes the worker and detaches push-to-talk after the last cleanup', () => {
    const a = initVoice();
    const b = initVoice();
    a();
    a();
    vi.runAllTimers();
    expect(h.dispose).not.toHaveBeenCalled();
    b();
    vi.runAllTimers();
    expect(h.dispose).toHaveBeenCalledTimes(1);
    expect(h.detach).toHaveBeenCalledTimes(1);
    expect(voice()).toEqual(INITIAL_VOICE);
    // Late messages from the dead session are ignored.
    worker({ type: 'ready', model: 'onnx-community/whisper-base.en', device: 'wasm' });
    expect(voice().model).toBe('idle');
  });

  it('starts a fresh worker after a full teardown', () => {
    const a = initVoice();
    a();
    vi.runAllTimers();
    init();
    expect(h.createClient).toHaveBeenCalledTimes(2);
  });
});
