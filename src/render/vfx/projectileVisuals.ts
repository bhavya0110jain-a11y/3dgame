import * as THREE from 'three';

/**
 * Projectile looks — one instanced billboard draw call for every projectile body/glow plus one instanced crystal
 * mesh for ice shards. Styles (iSty.x):
 *   0 COMET   white-hot head + tapered tail stretched along screen-space velocity (ember bolt, generic)
 *   1 BEAM    long, thin, uniform hot beam with a blinding core (wick lance)
 *   2 VOID    hostile: dark occluding core, toxic rim, rotating thorn crown, short smoky tail — never confused
 *             with the player's warm fire
 *   3 MARKER  hostile ground marker: flat soft ring under the orb, so its ground position always reads
 *   4 FROST   pale icy glow halo behind a crystal shard
 */
export const PS_COMET = 0;
export const PS_BEAM = 1;
export const PS_VOID = 2;
export const PS_MARKER = 3;
export const PS_FROST = 4;

export function createProjectileBillboards(capacity: number): {
  mesh: THREE.Mesh;
  geo: THREE.InstancedBufferGeometry;
  aPos: THREE.InstancedBufferAttribute;
  aDir: THREE.InstancedBufferAttribute;
  aCol: THREE.InstancedBufferAttribute;
  aSty: THREE.InstancedBufferAttribute;
  uniforms: { uTime: { value: number } };
} {
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  const mk = () => new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
  const aPos = mk(); // xyz, radius (head size)
  const aDir = mk(); // velocity xyz, tail length (world)
  const aCol = mk(); // linear rgb * intensity, alpha
  const aSty = mk(); // style, seed, 0, 0
  geo.setAttribute('iPos', aPos);
  geo.setAttribute('iDir', aDir);
  geo.setAttribute('iCol', aCol);
  geo.setAttribute('iSty', aSty);
  geo.instanceCount = 0;
  const uniforms = { uTime: { value: 0 } };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      attribute vec4 iPos;
      attribute vec4 iDir;
      attribute vec4 iCol;
      attribute vec4 iSty;
      varying vec2 vL;      // local coords in units of head radius: x along (head at 0, tail negative), y across
      varying float vTail;  // tail length in head radii
      varying vec4 vCol;
      varying vec2 vSty;
      void main() {
        vCol = iCol;
        vSty = iSty.xy;
        float r = iPos.w;
        float style = iSty.x;
        if (style > 2.5 && style < 3.5) {
          // flat ground marker
          vL = position.xy * 2.0;
          vTail = 0.0;
          vec3 p = vec3(iPos.x + position.x * r * 2.0, 0.07, iPos.z + position.y * r * 2.0);
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
          return;
        }
        vec4 mv = viewMatrix * vec4(iPos.xyz, 1.0);
        vec2 v2 = (viewMatrix * vec4(iDir.xyz, 0.0)).xy;
        float len = length(v2);
        vec2 dir = len > 1e-4 ? v2 / len : vec2(1.0, 0.0);
        vec2 perp = vec2(-dir.y, dir.x);
        // tail foreshortens with the screen-space speed fraction (vertical motion looks shorter)
        float speed3 = max(length(iDir.xyz), 1e-4);
        float tail = iDir.w * clamp(len / speed3, 0.25, 1.0);
        float front = r * 1.6;
        float back = r * 1.6 + tail;
        float halfW = r * 1.6;
        float along = mix(-back, front, position.x + 0.5);
        float across = position.y * 2.0 * halfW;
        vL = vec2(along, across) / r;
        vTail = tail / r;
        mv.xy += dir * along + perp * across;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec2 vL;
      varying float vTail;
      varying vec4 vCol;
      varying vec2 vSty;
      void main() {
        float style = vSty.x;
        vec2 L = vL;
        float r2 = dot(L, L);
        vec3 col = vCol.rgb;
        vec3 outc;
        float occl = 0.0;
        if (style < 0.5 || style > 3.5) {
          // COMET / FROST glow
          float head = exp(-r2 * 1.8);
          float core = exp(-r2 * 7.0);
          float tt = clamp(-L.x / max(vTail, 1e-3), 0.0, 1.0);
          float w = mix(0.75, 0.05, tt);
          float tail = (L.x < 0.0 ? 1.0 : 0.0) * exp(-(L.y * L.y) / (w * w) * 1.8) * pow(1.0 - tt, 1.6);
          float flick = 0.85 + 0.15 * sin(L.x * 3.0 + uTime * 40.0 + vSty.y * 10.0);
          float v = head * 1.1 + tail * 0.75 * flick;
          outc = col * v + vec3(1.0, 0.96, 0.85) * core * 2.4 * length(col) * 0.6;
          if (style > 3.5) outc *= 0.7;
        } else if (style < 1.5) {
          // BEAM: long, uniform, hot
          float tt = clamp(-L.x / max(vTail, 1e-3), 0.0, 1.0);
          float w = mix(0.55, 0.25, tt);
          float body = exp(-(L.y * L.y) / (w * w) * 2.0) * smoothstep(1.0, 0.75, tt) * step(L.x, 0.6);
          float core = exp(-(L.y * L.y) / (w * w) * 14.0) * smoothstep(1.0, 0.6, tt);
          float head = exp(-r2 * 2.2);
          float pulse = 0.85 + 0.15 * sin(L.x * 1.3 + uTime * 55.0);
          outc = col * (body * pulse + head * 1.2) + vec3(1.0) * (core + head * 0.8) * 1.6;
        } else if (style < 2.5) {
          // VOID orb (hostile)
          float d = sqrt(r2);
          float ang = atan(L.y, L.x) + uTime * 4.0 + vSty.y * 6.0;
          float thorns = pow(max(0.0, cos(ang * 6.0)), 6.0);
          float crownR = 1.15 + thorns * 0.55;
          float crown = smoothstep(crownR, crownR - 0.25, d) * smoothstep(0.7, 0.95, d);
          float rim = exp(-pow((d - 0.82) / 0.13, 2.0));
          float glow = exp(-d * d * 0.7) * 0.5 * smoothstep(0.55, 0.95, d);
          float tt = clamp(-L.x / max(vTail, 1e-3), 0.0, 1.0);
          float tail = (L.x < 0.0 ? 1.0 : 0.0) * exp(-(L.y * L.y) / 0.35) * pow(1.0 - tt, 2.0) * 0.6;
          float pulse = 0.8 + 0.2 * sin(uTime * 14.0 + vSty.y * 9.0);
          float inner = smoothstep(0.8, 0.45, d);
          // swirl inside the dark core
          float sw = 0.5 + 0.5 * sin(ang * 3.0 - d * 9.0 + uTime * 6.0);
          outc = col * (rim * 2.0 * pulse + crown * 1.1 + glow + tail) + col * inner * sw * 0.06;
          occl = inner * 0.92;
        } else {
          // MARKER on the ground
          float d = sqrt(r2);
          float ring = exp(-pow((d - 0.75) / 0.12, 2.0));
          float fill = smoothstep(0.8, 0.1, d) * 0.35;
          outc = col * (ring * 0.9 + fill * 0.4) * (0.75 + 0.25 * sin(uTime * 10.0 + vSty.y * 5.0));
          occl = fill;
        }
        float a = vCol.a;
        gl_FragColor = vec4(outc * a, occl * a);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.ZeroFactor,
    blendDstAlpha: THREE.OneFactor,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 24;
  mesh.name = 'vfx-projectiles';
  return { mesh, geo, aPos, aDir, aCol, aSty, uniforms };
}

/** Faceted ice crystal, long axis +X (length ~1, radius ~0.16), smooth-ish bevel via a hexagonal bipyramid with a waist. */
export function createShardGeometry(): THREE.BufferGeometry {
  const pts: number[] = [];
  const sides = 6;
  const tip = 0.62;
  const tail = -0.38;
  const ring1 = { x: 0.12, r: 0.15 };
  const ring2 = { x: -0.12, r: 0.12 };
  const ringPt = (x: number, r: number, i: number) => {
    const a = (i / sides) * Math.PI * 2;
    return [x, Math.cos(a) * r, Math.sin(a) * r];
  };
  for (let i = 0; i < sides; i++) {
    const a1 = ringPt(ring1.x, ring1.r, i), b1 = ringPt(ring1.x, ring1.r, i + 1);
    const a2 = ringPt(ring2.x, ring2.r, i), b2 = ringPt(ring2.x, ring2.r, i + 1);
    // tip cone
    pts.push(tip, 0, 0, ...b1, ...a1);
    // waist band
    pts.push(...a1, ...b1, ...b2, ...a1, ...b2, ...a2);
    // tail cone
    pts.push(tail, 0, 0, ...a2, ...b2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  g.computeVertexNormals();
  return g;
}
