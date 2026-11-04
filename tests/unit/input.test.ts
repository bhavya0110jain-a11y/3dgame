import { beforeAll, describe, expect, it } from 'vitest';

// Minimal window/document so Input can register listeners under Node.
const noop = () => {};
const g = globalThis as Record<string, unknown>;
g.window ??= { addEventListener: noop, removeEventListener: noop };
g.document ??= { createElement: () => ({ style: {}, className: '', appendChild: noop }), getElementById: () => null };
g.navigator ??= {};

import type { Input as InputT } from '../../src/core/Input';
let Input: typeof InputT;
beforeAll(async () => {
  ({ Input } = await import('../../src/core/Input'));
});

type TouchInternals = { onTouchStart(e: unknown): void; onTouchMove(e: unknown): void; touchId: number | null };

/** Fake TouchEvent whose target is either a UI element (closest() matches) or the bare canvas. */
function touchEvent(onUi: boolean, x = 100, y = 100) {
  const ev = {
    prevented: false,
    target: { closest: (sel: string) => (onUi && sel.length > 0 ? {} : null) },
    changedTouches: [{ identifier: 1, clientX: x, clientY: y }],
    preventDefault() { ev.prevented = true; },
  };
  return ev;
}

describe('Input touch stick (BUG-QA-004 regression)', () => {
  it('touchStart_onUiButton_doesNotPreventDefaultOrCaptureStick', () => {
    // Arrange
    const input = new Input({ addEventListener: noop } as unknown as HTMLElement);
    const ev = touchEvent(true);
    // Act
    (input as unknown as TouchInternals).onTouchStart(ev);
    // Assert: the browser must still synthesize the click on the button
    expect(ev.prevented).toBe(false);
    expect((input as unknown as TouchInternals).touchId).toBeNull();
  });

  it('touchStart_onCanvas_startsStickAndDragMoves', () => {
    const input = new Input({ addEventListener: noop } as unknown as HTMLElement);
    const start = touchEvent(false, 100, 100);
    (input as unknown as TouchInternals).onTouchStart(start);
    expect(start.prevented).toBe(true);
    (input as unknown as TouchInternals).onTouchMove(touchEvent(false, 150, 100));
    input.update();
    expect(input.moveX).toBeCloseTo(1, 5);
    expect(input.moveZ).toBeCloseTo(0, 5);
  });
});
