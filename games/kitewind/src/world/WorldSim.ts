import { WORLD } from '../data/tuning';
import { Generator } from './Generator';
import type { Chunk } from './types';

/**
 * Streams generated chunks around the kite. `active` is ordered by chunk index; `version` increments whenever the
 * set changes so views can rebuild their (static) instance buffers only then.
 */
export class WorldSim {
  readonly gen: Generator;
  readonly active: Chunk[] = [];
  version = 0;
  private lo = 0;
  private hi = -1;

  constructor(seed: number) {
    this.gen = new Generator(seed);
  }

  /** Ensures chunks around distance z exist; drops chunks behind. Returns true if the set changed. */
  update(z: number): boolean {
    const L = WORLD.chunkLength;
    const cur = Math.floor(z / L);
    const lo = Math.max(0, cur - WORLD.chunksBehind);
    const hi = cur + WORLD.chunksAhead;
    if (lo === this.lo && hi === this.hi) return false;
    // drop
    while (this.active.length && this.active[0].index < lo) this.active.shift();
    // add
    let next = this.active.length ? this.active[this.active.length - 1].index + 1 : lo;
    for (; next <= hi; next++) this.active.push(this.gen.chunk(next));
    this.lo = lo;
    this.hi = hi;
    this.version++;
    return true;
  }

  /** Chunk containing z, if streamed. */
  chunkAt(z: number): Chunk | undefined {
    const idx = Math.floor(z / WORLD.chunkLength);
    for (const c of this.active) if (c.index === idx) return c;
    return undefined;
  }
}
