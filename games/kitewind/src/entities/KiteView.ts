import * as THREE from 'three';
import type { KiteDef } from '../data/kites';
import { patchRim } from '../render/materials';
import type { Models } from '../render/Models';

/** Sail outline per shape in the XZ plane (nose +Z, right wing -X), unit-ish size. */
const OUTLINES: Record<KiteDef['shape'], [number, number][]> = {
  diamond: [[0, 1], [-0.85, 0.15], [-0.25, -0.55], [0, -0.75], [0.25, -0.55], [0.85, 0.15]],
  fish: [[0, 1], [-0.55, 0.45], [-0.7, -0.1], [-0.3, -0.6], [-0.55, -0.95], [0, -0.7], [0.55, -0.95], [0.3, -0.6], [0.7, -0.1], [0.55, 0.45]],
  moth: [[0, 0.75], [-0.4, 0.75], [-1.05, 0.55], [-0.95, 0], [-0.55, -0.35], [-0.6, -0.75], [0, -0.45], [0.6, -0.75], [0.55, -0.35], [0.95, 0], [1.05, 0.55], [0.4, 0.75]],
  dragon: [[0, 1.05], [-0.35, 0.55], [-1.0, 0.3], [-0.45, -0.05], [-0.18, -0.85], [0, -0.6], [0.18, -0.85], [0.45, -0.05], [1.0, 0.3], [0.35, 0.55]],
  crane: [[0, 0.95], [-0.25, 0.35], [-1.25, 0.25], [-1.0, -0.05], [-0.3, -0.25], [-0.15, -0.8], [0, -0.6], [0.15, -0.8], [0.3, -0.25], [1.0, -0.05], [1.25, 0.25], [0.25, 0.35]],
};

