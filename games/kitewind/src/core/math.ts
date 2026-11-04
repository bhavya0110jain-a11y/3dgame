/** Small allocation-free math helpers shared by sim and render code. */
export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smoothstep = (a: number, b: number, v: number): number => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
/** Frame-rate independent exponential approach: returns the factor for `x += (target - x) * f`. */
export const damp = (rate: number, dt: number): number => 1 - Math.exp(-rate * dt);
/** Approaches `target` from `cur` at most `maxDelta`. */
export const approach = (cur: number, target: number, maxDelta: number): number =>
  cur < target ? Math.min(target, cur + maxDelta) : Math.max(target, cur - maxDelta);
export const DEG = Math.PI / 180;

/** Squared distance from point p to segment ab (3D). */
export function distSqPointSegment(
  px: number, py: number, pz: number,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
): number {
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const len2 = abx * abx + aby * aby + abz * abz;
  let t = len2 > 0 ? (apx * abx + apy * aby + apz * abz) / len2 : 0;
  t = clamp(t, 0, 1);
  const dx = apx - abx * t, dy = apy - aby * t, dz = apz - abz * t;
  return dx * dx + dy * dy + dz * dz;
}
