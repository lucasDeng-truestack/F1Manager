// Whisper speech-to-text, entirely in this worker. The only file in the app that imports
// @huggingface/transformers. Speaks exactly the protocol in ./protocol.ts.
import { env, pipeline } from '@huggingface/transformers';
import type { AutomaticSpeechRecognitionPipeline, DataType, ProgressInfo } from '@huggingface/transformers';
// The ONNX Runtime wasm runtime, shipped from our own origin. `onnxruntime-web` is pinned to the
// exact version transformers.js 4.3.1 depends on, so these are the same files it would load.
import ortAsyncifyMjs from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?url';
import ortAsyncifyWasm from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url';
import ortPlainMjs from 'onnxruntime-web/ort-wasm-simd-threaded.mjs?url';
import ortPlainWasm from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import type { Device, ModelId, WorkerRequest, WorkerResponse } from './protocol';
import { createProgressAggregator } from './whisperProgress';

// The project tsconfig loads both the DOM and WebWorker libs, so the global `self` is typed as
// Window. This module only ever runs as a dedicated worker; this is the one cast that says so.
const scope = self as unknown as DedicatedWorkerGlobalScope;

/**
 * No CDN: by default transformers.js points ONNX Runtime at cdn.jsdelivr.net for its wasm
 * runtime (.mjs factory + .wasm binary). The only network call this app may make is the model
 * download from the Hugging Face hub, so swap those URLs for our bundled copies before any
 * pipeline exists. Both devices use the same files: `onnxruntime-web/webgpu` runs its WebGPU EP
 * inside the asyncify build. Keep the library's own variant choice — it picks the plain
 * (non-asyncify) build on Safari < 26 without WebGPU, and asyncify everywhere else — by reading
 * the default it set when it was imported, and only change where the files come from.
 */
function serveOrtRuntimeLocally(): void {
  const wasm = env.backends.onnx.wasm;
  if (!wasm) return; // ORT wasm backend absent: nothing would fetch the runtime at all
  const chosen = wasm.wasmPaths;
  const chosenMjs = chosen && typeof chosen === 'object' ? String(chosen.mjs ?? '') : '';
  // Anything unrecognised falls back to asyncify, the build `onnxruntime-web/webgpu` embeds.
  const plain = chosenMjs.endsWith('/ort-wasm-simd-threaded.mjs');
  // Absolute URLs: ORT dynamic-imports the factory and transformers.js caches both files by URL.
  const abs = (url: string): string => new URL(url, import.meta.url).href;
  wasm.wasmPaths = plain
    ? { mjs: abs(ortPlainMjs), wasm: abs(ortPlainWasm) }
    : { mjs: abs(ortAsyncifyMjs), wasm: abs(ortAsyncifyWasm) };
}
serveOrtRuntimeLocally();

const BASE: ModelId = 'onnx-community/whisper-base.en';
const TINY: ModelId = 'onnx-community/whisper-tiny.en';

// WebGPU: full-precision encoder (quantised encoders hurt accuracy and are slow on WebGPU) with
// a 4-bit decoder; WASM: the library's own CPU default (q8). Per-file keys are the Whisper
// session file names in transformers.js 4.3.1 (encoder_model / decoder_model_merged); both
// files exist on the hub for base.en and tiny.en.
const DTYPE: Record<Device, DataType | Record<string, DataType>> = {
  webgpu: { encoder_model: 'fp32', decoder_model_merged: 'q4' },
  wasm: 'q8',
};

type Attempt = { model: ModelId; device: Device };
type Loaded = Attempt & { asr: AutomaticSpeechRecognitionPipeline };

let loaded: Loaded | null = null;
let loading: Promise<void> | null = null;
/** Serialises inference: ONNX sessions (WebGPU especially) must not run concurrently. */
let inference: Promise<void> = Promise.resolve();

const post = (m: WorkerResponse): void => scope.postMessage(m);

const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

async function detectDevice(): Promise<Device> {
  if (!('gpu' in navigator)) return 'wasm';
  try {
    const adapter = await navigator.gpu.requestAdapter();
    return adapter ? 'webgpu' : 'wasm';
  } catch {
    return 'wasm';
  }
}

/** Explicit model wins; otherwise base on WebGPU, tiny on WASM. Then tiny, then tiny on WASM. */
function attemptsFor(requested: ModelId | undefined, device: Device): Attempt[] {
  const first: Attempt = { model: requested ?? (device === 'webgpu' ? BASE : TINY), device };
  const chain: Attempt[] = [first, { model: TINY, device }, { model: TINY, device: 'wasm' }];
  return chain.filter((a, i) => chain.findIndex((b) => b.model === a.model && b.device === a.device) === i);
}

async function load(requested: ModelId | undefined): Promise<void> {
  const device = await detectDevice();
  const progress = createProgressAggregator();
  const failures: string[] = [];

  for (const attempt of attemptsFor(requested, device)) {
    progress.reset();
    try {
      const asr = await pipeline('automatic-speech-recognition', attempt.model, {
        device: attempt.device,
        dtype: DTYPE[attempt.device],
        progress_callback: (info: ProgressInfo) => {
          const update = progress.push(info, performance.now());
          if (update) post({ type: 'progress', file: update.file, progress: update.progress });
        },
      });
      loaded = { ...attempt, asr };
      post({ type: 'ready', model: attempt.model, device: attempt.device });
      return;
    } catch (e) {
      failures.push(`${attempt.model} (${attempt.device}): ${errorMessage(e)}`);
    }
  }
  post({ type: 'error', message: `Could not load a speech model. ${failures.join('; ')}`, fatal: true });
}

function handleLoad(model: ModelId | undefined): void {
  // Singleton: never start a second download. A load that arrives after a successful one gets
  // the same `ready` again (the requested model is ignored — first load wins).
  if (loaded) {
    post({ type: 'ready', model: loaded.model, device: loaded.device });
    return;
  }
  if (loading) return; // the in-flight load will post `ready` or a fatal `error`
  loading = load(model).finally(() => {
    // Keep the guard only while in flight; after a total failure a later `load` may retry.
    loading = null;
  });
}

async function transcribe(asr: AutomaticSpeechRecognitionPipeline, id: number, audio: Float32Array, startedAt: number): Promise<void> {
  try {
    const out = await asr(audio);
    post({ type: 'transcript', id, text: out.text.trim(), ms: Math.round(performance.now() - startedAt) });
  } catch (e) {
    post({ type: 'error', id, message: `Transcription failed: ${errorMessage(e)}`, fatal: false });
  }
}

function handleTranscribe(id: number, audio: Float32Array): void {
  const startedAt = performance.now();
  // Not ready → reject at once rather than queue: a clip queued behind a first-time download
  // would fire a stale command minutes later. The keyboard fallback covers this window.
  if (!loaded) {
    post({ type: 'error', id, message: 'Speech model not ready yet.', fatal: false });
    return;
  }
  const { asr } = loaded;
  inference = inference.then(() => transcribe(asr, id, audio, startedAt));
}

scope.addEventListener('message', (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  switch (req.type) {
    case 'load':
      handleLoad(req.model);
      return;
    case 'transcribe':
      handleTranscribe(req.id, req.audio);
      return;
    default: {
      const unreachable: never = req;
      void unreachable;
    }
  }
});
