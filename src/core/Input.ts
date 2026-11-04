/** Virtual codes for gamepad buttons (standard mapping has 17; extra headroom for odd pads). */
const PAD_CODES: readonly string[] = Array.from({ length: 24 }, (_, i) => `Pad${i}`);

/** Unified input: keyboard, gamepad and on-screen touch stick. Produces a normalized move vector. */
export class Input {
  readonly keys = new Set<string>();
  private pressedThisFrame = new Set<string>();
  /** Codes pressed this frame while Shift was held at keydown time (BUG-QA-017: Shift+digit banish). */
  private shiftedThisFrame = new Set<string>();
  moveX = 0;
  moveZ = 0;
  private touchId: number | null = null;
  private touchOrigin = { x: 0, y: 0 };
  private touchVec = { x: 0, y: 0 };
  private stickEl: HTMLDivElement | null = null;
  private knobEl: HTMLDivElement | null = null;
  private gpPrev: boolean[] = [];
  usingGamepad = false;
  usingTouch = false;

  constructor(private target: HTMLElement) {
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    target.addEventListener('touchstart', (e) => this.onTouchStart(e), { passive: false });
    target.addEventListener('touchmove', (e) => this.onTouchMove(e), { passive: false });
    target.addEventListener('touchend', (e) => this.onTouchEnd(e));
    target.addEventListener('touchcancel', (e) => this.onTouchEnd(e));
  }

  /** keydown handler (public for tests): records the press and whether Shift was held at that moment. */
  onKeyDown(e: Pick<KeyboardEvent, 'code' | 'shiftKey' | 'preventDefault'>): void {
    if (!this.keys.has(e.code)) {
      this.pressedThisFrame.add(e.code);
      if (e.shiftKey || this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) this.shiftedThisFrame.add(e.code);
    }
    this.keys.add(e.code);
    this.usingGamepad = false;
    if (e.code === 'ArrowUp' || e.code === 'ArrowDown' || e.code === 'ArrowLeft' || e.code === 'ArrowRight' || e.code === 'Space') e.preventDefault();
  }

  /** Was this code pressed since last endFrame() with Shift held at the moment of the press? */
  pressedWithShift(code: string): boolean {
    return this.shiftedThisFrame.has(code);
  }

  private ensureStick(): void {
    if (this.stickEl) return;
    const s = document.createElement('div');
    s.className = 'touch-stick';
    const k = document.createElement('div');
    k.className = 'touch-knob';
    s.appendChild(k);
    document.getElementById('ui-root')?.appendChild(s);
    this.stickEl = s;
    this.knobEl = k;
  }

  private onTouchStart(e: TouchEvent): void {
    this.usingTouch = true;
    // QA BUG-QA-004: touches on UI (menus, level-up cards, HUD pause button) must not start the stick —
    // preventDefault() below would swallow their click and block scrolling in menu screens.
    const tgt = e.target as Element | null;
    if (tgt && typeof tgt.closest === 'function' && tgt.closest('.screen, button, a, input, select, textarea, [data-act]')) return;
    if (this.touchId !== null) return;
    const t = e.changedTouches[0];
    this.touchId = t.identifier;
    this.touchOrigin.x = t.clientX;
    this.touchOrigin.y = t.clientY;
    this.touchVec.x = 0;
    this.touchVec.y = 0;
    this.ensureStick();
    if (this.stickEl) {
      this.stickEl.style.display = 'block';
      this.stickEl.style.left = `${t.clientX}px`;
      this.stickEl.style.top = `${t.clientY}px`;
    }
    e.preventDefault();
  }

  private onTouchMove(e: TouchEvent): void {
    const list = e.changedTouches;
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      if (t.identifier !== this.touchId) continue;
      const dx = t.clientX - this.touchOrigin.x;
      const dy = t.clientY - this.touchOrigin.y;
      const max = 50;
      const len = Math.hypot(dx, dy);
      const k = len > max ? max / len : 1;
      this.touchVec.x = (dx * k) / max;
      this.touchVec.y = (dy * k) / max;
      if (this.knobEl) this.knobEl.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
    }
    e.preventDefault();
  }

  private onTouchEnd(e: TouchEvent): void {
    const list = e.changedTouches;
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      if (t.identifier !== this.touchId) continue;
      this.touchId = null;
      this.touchVec.x = 0;
      this.touchVec.y = 0;
      if (this.stickEl) this.stickEl.style.display = 'none';
      if (this.knobEl) this.knobEl.style.transform = '';
    }
  }

  /** Was this key pressed since last endFrame()? Gamepad buttons map to virtual codes "Pad0".."Pad15". */
  pressed(code: string): boolean {
    return this.pressedThisFrame.has(code);
  }

  /**
   * Was any of these codes pressed this frame? Fixed arity (up to 3) so the per-frame call sites never allocate a rest
   * array (BUG-QA-008).
   */
  anyPressed(a: string, b?: string, c?: string): boolean {
    const p = this.pressedThisFrame;
    return p.has(a) || (b !== undefined && p.has(b)) || (c !== undefined && p.has(c));
  }

  update(): void {
    let x = 0;
    let z = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) z -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) z += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;

    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const gp of pads) {
      if (!gp) continue;
      const ax = gp.axes[0] ?? 0;
      const az = gp.axes[1] ?? 0;
      if (Math.hypot(ax, az) > 0.2) {
        x += ax;
        z += az;
        this.usingGamepad = true;
      }
      if (gp.buttons[12]?.pressed) z -= 1;
      if (gp.buttons[13]?.pressed) z += 1;
      if (gp.buttons[14]?.pressed) x -= 1;
      if (gp.buttons[15]?.pressed) x += 1;
      // plain loop + precomputed codes: no per-frame closure or template-string allocation (BUG-QA-008)
      const btns = gp.buttons;
      for (let i = 0; i < btns.length; i++) {
        const down = btns[i].pressed;
        if (down && !(this.gpPrev[i] ?? false)) {
          this.pressedThisFrame.add(PAD_CODES[i] ?? `Pad${i}`);
          this.usingGamepad = true;
        }
        this.gpPrev[i] = down;
      }
      break;
    }

    x += this.touchVec.x;
    z += this.touchVec.y;
    const len = Math.hypot(x, z);
    if (len > 1) {
      x /= len;
      z /= len;
    }
    this.moveX = x;
    this.moveZ = z;
  }

  endFrame(): void {
    this.pressedThisFrame.clear();
    this.shiftedThisFrame.clear();
  }
}
