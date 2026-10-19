// Pure aggregation of the model-download progress events into one overall 0..100 number.
// Kept free of any transformers.js import (Whisper code lives only in whisper.worker.ts) by
// typing the events structurally; the library's ProgressInfo union is assignable to this.

export interface LoadProgressEvent {
  status: string;
  file?: string;
  loaded?: number;
  total?: number;
  files?: Record<string, { loaded: number; total: number }>;
}

export interface ProgressUpdate {
  file: string;
  progress: number; // integer 0..100, never decreases within one load attempt
}

export interface ProgressAggregator {
  /** Feed one event; returns an update to post, or null when nothing should be posted. */
  push(event: LoadProgressEvent, now: number): ProgressUpdate | null;
  /** Forget every file (used when the worker falls back to another model). */
  reset(): void;
}

/** Minimum gap between two posted progress messages, except the final 100. */
export const PROGRESS_THROTTLE_MS = 100;

const isByteCount = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0;

export function createProgressAggregator(throttleMs: number = PROGRESS_THROTTLE_MS): ProgressAggregator {
  const files = new Map<string, { loaded: number; total: number }>();
  let best = 0;
  let lastFile = '';
  let lastPosted = -1;
  let lastPostedAt = Number.NEGATIVE_INFINITY;

  const record = (file: string, loaded: number, total: number): void => {
    files.set(file, { loaded: Math.min(loaded, total), total });
  };

  /** Overall percentage, or null while no file has reported a byte size yet. */
  const overall = (): number | null => {
    let loaded = 0;
    let total = 0;
    for (const f of files.values()) {
      loaded += f.loaded;
      total += f.total;
    }
    if (total <= 0) return null;
    best = Math.max(best, Math.min(100, (loaded / total) * 100));
    return Math.floor(best);
  };

  const maybePost = (now: number): ProgressUpdate | null => {
    const progress = overall();
    if (progress === null || progress === lastPosted) return null;
    if (progress < 100 && now - lastPostedAt < throttleMs) return null;
    lastPosted = progress;
    lastPostedAt = now;
    return { file: lastFile, progress };
  };

  return {
    push(event, now) {
      switch (event.status) {
        case 'progress_total': {
          // Library-side aggregate: knows every expected file's size up front, so merge it in
          // to stop the bar jumping to 100 when the first small file (config.json) finishes.
          // The matching per-file 'progress' event follows, so post nothing here.
          if (event.files) {
            for (const [file, f] of Object.entries(event.files)) {
              if (isByteCount(f.loaded) && isByteCount(f.total)) record(file, f.loaded, f.total);
            }
          }
          return null;
        }
        case 'progress': {
          if (event.file === undefined || !isByteCount(event.loaded) || !isByteCount(event.total)) return null;
          lastFile = event.file;
          record(event.file, event.loaded, event.total);
          return maybePost(now);
        }
        case 'done': {
          if (event.file === undefined) return null;
          const f = files.get(event.file);
          if (f === undefined) return null; // size never reported (e.g. served from cache)
          lastFile = event.file;
          record(event.file, f.total, f.total);
          return maybePost(now);
        }
        default:
          return null;
      }
    },
    reset() {
      files.clear();
      best = 0;
      lastFile = '';
      lastPosted = -1;
      lastPostedAt = Number.NEGATIVE_INFINITY;
    },
  };
}
