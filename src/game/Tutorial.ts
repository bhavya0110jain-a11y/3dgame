/**
 * First-run onboarding (design/gdd/onboarding.md). Emits `tutorial:hint` events at the first occurrence of key
 * moments; the UI renders them. Active only while `save.runs < TUTORIAL_RUNS` and `save.settings.hints` is on.
 * Each hint id is shown at most once per save (`save.hintsSeen`), so a second run only teaches what the first
 * run never reached (elites, reliquaries, the boss…).
 */
import type { EventBus } from '../core/EventBus';
import { TUTORIAL_RUNS, type SaveData } from '../core/Save';
import { HINTS, HINT_MOVE_DELAY } from '../data/tutorial';

export type InputDevice = 'keyboard' | 'touch' | 'gamepad';

export class Tutorial {
  /** True during a run in which hints may fire. */
  active = false;
  private moveAt = -1;
  private elapsed = 0;

  constructor(
    private getSave: () => SaveData,
    private events: EventBus,
    private device: () => InputDevice,
    private persist: () => void,
  ) {}

  onRunStart(): void {
    const save = this.getSave();
    this.active = !!save.settings.hints && save.runs < TUTORIAL_RUNS;
    this.elapsed = 0;
    this.moveAt = this.active ? HINT_MOVE_DELAY : -1;
  }

  onRunEnd(): void {
    this.active = false;
    this.moveAt = -1;
  }

  /** Advances timed hints. Call with game-time dt while playing. */
  update(dt: number): void {
    if (!this.active) return;
    this.elapsed += dt;
    if (this.moveAt >= 0 && this.elapsed >= this.moveAt) {
      this.moveAt = -1;
      this.show('move');
    }
  }

  /** Has this hint already been shown on this save? */
  seen(id: string): boolean {
    return this.getSave().hintsSeen.includes(id);
  }

  /** Fires hint `id` if onboarding is active and it has not been shown yet. Returns true when emitted. */
  show(id: string): boolean {
    if (!this.active) return false;
    const def = HINTS[id];
    if (!def) return false;
    const save = this.getSave();
    if (save.hintsSeen.includes(id)) return false;
    save.hintsSeen.push(id);
    const dev = this.device();
    const text = (dev === 'touch' ? def.touch : dev === 'gamepad' ? def.gamepad : undefined) ?? def.text;
    this.events.emit('tutorial:hint', { id, text, duration: def.duration, priority: def.priority });
    this.persist();
    return true;
  }
}
