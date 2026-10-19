export type ModelId = 'onnx-community/whisper-base.en' | 'onnx-community/whisper-tiny.en';
export type Device = 'webgpu' | 'wasm';
export type MicStatus = 'idle' | 'requesting' | 'ready' | 'unavailable';

export type WorkerRequest =
  | { type: 'load'; model?: ModelId }
  | { type: 'transcribe'; id: number; audio: Float32Array }; // 16 kHz mono, buffer transferred

export type WorkerResponse =
  | { type: 'progress'; file: string; progress: number }      // overall 0..100
  | { type: 'ready'; model: ModelId; device: Device }
  | { type: 'transcript'; id: number; text: string; ms: number }
  | { type: 'error'; id?: number; message: string; fatal: boolean };
