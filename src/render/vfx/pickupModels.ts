import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Procedural pickup meshes (chunky, bevelled, readable from the gameplay camera). Built once at boot.
 * Unlit "gem" meshes get baked facet shading in vertex colours (brighter faces toward the moon/up) so a
 * MeshBasicMaterial still reads as a cut crystal; values > 1 in the colours feed bloom.
 */
const LIGHT = new THREE.Vector3(-0.45, 1, 0.35).normalize();

/** Non-indexed copy with per-face colour = base × (ambient + diffuse·N·L), scaled by `gain`. */
function facet(geo: THREE.BufferGeometry, base: THREE.ColorRepresentation, gain = 1, amb = 0.5): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  g.computeVertexNormals();
  const pos = g.getAttribute('position');
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color(base);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), d = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    d.fromBufferAttribute(pos, i + 2);
    n.subVectors(d, b).cross(a.clone().sub(b)).normalize();
    // the facet's world normal may face either way depending on winding; use |N·L| with a bias to the top
    const k = (amb + (1 - amb) * Math.max(0, Math.abs(n.dot(LIGHT)) * 0.8 + n.y * 0.2)) * gain;
    for (let j = 0; j < 3; j++) {
      col[(i + j) * 3] = c.r * k;
      col[(i + j) * 3 + 1] = c.g * k;
      col[(i + j) * 3 + 2] = c.b * k;
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

function paint(geo: THREE.BufferGeometry, color: THREE.ColorRepresentation, gain = 1): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  const pos = g.getAttribute('position');
  const c = new THREE.Color(color).multiplyScalar(gain);
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  return g;
}

/** Ember: elongated cut gem (white facets; tinted per instance). ~0.16 r, 0.5 tall. */
export function emberGeometry(): THREE.BufferGeometry {
  const g = new THREE.OctahedronGeometry(0.16, 0).scale(1, 1.55, 1);
  const f = facet(g, 0xffffff, 1.15, 0.45);
  f.deleteAttribute('uv');
  return f;
}

/** Ash: small chunky violet crystal cluster. */
export function ashGeometry(): THREE.BufferGeometry {
  const a = new THREE.OctahedronGeometry(0.16, 0).scale(0.8, 1.6, 0.8);
  const b = new THREE.OctahedronGeometry(0.1, 0).scale(0.8, 1.5, 0.8).rotateZ(0.5).translate(0.11, -0.06, 0.02);
  const c = new THREE.OctahedronGeometry(0.09, 0).scale(0.8, 1.4, 0.8).rotateZ(-0.6).translate(-0.1, -0.07, -0.03);
  const parts = [a, b, c].map((g) => {
    const f = facet(g, 0xd8c8ff, 1.9, 0.4);
    f.deleteAttribute('uv');
    return f;
  });
  return mergeGeometries(parts)!;
}