function sailTexture(k: KiteDef): THREE.CanvasTexture {
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d')!;
  const hex = (n: number): string => '#' + n.toString(16).padStart(6, '0');
  const [main, accent, trim] = k.colors.map(hex);
  g.fillStyle = main;
  g.fillRect(0, 0, S, S);
  g.lineCap = 'round';
  // uv: u = (x+1.3)/2.6, v = (z+1)/2.1 ; nose at the top of the texture
  switch (k.pattern) {
    case 'stripes':
      g.fillStyle = accent;
      for (let i = -2; i < 6; i++) {
        g.beginPath();
        g.moveTo(S / 2, S * 0.1);
        g.lineTo(i * 50, S);
        g.lineTo(i * 50 + 22, S);
        g.closePath();
        g.fill();
      }
      g.fillStyle = trim;
      g.beginPath();
      g.arc(S / 2, S * 0.5, S * 0.09, 0, Math.PI * 2);
      g.fill();
      break;
    case 'scales':
      for (let y = 0; y < 8; y++)
        for (let x = 0; x < 9; x++) {
          g.fillStyle = (x + y) % 3 === 0 ? trim : accent;
          g.beginPath();
          g.arc(x * 32 + (y % 2) * 16, y * 34 + 20, 15, 0, Math.PI);
          g.fill();
        }
      g.fillStyle = main;
      g.fillRect(S * 0.42, 0, S * 0.16, S * 0.35);
      break;
    case 'eyes':
      g.fillStyle = accent;
      g.fillRect(0, S * 0.55, S, S * 0.45);
      for (const sx of [0.22, 0.78]) {
        g.fillStyle = trim;
        g.beginPath();
        g.arc(S * sx, S * 0.45, S * 0.12, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#ffe9a8';
        g.beginPath();
        g.arc(S * sx, S * 0.45, S * 0.06, 0, Math.PI * 2);
        g.fill();
      }
      break;
    case 'flame':
      g.fillStyle = accent;
      for (let i = 0; i < 7; i++) {
        g.beginPath();
        const x = i * 40 + 10;
        g.moveTo(x, S);
        g.quadraticCurveTo(x - 20, S * 0.5, x + 15, S * 0.25);
        g.quadraticCurveTo(x + 5, S * 0.6, x + 35, S);
        g.fill();
      }
      g.fillStyle = trim;
      g.fillRect(S * 0.46, 0, S * 0.08, S);
      break;
    case 'feather':
      g.strokeStyle = accent;
      g.lineWidth = 7;
      for (let i = 0; i < 12; i++) {
        g.beginPath();
        g.moveTo(S / 2, S * 0.45);
        g.lineTo(i < 6 ? -10 + i * 8 : S + 10 - (i - 6) * 8, S * 0.25 + (i % 6) * 22);
        g.stroke();
      }
      g.fillStyle = trim;
      g.beginPath();
      g.arc(S / 2, S * 0.15, S * 0.07, 0, Math.PI * 2);
      g.fill();
      break;
  }
  // border
  g.strokeStyle = trim;
  g.lineWidth = 10;
  g.strokeRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function buildSail(k: KiteDef): THREE.Group {
  const g = new THREE.Group();
  const o = OUTLINES[k.shape];
  const pos: number[] = [];
  const uv: number[] = [];
  const dihedral = 0.22;
  const pushV = (x: number, z: number, y: number): void => {
    pos.push(x, y, z);
    uv.push((x + 1.3) / 2.6, (z + 1) / 2.1);
  };
  for (let i = 0; i < o.length; i++) {
    const [x1, z1] = o[i];
    const [x2, z2] = o[(i + 1) % o.length];
    pushV(0, 0, 0.06);
    pushV(x1, z1, Math.abs(x1) * dihedral);
    pushV(x2, z2, Math.abs(x2) * dihedral);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ map: sailTexture(k), side: THREE.DoubleSide, roughness: 0.6, emissive: 0xffffff, emissiveIntensity: 0.14 });
  mat.emissiveMap = mat.map;
  patchRim(mat, 1.6);
  const sail = new THREE.Mesh(geo, mat);
  g.add(sail);
  // bamboo spars
  const spar = new THREE.MeshStandardMaterial({ color: 0x3a2a20, roughness: 0.7 });
  const xs = o.reduce((m, p) => Math.max(m, Math.abs(p[0])), 0);
  const zs = o.reduce((m, p) => Math.max(m, p[1]), 0);
  const zmin = o.reduce((m, p) => Math.min(m, p[1]), 0);
  const s1 = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, zs - zmin, 5), spar);
  s1.rotation.x = Math.PI / 2;
  s1.position.set(0, 0.07, (zs + zmin) / 2);
  g.add(s1);
  const s2 = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, xs * 2, 5), spar);
  s2.rotation.z = Math.PI / 2;
  s2.position.set(0, 0.06 + xs * dihedral * 0.5, 0.18);
  g.add(s2);
  return g;
}

const TAIL_N = 30;

/**
 * A camera-facing ribbon that trails an anchor as a follow-the-leader chain of fixed-length segments, so its
 * length is frame-rate independent (fast-forwarded sims, slow-mo). Updated in place every frame (no allocations).
 */
export class Ribbon {
  readonly mesh: THREE.Mesh;
  private pts: Float32Array;
  private pos: Float32Array;
  private col: Float32Array;
  private side = new THREE.Vector3();
  private d = new THREE.Vector3();
  private toCam = new THREE.Vector3();
  private cA = new THREE.Color();
  private cB = new THREE.Color();

