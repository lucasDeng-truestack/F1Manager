import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Command } from '../sim/types';
import { KEY_BINDINGS, attachKeyboard, commandForKey, isEditableTarget, type KeyLike } from './keyboard';
import { initialGameState, useGameStore } from './store';

const store = () => useGameStore.getState();

describe('commandForKey', () => {
  const cases: [string, KeyLike, Command | null][] = [
    ['b', { key: 'b' }, 'BOX'],
    ['B (shift / caps)', { key: 'B' }, 'BOX'],
    ['p', { key: 'p' }, 'PUSH'],
    ['s', { key: 's' }, 'SAVE_TYRES'],
    ['d', { key: 'd' }, 'DEFEND'],
    ['a', { key: 'a' }, 'PLAN_B'],
    ['c', { key: 'c' }, 'COPY'],
    ['unbound letter', { key: 'x' }, null],
    ['Space (push-to-talk)', { key: ' ', code: 'Space' }, null],
    ['key repeat', { key: 'b', repeat: true }, null],
    ['ctrl+c', { key: 'c', ctrlKey: true }, null],
    ['cmd+s', { key: 's', metaKey: true }, null],
    ['alt+d', { key: 'd', altKey: true }, null],
    ['IME composition', { key: 'b', isComposing: true }, null],
    ['typing in an input', { key: 'b', target: { tagName: 'INPUT' } as unknown as EventTarget }, null],
    ['typing in a textarea', { key: 'p', target: { tagName: 'textarea' } as unknown as EventTarget }, null],
    ['contenteditable', { key: 'd', target: { tagName: 'DIV', isContentEditable: true } as unknown as EventTarget }, null],
    ['focused button', { key: 'b', target: { tagName: 'BUTTON', isContentEditable: false } as unknown as EventTarget }, 'BOX'],
    ['non-Latin layout falls back to the physical key', { key: 'и', code: 'KeyB' }, 'BOX'],
    ['AZERTY: the typed letter wins over the physical key', { key: 'a', code: 'KeyQ' }, 'PLAN_B'],
    ['Enter', { key: 'Enter', code: 'Enter' }, null],
  ];
  it.each(cases)('%s', (_name, e, expected) => {
    expect(commandForKey(e)).toBe(expected);
  });

  it('binds each command exactly once, to a distinct key', () => {
    expect(new Set(KEY_BINDINGS.map((b) => b.command)).size).toBe(6);
    expect(new Set(KEY_BINDINGS.map((b) => b.key)).size).toBe(KEY_BINDINGS.length);
  });

  it('treats non-elements as not editable', () => {
    expect(isEditableTarget(null)).toBe(false);
    expect(isEditableTarget(undefined)).toBe(false);
    expect(isEditableTarget(new EventTarget())).toBe(false);
  });
});

describe('attachKeyboard', () => {
  let target: EventTarget;
  const press = (key: string, extra: Partial<KeyLike> = {}): Event => {
    const e = Object.assign(new Event('keydown', { cancelable: true }), { key, code: `Key${key.toUpperCase()}`, ...extra });
    target.dispatchEvent(e);
    return e;
  };
  const stops: (() => void)[] = [];

  beforeEach(() => {
    target = new EventTarget();
    vi.stubGlobal('window', target);
    useGameStore.setState(initialGameState());
  });
  afterEach(() => {
    for (const stop of stops.splice(0)) stop();
    vi.unstubAllGlobals();
  });

  it('issues keyboard calls through issueCommand during a race', () => {
    stops.push(attachKeyboard());
    store().startRace();
    const e = press('b');
    press('p');
    press('x');
    expect(e.defaultPrevented).toBe(true);
    expect(store().calls.map((c) => [c.command, c.source])).toEqual([['BOX', 'keyboard'], ['PUSH', 'keyboard']]);
    expect(store().inputs.map((i) => i.command)).toEqual(['BOX', 'PUSH']);
  });

  it('attaches one listener however often it is attached (StrictMode)', () => {
    const first = attachKeyboard();
    first();
    stops.push(attachKeyboard(), attachKeyboard());
    store().startRace();
    press('d');
    expect(store().calls).toHaveLength(1);
  });

  it('stops listening once every attach is cleaned up', () => {
    const a = attachKeyboard();
    const b = attachKeyboard();
    a();
    a(); // a cleanup counts once
    store().startRace();
    press('b');
    expect(store().calls).toHaveLength(1);
    b();
    press('b');
    expect(store().calls).toHaveLength(1);
  });

  it('does nothing on the start screen', () => {
    stops.push(attachKeyboard());
    const e = press('b');
    expect(e.defaultPrevented).toBe(false);
    expect(store().calls).toEqual([]);
  });
});
