/** Uniform-grid spatial hash on the XZ plane for fast neighbour queries. */
export class SpatialHash<T extends { x: number; z: number }> {
  private cells = new Map<number, T[]>();
  private pool: T[][] = [];
  constructor(public readonly cellSize = 2) {}

  private key(cx: number, cz: number): number {
    // pack two signed 16-bit ints
    return ((cx + 32768) << 16) | ((cz + 32768) & 0xffff);
  }

  clear(): void {
    for (const arr of this.cells.values()) {
      arr.length = 0;
      this.pool.push(arr);
    }
    this.cells.clear();
  }

  insert(item: T): void {
    const cx = Math.floor(item.x / this.cellSize);
    const cz = Math.floor(item.z / this.cellSize);
    const k = this.key(cx, cz);
    let arr = this.cells.get(k);
    if (!arr) {
      arr = this.pool.pop() ?? [];
      this.cells.set(k, arr);
    }
    arr.push(item);
  }

  /** Calls fn for every item whose cell overlaps the circle. fn may return true to stop early. */
  query(x: number, z: number, radius: number, fn: (item: T) => boolean | void): void {
    const cs = this.cellSize;
    const minX = Math.floor((x - radius) / cs);
    const maxX = Math.floor((x + radius) / cs);
    const minZ = Math.floor((z - radius) / cs);
    const maxZ = Math.floor((z + radius) / cs);
    for (let cx = minX; cx <= maxX; cx++) {
      for (let cz = minZ; cz <= maxZ; cz++) {
        const arr = this.cells.get(this.key(cx, cz));
        if (!arr) continue;
        for (let i = 0; i < arr.length; i++) if (fn(arr[i])) return;
      }
    }
  }
}
