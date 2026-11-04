import * as THREE from 'three';
import { Rng } from '../core/Rng';
import { ISLAND_SHAPES } from './islandShapes';

/** Palette slots used by makePaletteMaterial (src/render/materials.ts). */
export const PART = { rock: 0, rockDark: 1, grass: 2, trunk: 3, leaves: 4, roof: 5, wall: 6, glow: 7 } as const;

/**
 * Accumulates flat-shaded triangles with a palette slot and a per-vertex shade (grey vertex colour), then emits a
 * non-indexed BufferGeometry with position / normal / color / aPart.
 */
export class MeshBuilder {
  private pos: number[] = [];
  private col: number[] = [];
  private part: number[] = [];
  private tmp = new THREE.Vector3();
  private n = new THREE.Vector3();
  private e1 = new THREE.Vector3();
  private e2 = new THREE.Vector3();

  tri(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, part: number, shade: number | [number, number, number], mossUp = -1): void {
    let p = part;
    if (mossUp >= 0) {
      this.e1.subVectors(b, a);
      this.e2.subVectors(c, a);
      this.n.crossVectors(this.e1, this.e2).normalize();
      if (this.n.y > mossUp) p = PART.grass;
    }
    const s = Array.isArray(shade) ? shade : [shade, shade, shade];
    for (const [v, k] of [[a, s[0]], [b, s[1]], [c, s[2]]] as const) {
      this.pos.push(v.x, v.y, v.z);
      this.col.push(k, k, k);
      this.part.push(p);
    }
  }

  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, part: number, shade: number, mossUp = -1): void {
    this.tri(a, b, c, part, shade, mossUp);
    this.tri(a, c, d, part, shade, mossUp);
  }

  /** Appends a three.js geometry transformed by m, all in one palette slot, shade jittered per face. */
  add(geo: THREE.BufferGeometry, m: THREE.Matrix4, part: number, shade: number, rng?: Rng, mossUp = -1): void {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const p = g.getAttribute('position');
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for (let i = 0; i < p.count; i += 3) {
      a.fromBufferAttribute(p, i).applyMatrix4(m);
      b.fromBufferAttribute(p, i + 1).applyMatrix4(m);
      c.fromBufferAttribute(p, i + 2).applyMatrix4(m);
      const s = shade * (rng ? rng.range(0.88, 1.08) : 1);
      this.tri(a, b, c, part, s, mossUp);
    }
    if (g !== geo) g.dispose();
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aPart', new THREE.Float32BufferAttribute(this.part, 1));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

const v = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
const M = new THREE.Matrix4();
const Q = new THREE.Quaternion();
const S = new THREE.Vector3();
const P = new THREE.Vector3();
const E = new THREE.Euler();
const mat = (x: number, y: number, z: number, sx: number, sy: number, sz: number, ry = 0, rx = 0, rz = 0): THREE.Matrix4 =>
  M.compose(P.set(x, y, z), Q.setFromEuler(E.set(rx, ry, rz)), S.set(sx, sy, sz));

/** Floating island at radius 1, top surface y = 0, rock tapering to a tip at y = -depth. */
export function buildIsland(variant: number): THREE.BufferGeometry {
  const shape = ISLAND_SHAPES[variant];
  const rng = new Rng(9001 + variant * 77);
  const b = new MeshBuilder();
  const S_ = 11 + (variant % 3) * 2;
  const levels = [0, 0.06, 0.2, 0.42, 0.66, 0.86];
  const rings: THREE.Vector3[][] = [];
  const wob = [rng.range(-0.15, 0.15), rng.range(-0.15, 0.15)];
  for (let li = 0; li < levels.length; li++) {
    const t = levels[li];
    const ring: THREE.Vector3[] = [];
    const base = li === 0 ? 1 : li === 1 ? 1.03 : Math.pow(1 - t, 0.85) * (0.95 + rng.range(-0.05, 0.05));
    for (let s = 0; s < S_; s++) {
      const a = (s / S_) * Math.PI * 2 + (li % 2) * (Math.PI / S_) * 0.6;
      const r = base * (1 + (li > 1 ? rng.range(-0.14, 0.14) : rng.range(-0.04, 0.04)));
      const y = -t * shape.depth + (li > 0 ? rng.range(-0.04, 0.04) * shape.depth : 0);
      ring.push(v(Math.cos(a) * r + wob[0] * t, y, Math.sin(a) * r + wob[1] * t));
    }
    rings.push(ring);
  }
  const tip = v(wob[0] * 1.2 + rng.range(-0.1, 0.1), -shape.depth, wob[1] * 1.2);
  for (let li = 0; li < rings.length - 1; li++) {
    const A = rings[li], B = rings[li + 1];
    const part = li === 0 ? PART.grass : li === 1 ? PART.rockDark : li % 2 === 0 ? PART.rock : PART.rockDark;
    for (let s = 0; s < S_; s++) {
      const s2 = (s + 1) % S_;
      const shade = (1 - levels[li] * 0.45) * rng.range(0.85, 1.05);
      b.quad(A[s], A[s2], B[s2], B[s], part, shade);
    }
  }
  const last = rings[rings.length - 1];
  for (let s = 0; s < S_; s++) b.tri(last[s], last[(s + 1) % S_], tip, PART.rockDark, 0.5 * rng.range(0.85, 1.1));
  // grass top: gentle dome
  const top = rings[0];
  const centre = v(0, 0.05, 0);
  const inner: THREE.Vector3[] = top.map((p) => v(p.x * 0.6, 0.035 + rng.range(-0.01, 0.01), p.z * 0.6));
  for (let s = 0; s < S_; s++) {
    const s2 = (s + 1) % S_;
    b.tri(centre, inner[s2], inner[s], PART.grass, 1.05 * rng.range(0.92, 1.05));
    b.quad(inner[s], inner[s2], top[s2], top[s], PART.grass, rng.range(0.92, 1.04));
  }
  // decorations
  const spots: [number, number][] = [];
  const place = (minR: number, maxR: number, clear: number): [number, number] | null => {
    for (let k = 0; k < 30; k++) {
      const a = rng.range(0, Math.PI * 2);
      const r = Math.sqrt(rng.range(minR * minR, maxR * maxR));
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (spots.every(([sx, sz]) => Math.hypot(sx - x, sz - z) > clear)) {
        spots.push([x, z]);
        return [x, z];
      }
    }
    return null;
  };
  const cone = new THREE.ConeGeometry(1, 1, 6, 1);
  const ico = new THREE.IcosahedronGeometry(1, 0);
  const cyl = new THREE.CylinderGeometry(1, 1, 1, 5, 1);
  const box = new THREE.BoxGeometry(1, 1, 1);
  const roofG = new THREE.CylinderGeometry(0.0001, 0.75, 1, 4, 1); // pyramid roof
  const dodec = new THREE.DodecahedronGeometry(1, 0);
  const C = shape.clutter;
  for (let h = 0; h < shape.houses; h++) {
    const s = place(0, 0.5, 0.26);
    if (!s) continue;
    const [x, z] = s;
    const w = rng.range(0.1, 0.14), d = rng.range(0.09, 0.12), hh = Math.min(C * 0.45, 0.1);
    const ry = rng.range(0, Math.PI);
    b.add(box, mat(x, hh / 2 + 0.03, z, w, hh, d, ry), PART.wall, 1, rng);
    b.add(roofG, mat(x, hh + 0.03 + hh * 0.35, z, w * 0.95, hh * 0.7, d * 1.3, ry + Math.PI / 4), PART.roof, 1, rng);
    // glowing windows on two faces
    for (const side of [1, -1]) {
      const wx = x + Math.cos(ry) * 0 + Math.sin(ry) * (d / 2 + 0.002) * side;
      const wz = z + Math.cos(ry) * (d / 2 + 0.002) * side;
      b.add(box, mat(wx, hh * 0.55 + 0.03, wz, w * 0.28, hh * 0.3, 0.004, ry), PART.glow, 1);
    }
  }
  for (let l = 0; l < shape.lanterns; l++) {
    const s = place(0.3, 0.9, 0.12);
    if (!s) continue;
    const [x, z] = s;
    const ph = Math.min(C * 0.6, 0.16);
    b.add(cyl, mat(x, ph / 2 + 0.02, z, 0.008, ph, 0.008), PART.trunk, 0.7);
    b.add(box, mat(x, ph + 0.03, z, 0.035, 0.045, 0.035, rng.range(0, 1)), PART.glow, 1);
  }
  for (let t = 0; t < shape.trees; t++) {
    const s = place(0, 0.82, 0.15);
    if (!s) continue;
    const [x, z] = s;
    const th = C * rng.range(0.6, 1);
    const pine = rng.chance(0.55);
    b.add(cyl, mat(x, th * 0.2, z, 0.018, th * 0.4, 0.018), PART.trunk, 0.8, rng);
    if (pine) {
      b.add(cone, mat(x, th * 0.48, z, th * 0.32, th * 0.5, th * 0.32, rng.range(0, 3)), PART.leaves, 0.9, rng);
      b.add(cone, mat(x, th * 0.78, z, th * 0.22, th * 0.42, th * 0.22, rng.range(0, 3)), PART.leaves, 1.05, rng);
    } else {
      b.add(ico, mat(x, th * 0.62, z, th * 0.34, th * 0.3, th * 0.34, rng.range(0, 3)), PART.leaves, 1, rng);
      b.add(ico, mat(x + th * 0.12, th * 0.78, z - th * 0.05, th * 0.2, th * 0.18, th * 0.2, rng.range(0, 3)), PART.leaves, 1.12, rng);
    }
  }
  const rocks = 2 + (variant % 3);
  for (let r = 0; r < rocks; r++) {
    const s = place(0.5, 0.95, 0.1);
    if (!s) continue;
    const sz = rng.range(0.03, 0.07);
    b.add(dodec, mat(s[0], 0.03, s[1], sz, sz * 0.7, sz, rng.range(0, 3)), PART.rock, 0.9, rng);
  }
  // hanging roots/rocks under the rim
  for (let k = 0; k < 4; k++) {
    const a = rng.range(0, Math.PI * 2);
    const sz = rng.range(0.08, 0.16);
    b.add(dodec, mat(Math.cos(a) * 0.75, -shape.depth * rng.range(0.15, 0.3), Math.sin(a) * 0.75, sz, sz * 1.8, sz, a), PART.rockDark, 0.7, rng);
  }
  return b.build();
}

/** Storm spire: jagged rock column, base radius 1 at y = 0 (extends below the sea), tip at y = 1. */
export function buildSpire(): THREE.BufferGeometry {
  const rng = new Rng(4242);
  const b = new MeshBuilder();
  const S_ = 7;
  const lv = [-0.15, 0, 0.18, 0.38, 0.58, 0.78, 0.92];
  const rings: THREE.Vector3[][] = lv.map((y, li) => {
    const r = Math.max(0.12, 1 - 0.55 * Math.max(0, y)) * (li ? rng.range(0.85, 1.1) : 1.15);
    return Array.from({ length: S_ }, (_, s) => {
      const a = (s / S_) * Math.PI * 2 + li * 0.4;
      return v(Math.cos(a) * r * rng.range(0.85, 1.15), y + rng.range(-0.02, 0.02), Math.sin(a) * r * rng.range(0.85, 1.15));
    });
  });
  for (let li = 0; li < rings.length - 1; li++) {
    for (let s = 0; s < S_; s++) {
      const s2 = (s + 1) % S_;
      b.quad(rings[li][s], rings[li][s2], rings[li + 1][s2], rings[li + 1][s], li % 3 === 1 ? PART.rock : PART.rockDark, 0.55 + li * 0.07);
    }
  }
  const tip = v(0.05, 1, 0);
  const L = rings[rings.length - 1];
  for (let s = 0; s < S_; s++) b.tri(L[s], L[(s + 1) % S_], tip, PART.rockDark, 0.9);
  return b.build();
}

/** Stone arch: half torus in the XY plane, radius 1, tube ≈ 0.14 (matches Generator: tube = R * 0.14), mossy top. */
export function buildArch(): THREE.BufferGeometry {
  const rng = new Rng(777);
  const b = new MeshBuilder();
  const T = 16, R_ = 6, tube = 0.14;
  const pts: THREE.Vector3[][] = [];
  for (let i = 0; i <= T; i++) {
    const u = (i / T) * Math.PI;
    const row: THREE.Vector3[] = [];
    const tj = tube * rng.range(0.9, 1.15) * (i === 0 || i === T ? 1.3 : 1);
    for (let j = 0; j < R_; j++) {
      const w = (j / R_) * Math.PI * 2;
      const r = 1 + Math.cos(w) * tj;
      row.push(v(Math.cos(u) * r, Math.sin(u) * r - (i === 0 || i === T ? 0.12 : 0), Math.sin(w) * tj));
    }
    pts.push(row);
  }
  for (let i = 0; i < T; i++)
    for (let j = 0; j < R_; j++) {
      const j2 = (j + 1) % R_;
      b.quad(pts[i][j], pts[i + 1][j], pts[i + 1][j2], pts[i][j2], i % 2 ? PART.rock : PART.rockDark, rng.range(0.75, 1), 0.55);
    }
  return b.build();
}
