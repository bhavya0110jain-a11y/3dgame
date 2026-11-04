import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { EnemyShape } from '../data/enemies';
import { getModel } from '../render/Assets';

const ni = (g: THREE.BufferGeometry) => (g.index ? g.toNonIndexed() : g);
const merge = (gs: THREE.BufferGeometry[]) => mergeGeometries(gs.map(ni));

function eyes(y: number, z: number, spread: number, size: number): THREE.BufferGeometry {
  return merge([
    new THREE.SphereGeometry(size, 6, 4).translate(-spread, y, z),
    new THREE.SphereGeometry(size, 6, 4).translate(spread, y, z),
  ]);
}

/** Returns body + eye geometry for a shape. Models face +Z, sit on y=0, unit scale ~1 unit tall. */
export function buildEnemyModel(shape: EnemyShape): { body: THREE.BufferGeometry; eyes: THREE.BufferGeometry; vertexColors: boolean } {
  const m = getModel(shape);
  if (m && m.body) {
    return { body: m.body, eyes: m.glow ?? new THREE.BufferGeometry(), vertexColors: true };
  }
  return { ...buildProcedural(shape), vertexColors: false };
}

function buildProcedural(shape: EnemyShape): { body: THREE.BufferGeometry; eyes: THREE.BufferGeometry } {
  switch (shape) {
    case 'shade':
      return {
        body: merge([
          new THREE.ConeGeometry(0.5, 1.3, 7, 1, true).translate(0, 0.65, 0),
          new THREE.SphereGeometry(0.34, 7, 5).translate(0, 1.25, 0),
          new THREE.ConeGeometry(0.12, 0.6, 4).rotateZ(1.1).translate(-0.5, 0.8, 0.1),
          new THREE.ConeGeometry(0.12, 0.6, 4).rotateZ(-1.1).translate(0.5, 0.8, 0.1),
        ]),
        eyes: eyes(1.28, 0.28, 0.11, 0.06),
      };
    case 'crawler': {
      const legs: THREE.BufferGeometry[] = [];
      for (let i = 0; i < 3; i++) {
        const z = -0.25 + i * 0.25;
        legs.push(new THREE.BoxGeometry(1.2, 0.06, 0.06).rotateZ(0.0).translate(0, 0.25, z));
        legs.push(new THREE.BoxGeometry(0.06, 0.3, 0.06).translate(-0.6, 0.12, z));
        legs.push(new THREE.BoxGeometry(0.06, 0.3, 0.06).translate(0.6, 0.12, z));
      }
      return {
        body: merge([
          new THREE.SphereGeometry(0.42, 7, 5).scale(1, 0.55, 1.2).translate(0, 0.35, -0.05),
          new THREE.SphereGeometry(0.24, 6, 4).translate(0, 0.38, 0.45),
          ...legs,
        ]),
        eyes: merge([eyes(0.45, 0.66, 0.08, 0.045), eyes(0.38, 0.68, 0.14, 0.035)]),
      };
    }
    case 'wisp':
      return {
        body: merge([
          new THREE.IcosahedronGeometry(0.32, 0).translate(0, 0.9, 0),
          new THREE.ConeGeometry(0.22, 0.7, 5).rotateX(Math.PI).translate(0, 0.45, -0.1),
        ]),
        eyes: eyes(0.95, 0.26, 0.09, 0.055),
      };
    case 'brute':
      return {
        body: merge([
          new THREE.BoxGeometry(0.9, 0.9, 0.7).translate(0, 0.85, 0),
          new THREE.BoxGeometry(0.5, 0.45, 0.45).translate(0, 1.45, 0.15),
          new THREE.BoxGeometry(0.28, 0.85, 0.28).translate(-0.62, 0.65, 0.1),
          new THREE.BoxGeometry(0.28, 0.85, 0.28).translate(0.62, 0.65, 0.1),
          new THREE.BoxGeometry(0.25, 0.45, 0.25).translate(-0.22, 0.22, 0),
          new THREE.BoxGeometry(0.25, 0.45, 0.25).translate(0.22, 0.22, 0),
          new THREE.ConeGeometry(0.08, 0.3, 4).translate(-0.2, 1.75, 0.15),
          new THREE.ConeGeometry(0.08, 0.3, 4).translate(0.2, 1.75, 0.15),
        ]),
        eyes: eyes(1.5, 0.38, 0.12, 0.06),
      };
    case 'stalker':
      return {
        body: merge([
          new THREE.ConeGeometry(0.35, 1.6, 5).translate(0, 0.8, 0),
          new THREE.ConeGeometry(0.22, 0.6, 4).rotateX(-Math.PI / 2).translate(0, 1.45, 0.3),
          new THREE.BoxGeometry(0.06, 0.9, 0.06).rotateZ(0.6).translate(-0.4, 0.9, 0.2),
          new THREE.BoxGeometry(0.06, 0.9, 0.06).rotateZ(-0.6).translate(0.4, 0.9, 0.2),
        ]),
        eyes: eyes(1.48, 0.45, 0.08, 0.05),
      };
    case 'spitter':
      return {
        body: merge([
          new THREE.SphereGeometry(0.5, 8, 6).scale(1, 0.85, 1).translate(0, 0.55, 0),
          new THREE.CylinderGeometry(0.12, 0.2, 0.4, 6).rotateX(Math.PI / 2).translate(0, 0.7, 0.5),
          new THREE.SphereGeometry(0.15, 5, 4).translate(-0.35, 0.95, -0.1),
          new THREE.SphereGeometry(0.12, 5, 4).translate(0.3, 1.0, -0.2),
        ]),
        eyes: merge([eyes(0.92, 0.36, 0.14, 0.05), eyes(1.02, 0.3, 0.05, 0.04)]),
      };
    case 'bog':
      return {
        body: merge([
          new THREE.SphereGeometry(0.6, 8, 6).scale(1.1, 0.7, 1.2).translate(0, 0.42, 0),
          new THREE.ConeGeometry(0.1, 0.5, 4).translate(-0.3, 0.9, -0.1),
          new THREE.ConeGeometry(0.1, 0.6, 4).translate(0.2, 0.95, -0.25),
          new THREE.ConeGeometry(0.08, 0.4, 4).translate(0.35, 0.8, 0.1),
        ]),
        eyes: merge([eyes(0.62, 0.6, 0.22, 0.06), eyes(0.7, 0.55, 0.08, 0.045)]),
      };
    case 'knight':
      return {
        body: merge([
          new THREE.CylinderGeometry(0.35, 0.45, 1.1, 6).translate(0, 0.75, 0),
          new THREE.BoxGeometry(1.0, 0.25, 0.45).translate(0, 1.25, 0),
          new THREE.CylinderGeometry(0.22, 0.26, 0.45, 6).translate(0, 1.6, 0),
          new THREE.ConeGeometry(0.06, 0.45, 4).translate(0, 2.0, 0),
          new THREE.BoxGeometry(0.08, 1.6, 0.12).translate(0.6, 0.9, 0.3),
          new THREE.BoxGeometry(0.5, 0.7, 0.08).translate(-0.6, 0.85, 0.2),
        ]),
        eyes: merge([new THREE.BoxGeometry(0.28, 0.04, 0.05).translate(0, 1.63, 0.24)]),
      };
    case 'stag': {
      const antler = (s: number) =>
        merge([
          new THREE.CylinderGeometry(0.04, 0.06, 0.8, 4).rotateZ(s * 0.5).translate(s * 0.25, 1.95, 0.35),
          new THREE.CylinderGeometry(0.03, 0.04, 0.5, 4).rotateZ(s * -0.3).translate(s * 0.48, 2.3, 0.35),
          new THREE.CylinderGeometry(0.03, 0.04, 0.45, 4).rotateZ(s * 1.1).translate(s * 0.62, 2.15, 0.35),
          new THREE.CylinderGeometry(0.025, 0.035, 0.35, 4).rotateX(0.6).translate(s * 0.4, 2.2, 0.5),
        ]);
      return {
        body: merge([
          new THREE.BoxGeometry(0.6, 0.55, 1.3).translate(0, 1.0, -0.1),
          new THREE.BoxGeometry(0.32, 0.5, 0.32).rotateX(-0.5).translate(0, 1.4, 0.55),
          new THREE.BoxGeometry(0.28, 0.25, 0.5).translate(0, 1.65, 0.75),
          new THREE.BoxGeometry(0.1, 0.75, 0.1).translate(-0.22, 0.38, 0.4),
          new THREE.BoxGeometry(0.1, 0.75, 0.1).translate(0.22, 0.38, 0.4),
          new THREE.BoxGeometry(0.1, 0.75, 0.1).translate(-0.22, 0.38, -0.6),
          new THREE.BoxGeometry(0.1, 0.75, 0.1).translate(0.22, 0.38, -0.6),
          antler(1),
          antler(-1),
        ]),
        eyes: eyes(1.7, 0.95, 0.1, 0.05),
      };
    }
    case 'mire':
      return {
        body: merge([
          new THREE.SphereGeometry(0.7, 9, 7).scale(1.2, 0.8, 1.2).translate(0, 0.6, 0),
          new THREE.SphereGeometry(0.4, 8, 6).translate(0, 1.25, 0.25),
          new THREE.TorusGeometry(0.5, 0.08, 4, 10).rotateX(Math.PI / 2).translate(0, 0.9, 0),
          new THREE.ConeGeometry(0.08, 0.6, 4).rotateZ(0.7).translate(-0.6, 1.2, 0),
          new THREE.ConeGeometry(0.08, 0.6, 4).rotateZ(-0.7).translate(0.6, 1.2, 0),
        ]),
        eyes: merge([eyes(1.3, 0.6, 0.14, 0.06), eyes(1.42, 0.55, 0.05, 0.05), eyes(1.15, 0.62, 0.24, 0.04)]),
      };
    case 'king':
    default:
      return {
        body: merge([
          new THREE.ConeGeometry(0.6, 1.8, 8).translate(0, 0.9, 0),
          new THREE.SphereGeometry(0.3, 7, 6).translate(0, 1.95, 0),
          new THREE.CylinderGeometry(0.3, 0.26, 0.2, 8, 1, true).translate(0, 2.25, 0),
          new THREE.ConeGeometry(0.05, 0.25, 4).translate(0.2, 2.45, 0),
          new THREE.ConeGeometry(0.05, 0.25, 4).translate(-0.2, 2.45, 0),
          new THREE.ConeGeometry(0.05, 0.3, 4).translate(0, 2.47, 0.2),
          new THREE.BoxGeometry(1.6, 0.12, 0.35).translate(0, 1.6, 0),
          new THREE.BoxGeometry(0.08, 2.2, 0.08).translate(0.75, 1.1, 0.25),
        ]),
        eyes: eyes(1.98, 0.27, 0.09, 0.05),
      };
  }
}