/** Lamp-oil flask: round glass belly with glowing oil, neck, cork. Unlit (it IS a light source). */
export function oilGeometry(): THREE.BufferGeometry {
  const prof = [
    [0.0, 0.0], [0.13, 0.0], [0.2, 0.05], [0.235, 0.14], [0.22, 0.24], [0.16, 0.31], [0.085, 0.35], [0.075, 0.43], [0.0, 0.43],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const glass = new THREE.LatheGeometry(prof, 14);
  const cork = new THREE.CylinderGeometry(0.075, 0.065, 0.1, 10).translate(0, 0.48, 0);
  const rim = new THREE.TorusGeometry(0.085, 0.022, 6, 14).rotateX(Math.PI / 2).translate(0, 0.42, 0);
  const label = new THREE.CylinderGeometry(0.236, 0.236, 0.06, 14, 1, true).translate(0, 0.15, 0);
  // oil: hot amber, brighter low in the belly
  const g = glass.toNonIndexed();
  g.deleteAttribute('uv');
  const pos = g.getAttribute('position');
  const col = new Float32Array(pos.count * 3);
  const hot = new THREE.Color(0xffb040), top = new THREE.Color(0xffe6a8);
  const t = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const side = 0.75 + 0.25 * Math.max(0, -pos.getX(i) / 0.24 + pos.getZ(i) / 0.24) * 0.5;
    t.copy(hot).lerp(top, Math.min(1, y / 0.42)).multiplyScalar((y < 0.27 ? 2.6 : 1.5) * side);
    col[i * 3] = t.r;
    col[i * 3 + 1] = t.g;
    col[i * 3 + 2] = t.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return mergeGeometries([g, paint(cork, 0x5a3418, 0.9), paint(rim, 0xc89a5a, 1.2), paint(label, 0x6a2a1a, 0.9)])!;
}

/** Reliquary chest: rounded wooden body, barrel lid, gold bands, lock. Lit (MeshStandard + vertex colours). */
export function chestGeometry(): THREE.BufferGeometry {
  const wood = 0x8a5230;
  const woodDark = 0x5a321c;
  const gold = 0xffc850;
  const body = new RoundedBoxGeometry(0.92, 0.46, 0.62, 3, 0.07).translate(0, 0.23, 0);
  const lid = new THREE.CylinderGeometry(0.31, 0.31, 0.92, 16, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateX(Math.PI / 2).translate(0, 0.46, 0);
  const lidCapL = new THREE.CircleGeometry(0.31, 16, 0, Math.PI).rotateY(-Math.PI / 2).rotateX(0).translate(-0.46, 0.46, 0);
  const lidCapR = new THREE.CircleGeometry(0.31, 16, 0, Math.PI).rotateY(Math.PI / 2).translate(0.46, 0.46, 0);
  const parts: THREE.BufferGeometry[] = [paint(body, wood), paint(lid, wood, 1.05), paint(lidCapL, woodDark), paint(lidCapR, woodDark)];
  for (const x of [-0.3, 0.3]) {
    parts.push(paint(new RoundedBoxGeometry(0.09, 0.5, 0.66, 2, 0.02).translate(x, 0.23, 0), gold, 1.1));
    parts.push(paint(new THREE.TorusGeometry(0.325, 0.03, 6, 16, Math.PI).rotateY(Math.PI / 2).translate(x, 0.46, 0), gold, 1.1));
  }
  parts.push(paint(new RoundedBoxGeometry(0.16, 0.2, 0.06, 2, 0.02).translate(0, 0.42, 0.33), gold, 1.2));
  parts.push(paint(new THREE.TorusGeometry(0.05, 0.016, 6, 10).translate(0, 0.3, 0.37), gold, 1.2));
  // rim trim where lid meets body
  parts.push(paint(new RoundedBoxGeometry(0.96, 0.05, 0.66, 2, 0.02).translate(0, 0.46, 0), gold, 0.9));
  for (const p of parts) if (p.getAttribute('uv')) p.deleteAttribute('uv');
  return mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)))!;
}

/** Beacon: tall floating cut crystal with a gold collar. Lit + emissive (MeshStandard flat-shaded). */
export function beaconGeometry(): THREE.BufferGeometry {
  const crystal = new THREE.OctahedronGeometry(0.3, 0).scale(0.75, 1.7, 0.75);
  const collar = new THREE.TorusGeometry(0.24, 0.035, 6, 18).rotateX(Math.PI / 2).translate(0, -0.05, 0);
  const tip = new THREE.OctahedronGeometry(0.08, 0).scale(1, 1.6, 1).translate(0, 0.72, 0);
  const parts = [paint(crystal, 0xbfefff, 1.0), paint(collar, 0xffd27a, 1.0), paint(tip, 0xffffff, 1.0)];
  for (const p of parts) if (p.getAttribute('uv')) p.deleteAttribute('uv');
  return mergeGeometries(parts)!;
}
