import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { BiomeDef } from '../data/biomes';

const CHUNK = 24;
const VIEW_CHUNKS = 2; // radius in chunks around player

function hash2(x: number, z: number, s: number): number {
  let h = (x * 374761393 + z * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function propGeometry(kind: string): THREE.BufferGeometry {
  switch (kind) {
    case 'pine': {
      const trunk = new THREE.CylinderGeometry(0.15, 0.22, 1.2, 6).translate(0, 0.6, 0);
      const c1 = new THREE.ConeGeometry(1.3, 2.2, 7).translate(0, 2.0, 0);
      const c2 = new THREE.ConeGeometry(1.0, 1.8, 7).translate(0, 3.0, 0);
      const c3 = new THREE.ConeGeometry(0.65, 1.4, 7).translate(0, 3.9, 0);
      return mergeGeometries([trunk, c1, c2, c3].map((g) => g.toNonIndexed()));
    }
    case 'deadtree': {
      const t = new THREE.CylinderGeometry(0.1, 0.25, 3, 5).translate(0, 1.5, 0);
      const b1 = new THREE.CylinderGeometry(0.05, 0.1, 1.4, 4).rotateZ(0.9).translate(0.5, 2.3, 0);
      const b2 = new THREE.CylinderGeometry(0.05, 0.09, 1.1, 4).rotateZ(-1.0).translate(-0.4, 1.8, 0.1);
      const b3 = new THREE.CylinderGeometry(0.04, 0.08, 0.9, 4).rotateX(0.8).translate(0, 2.6, 0.3);
      return mergeGeometries([t, b1, b2, b3].map((g) => g.toNonIndexed()));
    }
    case 'rock':
      return new THREE.DodecahedronGeometry(0.7, 0).scale(1, 0.6, 0.9).translate(0, 0.25, 0);
    case 'grave': {
      const s = new THREE.BoxGeometry(0.7, 1.0, 0.18).translate(0, 0.5, 0);
      const top = new THREE.CylinderGeometry(0.35, 0.35, 0.18, 10, 1, false, 0, Math.PI).rotateX(Math.PI / 2).rotateZ(Math.PI / 2).rotateY(Math.PI/2).translate(0, 1.0, 0);
      return mergeGeometries([s.toNonIndexed(), top.toNonIndexed()]);
    }
    case 'pillar': {
      const base = new THREE.BoxGeometry(1, 0.3, 1).translate(0, 0.15, 0);
      const col = new THREE.CylinderGeometry(0.35, 0.4, 2.6, 8).translate(0, 1.6, 0);
      return mergeGeometries([base.toNonIndexed(), col.toNonIndexed()]);
    }
    case 'mushroom': {
      const st = new THREE.CylinderGeometry(0.06, 0.08, 0.4, 5).translate(0, 0.2, 0);
      const cap = new THREE.SphereGeometry(0.25, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.38, 0);
      return mergeGeometries([st.toNonIndexed(), cap.toNonIndexed()]);
    }
    case 'reed':
    default: {
      const parts: THREE.BufferGeometry[] = [];
      for (let i = 0; i < 5; i++) {
        const h = 0.8 + (i % 3) * 0.35;
        parts.push(new THREE.ConeGeometry(0.04, h, 3).translate(Math.cos(i * 1.3) * 0.2, h / 2, Math.sin(i * 1.3) * 0.2).toNonIndexed());
      }
      return mergeGeometries(parts);
    }
  }
}

/** Endless ground + procedurally scattered props, regenerated as the player crosses chunks. */
export class World {
  readonly group = new THREE.Group();
  private ground: THREE.Mesh;
  private groundMat: THREE.ShaderMaterial;
  private propMeshes: { kind: string; mesh: THREE.InstancedMesh }[] = [];
  private lastChunk = { x: 9999, z: 9999 };
  private hemi: THREE.HemisphereLight;
  biome!: BiomeDef;
  private seed = 1;
  /** Collision circles for solid props (x, z, r). */
  readonly colliders: { x: number; z: number; r: number }[] = [];

  constructor(private scene: THREE.Scene) {
    scene.add(this.group);
    this.groundMat = new THREE.ShaderMaterial({
      uniforms: {
        uA: { value: new THREE.Color() },
        uB: { value: new THREE.Color() },
        uPlayer: { value: new THREE.Vector3() },
        uLight: { value: 10 },
        uLightColor: { value: new THREE.Color(0xffb35c) },
        uFog: { value: new THREE.Color() },
        uTime: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vWorld = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uA; uniform vec3 uB; uniform vec3 uPlayer; uniform float uLight; uniform vec3 uLightColor; uniform vec3 uFog; uniform float uTime;
        varying vec3 vWorld;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
        float noise(vec2 p){ vec2 i=floor(p); vec2 f=fract(p); f=f*f*(3.0-2.0*f);
          return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
        float fbm(vec2 p){ float v=0.0; float a=0.5; for(int i=0;i<4;i++){ v+=a*noise(p); p*=2.03; a*=0.5;} return v; }
        void main() {
          vec2 p = vWorld.xz;
          float n = fbm(p * 0.12);
          float n2 = noise(p * 1.7);
          vec3 base = mix(uA, uB, smoothstep(0.3, 0.7, n));
          base *= 0.85 + 0.3 * n2;
          // speckles (grass tufts / pebbles)
          float sp = step(0.93, hash(floor(p * 3.0)));
          base += sp * 0.03;
          float d = length(p - uPlayer.xz);
          float lit = clamp(1.0 - d / uLight, 0.0, 1.0);
          lit = lit * lit * (3.0 - 2.0 * lit);
          float flicker = 0.96 + 0.04 * sin(uTime * 13.0) * sin(uTime * 7.3);
          vec3 col = base * 0.22 + base * uLightColor * lit * 3.2 * flicker;
          // warm rim at light edge
          float rim = smoothstep(uLight * 0.75, uLight, d) * smoothstep(uLight * 1.15, uLight, d);
          col += uLightColor * rim * 0.05;
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), this.groundMat);
    this.ground.rotation.x = -Math.PI / 2;
    this.group.add(this.ground);
    this.hemi = new THREE.HemisphereLight(0x5a6b8c, 0x080808, 0.35);
    scene.add(this.hemi);
  }

  setBiome(biome: BiomeDef, seed: number): void {
    this.biome = biome;
    this.seed = seed;
    (this.groundMat.uniforms.uA.value as THREE.Color).setHex(biome.groundA);
    (this.groundMat.uniforms.uB.value as THREE.Color).setHex(biome.groundB);
    (this.groundMat.uniforms.uFog.value as THREE.Color).setHex(biome.fog);
    this.hemi.color.setHex(biome.moon);
    this.hemi.intensity = biome.moonIntensity;
    const fog = this.scene.fog as THREE.FogExp2;
    fog.color.setHex(biome.fog);
    fog.density = biome.fogDensity;
    (this.scene.background as THREE.Color).setHex(biome.fog);

    for (const p of this.propMeshes) {
      this.group.remove(p.mesh);
      p.mesh.geometry.dispose();
      (p.mesh.material as THREE.Material).dispose();
    }
    this.propMeshes = [];
    const maxPerType = (VIEW_CHUNKS * 2 + 1) ** 2 * biome.propDensity;
    for (const prop of biome.props) {
      const mat = new THREE.MeshStandardMaterial({ color: prop.color, roughness: 0.9, metalness: 0, flatShading: true });
      if (prop.kind === 'mushroom') {
        mat.emissive = new THREE.Color(prop.color);
        mat.emissiveIntensity = 0.6;
      }
      const mesh = new THREE.InstancedMesh(propGeometry(prop.kind), mat, maxPerType);
      mesh.count = 0;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.propMeshes.push({ kind: prop.kind, mesh });
    }
    this.lastChunk = { x: 9999, z: 9999 };
  }

  setLight(px: number, pz: number, radius: number, time: number): void {
    (this.groundMat.uniforms.uPlayer.value as THREE.Vector3).set(px, 0, pz);
    this.groundMat.uniforms.uLight.value = radius;
    this.groundMat.uniforms.uTime.value = time;
  }

  update(px: number, pz: number): void {
    this.ground.position.set(Math.round(px / 50) * 50, 0, Math.round(pz / 50) * 50);
    const cx = Math.floor(px / CHUNK);
    const cz = Math.floor(pz / CHUNK);
    if (cx === this.lastChunk.x && cz === this.lastChunk.z) return;
    this.lastChunk = { x: cx, z: cz };
    this.rebuildProps(cx, cz);
  }

  private rebuildProps(cx: number, cz: number): void {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const pos = new THREE.Vector3();
    const counts = this.propMeshes.map(() => 0);
    const totalW = this.biome.props.reduce((a, p) => a + p.weight, 0);
    this.colliders.length = 0;
    for (let dx = -VIEW_CHUNKS; dx <= VIEW_CHUNKS; dx++) {
      for (let dz = -VIEW_CHUNKS; dz <= VIEW_CHUNKS; dz++) {
        const kx = cx + dx;
        const kz = cz + dz;
        for (let i = 0; i < this.biome.propDensity; i++) {
          const r1 = hash2(kx, kz, this.seed + i * 7);
          const r2 = hash2(kx, kz, this.seed + i * 7 + 1);
          const r3 = hash2(kx, kz, this.seed + i * 7 + 2);
          const r4 = hash2(kx, kz, this.seed + i * 7 + 3);
          const x = (kx + r1) * CHUNK;
          const z = (kz + r2) * CHUNK;
          // keep spawn area clear
          if (Math.hypot(x, z) < 6) continue;
          let w = r3 * totalW;
          let idx = 0;
          for (; idx < this.biome.props.length - 1; idx++) {
            w -= this.biome.props[idx].weight;
            if (w <= 0) break;
          }
          const pm = this.propMeshes[idx];
          if (counts[idx] >= pm.mesh.instanceMatrix.count) continue;
          const sc = 0.7 + r4 * 0.8;
          pos.set(x, 0, z);
          q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r4 * Math.PI * 2);
          s.set(sc, sc * (0.85 + r1 * 0.3), sc);
          m.compose(pos, q, s);
          pm.mesh.setMatrixAt(counts[idx]++, m);
          const kind = this.biome.props[idx].kind;
          if (kind === 'pine' || kind === 'rock' || kind === 'pillar' || kind === 'deadtree' || kind === 'grave') {
            const r = kind === 'pine' ? 0.45 : kind === 'rock' ? 0.6 : kind === 'pillar' ? 0.5 : 0.3;
            this.colliders.push({ x, z, r: r * sc });
          }
        }
      }
    }
    this.propMeshes.forEach((pm, i) => {
      pm.mesh.count = counts[i];
      pm.mesh.instanceMatrix.needsUpdate = true;
    });
  }

  /** Pushes a circle out of solid props. Returns adjusted position in-place. */
  resolveCollision(p: { x: number; z: number }, radius: number): void {
    for (const c of this.colliders) {
      const dx = p.x - c.x;
      const dz = p.z - c.z;
      const min = radius + c.r;
      const d2 = dx * dx + dz * dz;
      if (d2 < min * min && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        p.x = c.x + (dx / d) * min;
        p.z = c.z + (dz / d) * min;
      }
    }
  }
}
