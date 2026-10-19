// Main-thread handle on the Whisper worker. No transformers.js here — only messages.
import type { ModelId, WorkerRequest, WorkerResponse } from './protocol';

export interface WhisperClient {
  load(model?: ModelId): void;
  /** Sends a 16 kHz mono clip; its buffer is transferred (unusable afterwards). Returns the clip id. */
  transcribe(audio: Float32Array): number;
  dispose(): void;
}

/** True when the view spans its whole, non-shared ArrayBuffer, so that buffer can be transferred. */
function ownsWholeBuffer(a: Float32Array): a is Float32Array<ArrayBuffer> {
  return a.buffer instanceof ArrayBuffer && a.byteOffset === 0 && a.byteLength === a.buffer.byteLength;
}

export function createWhisperClient(onMessage: (m: WorkerResponse) => void): WhisperClient {
  const worker = new Worker(new URL('./whisper.worker.ts', import.meta.url), { type: 'module' });
  let nextId = 1;
  let disposed = false;
  let ready = false;

  const handleMessage = (e: MessageEvent<WorkerResponse>): void => {
    if (disposed) return;
    if (e.data.type === 'ready') ready = true;
    onMessage(e.data);
  };
  // An uncaught exception in the worker. Before `ready` it means the script or the library failed
  // to start, so nothing will ever answer (fatal); after `ready` the worker is still alive.
  const handleError = (e: ErrorEvent): void => {
    if (!disposed) onMessage({ type: 'error', message: `Speech worker error: ${e.message || 'unknown error'}`, fatal: !ready });
  };
  const handleMessageError = (): void => {
    if (!disposed) onMessage({ type: 'error', message: 'Speech worker sent an unreadable message.', fatal: false });
  };

  worker.addEventListener('message', handleMessage);
  worker.addEventListener('error', handleError);
  worker.addEventListener('messageerror', handleMessageError);

  const send = (req: WorkerRequest, transfer: Transferable[] = []): void => {
    if (!disposed) worker.postMessage(req, transfer);
  };

  return {
    load(model) {
      send(model === undefined ? { type: 'load' } : { type: 'load', model });
    },
    transcribe(audio) {
      const id = nextId++;
      // Transfer, don't copy. Only a view that owns a whole, transferable ArrayBuffer can be
      // handed over as-is; anything else (a sub-view, a SharedArrayBuffer) is sliced once first
      // so we never detach memory the caller still uses for something else.
      const owned = ownsWholeBuffer(audio) ? audio : audio.slice();
      send({ type: 'transcribe', id, audio: owned }, [owned.buffer]);
      return id;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      worker.removeEventListener('message', handleMessage);
      worker.removeEventListener('error', handleError);
      worker.removeEventListener('messageerror', handleMessageError);
      worker.terminate();
    },
  };
}
