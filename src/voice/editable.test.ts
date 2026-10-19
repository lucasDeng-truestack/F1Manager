import { describe, expect, it } from 'vitest';
import { isEditableTarget } from './editable';

const el = (props: Record<string, unknown>): EventTarget => props as unknown as EventTarget;

describe('isEditableTarget', () => {
  it.each([
    ['input', el({ tagName: 'INPUT' }), true],
    ['lower-case tag (XHTML)', el({ tagName: 'input' }), true],
    ['textarea', el({ tagName: 'TEXTAREA' }), true],
    ['select', el({ tagName: 'SELECT' }), true],
    ['contenteditable div', el({ tagName: 'DIV', isContentEditable: true }), true],
    ['contenteditable, no tag', el({ isContentEditable: true }), true],
    ['button', el({ tagName: 'BUTTON', isContentEditable: false }), false],
    ['body', el({ tagName: 'BODY' }), false],
    ['isContentEditable not a boolean', el({ tagName: 'DIV', isContentEditable: 'true' }), false],
    ['window-like target (no tagName)', new EventTarget(), false],
    ['null', null, false],
    ['undefined', undefined, false],
  ])('%s → %s', (_name, target, expected) => {
    expect(isEditableTarget(target)).toBe(expected);
  });
});
