/** Minimal typed event bus. Systems communicate through events instead of direct references. */
export type GameEvents = {
  'enemy:killed': { x: number; z: number; defId: string; xp: number; elite: boolean };
  'enemy:hit': { x: number; z: number; damage: number; crit: boolean };
  'player:damaged': { amount: number };
  'player:healed': { amount: number };
  'player:levelup': { level: number };
  'pickup:collected': { kind: string; value: number };
  'weapon:fired': { weaponId: string };
  'run:started': {};
  'run:ended': { victory: boolean };
  'boss:spawned': { defId: string };
  'boss:killed': { defId: string };
  'chest:opened': {};
  // --- gameplay systems (evolutions, bosses, achievements) ---
  'weapon:evolved': { from: string; to: string; name: string };
  'boss:enraged': { defId: string };
  'enemy:exploded': { x: number; z: number };
  'achievement:unlocked': { id: string; name: string };
  // --- onboarding / director (Sprint 2) ---
  /**
   * First-run onboarding hint (src/game/Tutorial.ts). Fires once per hint id per save, only while save.runs < 2 and
   * settings.hints is on. `duration` = suggested seconds on screen; `priority` = higher may replace a lower one.
   */
  'tutorial:hint': { id: string; text: string; duration: number; priority: number };
  /** An elite was spawned by the Director (the 'An elite approaches…' moment). */
  'elite:spawned': { defId: string; x: number; z: number };
  /** The lantern flared to full light (boss arrival). `amount` = light restored. */
  'lantern:flare': { amount: number };
};

type Handler<T> = (payload: T) => void;

export class EventBus {
  private handlers = new Map<keyof GameEvents, Set<Handler<any>>>();

  on<K extends keyof GameEvents>(type: K, fn: Handler<GameEvents[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(fn);
    return () => set!.delete(fn);
  }

  emit<K extends keyof GameEvents>(type: K, payload: GameEvents[K]): void {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const fn of set) fn(payload);
  }

  clear(): void {
    this.handlers.clear();
  }
}