  constructor(parent: THREE.Object3D, readonly n: number, public width: number, colA: number, colB: number, additive = false, public alpha = 1, public seg = 0.14, public droop = 0.0) {
    this.pts = new Float32Array(n * 3);
    this.pos = new Float32Array(n * 2 * 3);
    this.col = new Float32Array(n * 2 * 4);
    const idx: number[] = [];
    for (let i = 0; i < n - 1; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setIndex(idx);
    this.mesh = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, side: THREE.DoubleSide, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending }),
    );
    this.mesh.frustumCulled = false;
    parent.add(this.mesh);
    this.setColors(colA, colB);
  }

  setColors(a: number, b: number): void {
    this.cA.setHex(a);
    this.cB.setHex(b);
  }

  reset(x: number, y: number, z: number): void {
    for (let i = 0; i < this.n; i++) {
      this.pts[i * 3] = x;
      this.pts[i * 3 + 1] = y;
      this.pts[i * 3 + 2] = z - i * this.seg;
    }
  }

  /** Moves the head to the anchor, drags the chain and rebuilds the strip. `flutter` = time for the wave. */
  update(x: number, y: number, z: number, camera: THREE.Camera, flutter: number, alphaMul = 1): void {
    const p = this.pts;
    p[0] = x;
    p[1] = y;
    p[2] = z;
    for (let i = 1; i < this.n; i++) {
      const o = i * 3;
      p[o + 1] -= this.droop;
      const dx = p[o] - p[o - 3], dy = p[o + 1] - p[o - 2], dz = p[o + 2] - p[o - 1];
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (len > this.seg) {
        const k = this.seg / len;
        p[o] = p[o - 3] + dx * k;
        p[o + 1] = p[o - 2] + dy * k;
        p[o + 2] = p[o - 1] + dz * k;
      }
    }
    for (let i = 0; i < this.n; i++) {
      const j = i * 3;
      const k = i < this.n - 1 ? j + 3 : j - 3;
      const px = p[j], py = p[j + 1], pz = p[j + 2];
      this.d.set(p[k] - px, p[k + 1] - py, p[k + 2] - pz);
      if (i === this.n - 1) this.d.negate();
      if (this.d.lengthSq() < 1e-10) this.d.set(0, 0, -1);
      this.d.normalize();
      this.toCam.set(camera.position.x - px, camera.position.y - py, camera.position.z - pz).normalize();
      this.side.crossVectors(this.d, this.toCam).normalize();
      const t = i / (this.n - 1);
      const w = this.width * (1 - t * 0.75);
      const wave = Math.sin(flutter * 9 - i * 0.45) * 0.12 * t;
      const o = i * 6;
      this.pos[o] = px + this.side.x * (w + wave);
      this.pos[o + 1] = py + this.side.y * w + wave;
      this.pos[o + 2] = pz + this.side.z * (w + wave);
      this.pos[o + 3] = px - this.side.x * (w - wave);
      this.pos[o + 4] = py - this.side.y * w + wave;
      this.pos[o + 5] = pz - this.side.z * (w - wave);
      const r = this.cA.r + (this.cB.r - this.cA.r) * t;
      const g = this.cA.g + (this.cB.g - this.cA.g) * t;
      const b = this.cA.b + (this.cB.b - this.cA.b) * t;
      const a = (1 - t * t) * this.alpha * alphaMul;
      for (let s = 0; s < 2; s++) {
        const c = i * 8 + s * 4;
        this.col[c] = r;
        this.col[c + 1] = g;
        this.col[c + 2] = b;
        this.col[c + 3] = a;
      }
    }
    const geo = this.mesh.geometry;
    (geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (geo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  }
}

/**
 * The kite: sail + spars (or a `kite_<id>` GLB), ribbon tail, wingtip vortex trails and a spirit glow.
 * Orientation from the flight model: yaw (right = -X), pitch (nose up +), bank (right wing down +).
 */
export class KiteView {
  readonly root = new THREE.Group();
  private body = new THREE.Group();
  private tail: Ribbon;
  private tipL: Ribbon;
  private tipR: Ribbon;
  private glow: THREE.Sprite;
  private shield: THREE.Mesh;
  private tmp = new THREE.Vector3();
  private kiteId = '';
  readonly scale = 1.3;

  constructor(private scene: THREE.Scene, private models: Models) {
    this.root.add(this.body);
    scene.add(this.root);
    this.tail = new Ribbon(scene, TAIL_N, 0.13, 0xff5040, 0xffd36e, false, 1, 0.13, 0.002);
    this.tipL = new Ribbon(scene, 20, 0.025, 0xffffff, 0xbfe8ff, true, 0.4, 0.3);
    this.tipR = new Ribbon(scene, 20, 0.025, 0xffffff, 0xbfe8ff, true, 0.4, 0.3);
    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const g = cv.getContext('2d')!;
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.25, 'rgba(255,230,180,0.5)');
    grd.addColorStop(1, 'rgba(255,200,150,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(cv);
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: new THREE.Color(1.6, 1.3, 1.0), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.glow.scale.setScalar(1.6);
    this.root.add(this.glow);
    this.shield = new THREE.Mesh(
      new THREE.SphereGeometry(1.7, 24, 16),
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        uniforms: { opacity: { value: 0.2 }, uColor: { value: new THREE.Color(0.45, 1.0, 0.8) } },
        vertexShader: `varying float vF; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vec3 n = normalize(mat3(modelMatrix) * normal);
          vF = pow(1.0 - abs(dot(n, normalize(cameraPosition - w.xyz))), 2.5); gl_Position = projectionMatrix * viewMatrix * w; }`,
        fragmentShader: `uniform float opacity; uniform vec3 uColor; varying float vF; void main() { gl_FragColor = vec4(uColor * vF * opacity, vF * opacity); }`,
      }),
    );
    this.root.add(this.shield);
  }

  /** Swaps the kite model / colours. */
  setKite(k: KiteDef): void {
    if (k.id === this.kiteId) return;
    this.kiteId = k.id;
    this.body.clear();
    const parts = this.models.get(`kite_${k.id}`);
    if (parts) for (const p of parts) this.body.add(new THREE.Mesh(p.geometry, p.material));
    else this.body.add(buildSail(k));
    this.body.scale.setScalar(this.scale);
    this.tail.setColors(k.tail[0], k.tail[1]);
  }

  /** Places the kite and its trails. `speedK` 0..1 drives the vortex trails; `shields` shows the bubble. */
  update(x: number, y: number, z: number, yaw: number, pitch: number, bank: number, camera: THREE.Camera, time: number, speedK: number, shields: number, invuln: number): void {
    this.root.position.set(x, y, z);
    // subtle flutter on top of the flight attitude
    const fl = Math.sin(time * 7.3) * 0.025 + Math.sin(time * 11.1) * 0.015;
    // +0.16 rad visual angle of attack: the sail faces the chase camera a little (reads better than edge-on)
    this.body.rotation.set(-pitch - 0.16 + fl, -yaw, bank + fl * 0.6, 'YXZ');
    this.root.updateMatrixWorld();
    // tail anchor: behind the sail
    this.tmp.set(0, 0.05, -0.75).applyMatrix4(this.body.matrixWorld);
    this.tail.update(this.tmp.x, this.tmp.y, this.tmp.z, camera, time);
    this.tmp.set(1.0, 0.2, 0.1).applyMatrix4(this.body.matrixWorld);
    this.tipL.update(this.tmp.x, this.tmp.y, this.tmp.z, camera, 0, speedK);
    this.tmp.set(-1.0, 0.2, 0.1).applyMatrix4(this.body.matrixWorld);
    this.tipR.update(this.tmp.x, this.tmp.y, this.tmp.z, camera, 0, speedK);
    this.glow.material.opacity = 0.55 + 0.15 * Math.sin(time * 3);
    this.shield.visible = shields > 0 || invuln > 0;
    this.shield.rotation.y = time * 0.6;
    const sm = this.shield.material as THREE.ShaderMaterial;
    sm.uniforms.opacity.value = invuln > 0 ? 0.9 * (0.5 + 0.5 * Math.sin(time * 30)) : 0.35;
    this.body.visible = !(invuln > 0 && Math.sin(time * 40) > 0.6);
  }

  /** Resets trails to the given point (new run / teleport). */
  resetTrails(x: number, y: number, z: number): void {
    this.tail.reset(x, y, z);
    this.tipL.reset(x, y, z);
    this.tipR.reset(x, y, z);
  }

  set visible(v: boolean) {
    this.root.visible = v;
    this.tail.mesh.visible = v;
    this.tipL.mesh.visible = v;
    this.tipR.mesh.visible = v;
  }
}
