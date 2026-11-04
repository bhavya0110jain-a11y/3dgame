/** Minimal typed event bus. Gameplay emits; audio, UI and FX listen. */
export type GameEvents = {
  'run:started': { seed: number; daily: boolean };
  'run:ended': { distance: number; score: number; cause: string };
  'ring:passed': { combo: number; perfect: boolean; x: number; y: number; z: number; points: number };
  'ring:missed': Record<string, never>;
  'glimmer:collected': { x: number; y: number; z: number; combo: number };
  'combo:lost': { combo: number };
  'whisker': { x: number; y: number; z: number; points: number };
  'arch:threaded': { points: number };
  'updraft:enter': Record<string, never>;
  'shield:hit': { cause: string };
  'crash': { cause: string; x: number; y: number; z: number };
  'biome:changed': { id: string; name: string; index: number };
  'shrine:reached': Record<string, never>;
  'boon:picked': { id: string; name: string };
  'lightning:strike': { x: number; y: number; z: number };
  'gust:warn': Record<string, never>;
  'lift:low': Record<string, never>;
  'dive:start': Record<string, never>;
  'dive:end': Record<string, never>;
  'achievement:unlocked': { id: string; name: string };
  'secondwind': Record<string, never>;
};

type Handler<T> = (payload: T) => void;

export class EventBus {
  private handlers = new Map<keyof GameEvents, Set<Handler<any>>>();

  /** Subscribes; returns an unsubscribe function. */
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
