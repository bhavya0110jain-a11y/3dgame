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

type KeyInternals = { pressedThisFrame: Set<string> };
type PadButton = { pressed: boolean };

describe('Input pressed-this-frame (BUG-QA-008 fixed-arity anyPressed)', () => {
  it('anyPressed_oneToThreeCodes_matchesAnyPosition', () => {
    const input = new Input({ addEventListener: noop } as unknown as HTMLElement);
    (input as unknown as KeyInternals).pressedThisFrame.add('KeyP');
    expect(input.anyPressed('KeyP')).toBe(true);
    expect(input.anyPressed('Escape', 'KeyP')).toBe(true);
    expect(input.anyPressed('Escape', 'Pad9', 'KeyP')).toBe(true);
    expect(input.anyPressed('Escape', 'Pad9')).toBe(false);
  });

  it('endFrame_afterPress_clearsPressed', () => {
    const input = new Input({ addEventListener: noop } as unknown as HTMLElement);
    (input as unknown as KeyInternals).pressedThisFrame.add('Space');
    input.endFrame();
    expect(input.anyPressed('Space')).toBe(false);
  });

  it('gamepadButton_heldAcrossFrames_reportsPressOnlyOnEdge', () => {
    // Arrange: a standard pad with button 0 held
    const buttons: PadButton[] = Array.from({ length: 17 }, () => ({ pressed: false }));
    const pad = { axes: [0, 0], buttons };
    const nav = globalThis.navigator as unknown as { getGamepads?: () => unknown[] };
    const prev = nav.getGamepads;
    nav.getGamepads = () => [null, pad];
    try {
      const input = new Input({ addEventListener: noop } as unknown as HTMLElement);
      buttons[0].pressed = true;
      // Act + Assert
      input.update();
      expect(input.pressed('Pad0')).toBe(true);
      expect(input.usingGamepad).toBe(true);
      input.endFrame();
      input.update();
      expect(input.pressed('Pad0')).toBe(false); // still held: no new press
      buttons[0].pressed = false;
      input.endFrame();
      input.update();
      buttons[0].pressed = true;
      input.endFrame();
      input.update();
      expect(input.pressed('Pad0')).toBe(true); // released and pressed again
    } finally {
      nav.getGamepads = prev;
    }
  });

  it('gamepadDpad_down_movesWithoutStick', () => {
    const buttons: PadButton[] = Array.from({ length: 17 }, () => ({ pressed: false }));
    buttons[15].pressed = true; // d-pad right
    const nav = globalThis.navigator as unknown as { getGamepads?: () => unknown[] };
    const prev = nav.getGamepads;
    nav.getGamepads = () => [{ axes: [0, 0], buttons }];
    try {
      const input = new Input({ addEventListener: noop } as unknown as HTMLElement);
      input.update();
      expect(input.moveX).toBe(1);
      expect(input.moveZ).toBe(0);
    } finally {
      nav.getGamepads = prev;
    }
  });
});

describe('Input Shift+digit (BUG-QA-017)', () => {
  const key = (code: string, shiftKey: boolean) => ({ code, shiftKey, preventDefault: noop });

  it('shiftDigitTap_releasedBeforeFrame_stillReportsShifted', () => {
    // Arrange
    const input = new Input({ addEventListener: noop } as unknown as HTMLElement);
    // Act: Shift+1 pressed and both released before the frame runs
    input.onKeyDown(key('ShiftLeft', true));
    input.onKeyDown(key('Digit1', true));
    input.keys.clear();
    // Assert
    expect(input.pressed('Digit1')).toBe(true);
    expect(input.pressedWithShift('Digit1')).toBe(true);
  });

  it('plainDigit_noShift_notShiftedAndClearedAtEndFrame', () => {
    const input = new Input({ addEventListener: noop } as unknown as HTMLElement);
    input.onKeyDown(key('Digit2', false));
    expect(input.pressedWithShift('Digit2')).toBe(false);
    input.onKeyDown(key('ShiftRight', true));
    input.keys.delete('Digit2');
    input.onKeyDown(key('Digit2', true));
    expect(input.pressedWithShift('Digit2')).toBe(true);
    input.endFrame();
    expect(input.pressedWithShift('Digit2')).toBe(false);
  });
});
