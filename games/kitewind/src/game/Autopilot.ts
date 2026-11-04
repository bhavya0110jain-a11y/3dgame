import { clamp, DEG } from '../core/math';
import { FLIGHT } from '../data/tuning';
import type { FlightInput } from './Flight';
import type { Run } from './Run';

/**
 * Simple line-following pilot: aims at the next unpassed ring (or the guide line ahead).
 * Drives the menu attract-mode flight, the headless run tests and the smoke probe. Writes into `out` (no allocs).
 */
export function autopilot(run: Run, out: FlightInput, lookAhead = 34): FlightInput {
  const f = run.flight;
  let tx = run.world.gen.guideX(f.z + lookAhead);
  let ty = run.world.gen.guideY(f.z + lookAhead);
  let tz = f.z + lookAhead;
  let best = Infinity;
  for (const c of run.world.active) {
    if (c.z0 > f.z + 120 || c.z0 + 100 < f.z) continue;
    for (const r of c.rings) {
      if (r.passed || r.missed || r.z < f.z + 4 || r.z > f.z + 70) continue;
      if (r.z < best) {
        best = r.z;
        tx = r.x;
        ty = r.y;
        tz = r.z;
      }
    }
    for (const s of c.shrines) {
      if (s.taken || s.missed || s.z < f.z + 4 || s.z > f.z + 70) continue;
      if (s.z < best) {
        best = s.z;
        tx = s.x;
        ty = s.y;
        tz = s.z;
      }
    }
  }
  const dz = Math.max(4, tz - f.z);
  const desiredYaw = Math.atan2(f.x - tx, dz); // right = -X
  out.steerX = clamp((desiredYaw - f.yaw) * 3.2 - f.bank * 0.25, -1, 1);
  const desiredPitch = Math.atan2(ty - f.y, Math.hypot(tx - f.x, dz));
  out.steerY = clamp((desiredPitch / (FLIGHT.maxPitch * DEG)) * 1.6 + (desiredPitch - f.pitch) * 1.5, -1, 1);
  out.dive = desiredPitch < -24 * DEG && f.y > 12;
  return out;
}
