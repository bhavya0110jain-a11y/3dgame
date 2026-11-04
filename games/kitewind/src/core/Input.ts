import { clamp, damp } from './math';

const PAD_CODES: readonly string[] = Array.from({ length: 24 }, (_, i) => `Pad${i}`);

/**
 * Flight input from keyboard, mouse, touch and gamepad, merged into steerX (-1 left .. 1 right),
 * steerY (-1 descend .. 1 climb) and dive. Digital inputs are smoothed so banking feels fluid.
 * Mouse: offset of the pointer from the screen centre steers (once the mouse moves); hold a button to dive.
 * Touch: drag on the left ~65% of the screen = relative stick; hold anywhere on the right = dive.
 */
export class Input {
  readonly keys = new Set<string>();
  private pressedThisFrame = new Set<string>();
  steerX = 0;
  steerY = 0;
  dive = false;
  invertY = false;
  sensitivity = 1;
  mouseSteer = true;
  /** Which device steered last (for UI hints). */
  device: 'keyboard' | 'mouse' | 'touch' | 'gamepad' = 'keyboard';
  private mouseX = 0;
  private mouseY = 0;
  private mouseActive = false;
  private mouseDown = false;
  private lastMoveX = 0;
  private lastMoveY = 0;
  private stickId: number | null = null;
  private stickOX = 0;
  private stickOY = 0;
  private stickX = 0;
  private stickY = 0;
  private diveTouches = new Set<number>();
  private gpPrev: boolean[] = [];
  /** Set by the game: true while flying (pointer input is ignored on menus). */
  enabled = false;

  constructor(target: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (!this.keys.has(e.code)) this.pressedThisFrame.add(e.code);
      this.keys.add(e.code);
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code) && !(e.target instanceof HTMLInputElement)) e.preventDefault();
      if (['KeyA', 'KeyD', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyS', 'ArrowUp', 'ArrowDown'].includes(e.code)) {
        this.mouseActive = false;
        this.device = 'keyboard';
      }
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouseDown = false;
      this.diveTouches.clear();
      this.stickId = null;
    });
    target.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') return this.onTouchMove(e);
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
      if (Math.hypot(e.clientX - this.lastMoveX, e.clientY - this.lastMoveY) > 30) {
        this.lastMoveX = e.clientX;
        this.lastMoveY = e.clientY;
        if (this.mouseSteer && this.enabled) {
          this.mouseActive = true;
          this.device = 'mouse';
        }
      }
    });
    target.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') return this.onTouchStart(e);
      if (this.enabled) this.mouseDown = true;
    });
    window.addEventListener('pointerup', (e) => {
      if (e.pointerType === 'touch') return this.onTouchEnd(e);
      this.mouseDown = false;
    });
    window.addEventListener('pointercancel', (e) => this.onTouchEnd(e));
    target.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private onTouchStart(e: PointerEvent): void {
    this.device = 'touch';
    if (!this.enabled) return;
    if (e.clientX > window.innerWidth * 0.65) {
      this.diveTouches.add(e.pointerId);
    } else if (this.stickId === null) {
      this.stickId = e.pointerId;
      this.stickOX = e.clientX;
      this.stickOY = e.clientY;
      this.stickX = this.stickY = 0;
    }
  }

  private onTouchMove(e: PointerEvent): void {
    if (e.pointerId !== this.stickId) return;
    const max = Math.min(window.innerWidth, window.innerHeight) * 0.14;
    this.stickX = clamp((e.clientX - this.stickOX) / max, -1, 1);
    this.stickY = clamp(-(e.clientY - this.stickOY) / max, -1, 1);
  }

  private onTouchEnd(e: PointerEvent): void {
    this.diveTouches.delete(e.pointerId);
    if (e.pointerId === this.stickId) {
      this.stickId = null;
      this.stickX = this.stickY = 0;
    }
  }

  /** Touch stick origin for the HUD (null when not steering by touch). */
  get stick(): { x: number; y: number; dx: number; dy: number } | null {
    return this.stickId === null ? null : { x: this.stickOX, y: this.stickOY, dx: this.stickX, dy: this.stickY };
  }

  pressed(code: string): boolean {
    return this.pressedThisFrame.has(code);
  }

  anyPressed(a: string, b?: string, c?: string): boolean {
    const p = this.pressedThisFrame;
    return p.has(a) || (b !== undefined && p.has(b)) || (c !== undefined && p.has(c));
  }

  /** Polls devices and updates the smoothed steer values. */
  update(dt: number): void {
    let tx = 0, ty = 0;
    let analog = false;
    const k = this.keys;
    if (k.has('KeyA') || k.has('ArrowLeft')) tx -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) tx += 1;
    if (k.has('KeyW') || k.has('ArrowUp')) ty += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) ty -= 1;
    let dive = k.has('Space') || k.has('ShiftLeft') || this.mouseDown || this.diveTouches.size > 0;

    if (this.mouseActive && this.mouseSteer && tx === 0 && ty === 0) {
      const w = window.innerWidth, h = window.innerHeight;
      const s = Math.min(w, h) * 0.32;
      tx = clamp(((this.mouseX - w / 2) / s) * this.sensitivity, -1, 1);
      ty = clamp((-(this.mouseY - h * 0.48) / s) * this.sensitivity, -1, 1);
      // small dead zone around the centre
      tx = Math.abs(tx) < 0.04 ? 0 : tx;
      ty = Math.abs(ty) < 0.04 ? 0 : ty;
      analog = true;
    }
    if (this.stickId !== null) {
      tx = this.stickX * this.sensitivity;
      ty = this.stickY * this.sensitivity;
      analog = true;
    }
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    for (const gp of pads) {
      if (!gp) continue;
      const ax = gp.axes[0] ?? 0, ay = gp.axes[1] ?? 0;
      if (Math.hypot(ax, ay) > 0.15) {
        tx = ax;
        ty = -ay;
        analog = true;
        this.device = 'gamepad';
      }
      if (gp.buttons[0]?.pressed || (gp.buttons[7]?.value ?? 0) > 0.3) dive = true;
      const btns = gp.buttons;
      for (let i = 0; i < btns.length; i++) {
        const down = btns[i].pressed;
        if (down && !(this.gpPrev[i] ?? false)) this.pressedThisFrame.add(PAD_CODES[i] ?? `Pad${i}`);
        this.gpPrev[i] = down;
      }
      break;
    }
    if (this.invertY) ty = -ty;
    tx = clamp(tx, -1, 1);
    ty = clamp(ty, -1, 1);
    const f = analog ? damp(18, dt) : damp(9, dt);
    this.steerX += (tx - this.steerX) * f;
    this.steerY += (ty - this.steerY) * f;
    this.dive = dive;
  }

  endFrame(): void {
    this.pressedThisFrame.clear();
  }
}
