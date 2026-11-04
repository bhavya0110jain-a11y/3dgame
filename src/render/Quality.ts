/** Render quality tier chosen in Settings (and possibly lowered by the Renderer's automatic fallback). */
export type Quality = 'low' | 'medium' | 'high';

/**
 * Shared, read-only view of the tier the Renderer is currently drawing. The Renderer is the only writer
 * (Renderer.applyTier); World polls `version` once per frame (World.update) and rescales grass, prop density
 * and shadow casting when it changes. A plain module object keeps World free of a Renderer dependency.
 */
export const renderQuality = {
  tier: 'high' as Quality,
  /** Bumped on every tier change. */
  version: 0,
  /** True when the lantern renders its (prop-only) cube shadow this tier. */
  lanternShadows: true,
};

/**
 * Ground footprint of the main camera (world XZ bounds of the frustum's corner rays hitting y = 0 and y =
 * VIEW_TALL), written by CameraRig every frame. `valid` is false when a corner ray reaches the horizon (menu hero
 * shot, mid-swoop): consumers must then assume everything is visible. World uses it to cull instanced props.
 */
export const renderView = {
  valid: false,
  minX: 0,
  maxX: 0,
  minZ: 0,
  maxZ: 0,
};
/** Height (m) of the tallest props, so tree crowns standing just beyond the ground footprint still count. */
export const VIEW_TALL = 7;
