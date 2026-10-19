// "Is the player typing in a field?" — the one check shared by Space push-to-talk
// (recorder.ts) and the B/P/S/D keyboard fallback (src/state/keyboard.ts), so the two never
// disagree. Lives in src/voice because state may import voice, never the reverse.

const EDITABLE_TAGS: ReadonlySet<string> = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/** Text fields and contenteditable (duck-typed so it also works outside a browser). */
export function isEditableTarget(target: EventTarget | null | undefined): boolean {
  if (target === null || target === undefined || typeof target !== 'object') return false;
  const el = target as { isContentEditable?: unknown; tagName?: unknown };
  if (el.isContentEditable === true) return true;
  return typeof el.tagName === 'string' && EDITABLE_TAGS.has(el.tagName.toUpperCase());
}
