/**
 * Island variant metadata shared by the generator (collision proportions) and the view (geometry).
 * Geometry is built at radius 1, top surface at y = 0; collision uses depth/clutter ratios from here.
 * Art override ids: `island_0` … `island_5` in public/models/manifest.json (see src/render/Models.ts).
 */
export interface IslandShape {
  /** Rock depth / radius. */
  depth: number;
  /** Clutter (trees/houses) height / radius. */
  clutter: number;
  trees: number;
  houses: number;
  lanterns: number;
}

export const ISLAND_SHAPES: readonly IslandShape[] = [
  { depth: 1.5, clutter: 0.3, trees: 5, houses: 0, lanterns: 0 },
  { depth: 1.9, clutter: 0.34, trees: 8, houses: 0, lanterns: 0 },
  { depth: 1.2, clutter: 0.12, trees: 1, houses: 0, lanterns: 0 },
  { depth: 1.6, clutter: 0.3, trees: 3, houses: 1, lanterns: 2 },
  { depth: 1.8, clutter: 0.34, trees: 4, houses: 3, lanterns: 3 },
  { depth: 2.2, clutter: 0.5, trees: 2, houses: 1, lanterns: 4 },
];
/** Variants with houses (picked more often in biomes with a high `houses` value). */
export const HOUSE_VARIANTS = [3, 4, 5];
export const WILD_VARIANTS = [0, 1, 2];
