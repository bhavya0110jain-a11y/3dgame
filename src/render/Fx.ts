import * as THREE from 'three';

interface Particle {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number; maxLife: number;
  size: number;
  r: number; g: number; b: number;
  gravity: number;
}

interface FloatText {
  el: HTMLDivElement;
  pos: THREE.Vector3;
  life: number;
  vy: number;
}

interface Ring {
  mesh: THREE.Mesh;
  life: number;
  maxLife: number;
  from: number;
  to: number;
}

/** Visual effects: GPU point particles, expanding rings, floating damage numbers. */
export class FxManager {
  private readonly max = 4000;
  private particles: Particle[] = [];
  private geom = new THREE.BufferGeometry();
  private positions: Float32Array;
  private colors: Float32Array;
  private sizes: Float32Array;
  private points: THREE.Points;
  private texts: FloatText[] = [];
  private textPool: HTMLDivElement[] = [];
  private rings: Ring[] = [];
  private ringGeom = new THREE.RingGeometry(0.9, 1, 48);
  private tmp = new THREE.Vector3();
  damageNumbers = true;

  constructor(private scene: THREE.Scene, private camera: THREE.Camera, private uiLayer: HTMLElement) {
    this.positions = new Float32Array(this.max * 3);
    this.colors = new Float32Array(this.max * 3);
    this.sizes = new Float32Array(this.max);
    this.geom.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.geom.setAttribute('color', new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));
    this.geom.setAttribute('size', new THREE.BufferAttribute(this.sizes, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexColors: true,
      vertexShader: /* glsl */ `
        attribute float size;
        varying vec3 vColor;
        void main() {
          vColor = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * (300.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.0, d);
          gl_FragColor = vec4(vColor * a * 2.0, a);
        }
      `,
    });
    this.points = new THREE.Points(this.geom, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  burst(x: number, y: number, z: number, color: number, count: number, speed = 4, life = 0.6, size = 0.35, gravity = -4): void {
    const c = new THREE.Color(color);
    for (let i = 0; i < count && this.particles.length < this.max; i++) {
      const a = Math.random() * Math.PI * 2;
      const e = Math.random() * Math.PI - Math.PI / 2;
      const s = speed * (0.4 + Math.random() * 0.8);
      this.particles.push({
        x, y, z,
        vx: Math.cos(a) * Math.cos(e) * s,
        vy: Math.abs(Math.sin(e)) * s + 1,
        vz: Math.sin(a) * Math.cos(e) * s,
        life: life * (0.6 + Math.random() * 0.6),
        maxLife: life,
        size: size * (0.6 + Math.random() * 0.8),
        r: c.r, g: c.g, b: c.b,
        gravity,
      });
    }
  }

  /** Single drifting ember/spark. */
  spark(x: number, y: number, z: number, vx: number, vy: number, vz: number, color: number, life = 0.5, size = 0.3): void {
    if (this.particles.length >= this.max) return;
    const c = new THREE.Color(color);
    this.particles.push({ x, y, z, vx, vy, vz, life, maxLife: life, size, r: c.r, g: c.g, b: c.b, gravity: 0 });
  }

  ring(x: number, z: number, color: number, from: number, to: number, life = 0.4): void {
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(this.ringGeom, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.08, z);
    mesh.scale.setScalar(from);
    this.scene.add(mesh);
    this.rings.push({ mesh, life, maxLife: life, from, to });
  }

  text(x: number, y: number, z: number, str: string, cls = ''): void {
    if (!this.damageNumbers && cls !== 'ft-big') return;
    if (this.texts.length > 120) return;
    const el = this.textPool.pop() ?? document.createElement('div');
    el.className = `float-text ${cls}`;
    el.textContent = str;
    this.uiLayer.appendChild(el);
    this.texts.push({ el, pos: new THREE.Vector3(x, y, z), life: 0.8, vy: 2.2 });
  }

  update(dt: number): void {
    // particles
    let n = 0;
    const ps = this.particles;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.life -= dt;
      if (p.life <= 0) {
        ps[i] = ps[ps.length - 1];
        ps.pop();
        continue;
      }
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.y < 0.05) { p.y = 0.05; p.vy *= -0.3; }
      p.vx *= 1 - dt * 1.5;
      p.vz *= 1 - dt * 1.5;
    }
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      const k = p.life / p.maxLife;
      this.positions[n * 3] = p.x;
      this.positions[n * 3 + 1] = p.y;
      this.positions[n * 3 + 2] = p.z;
      this.colors[n * 3] = p.r * k;
      this.colors[n * 3 + 1] = p.g * k;
      this.colors[n * 3 + 2] = p.b * k;
      this.sizes[n] = p.size * (0.4 + 0.6 * k);
      n++;
    }
    this.geom.setDrawRange(0, n);
    (this.geom.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geom.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    (this.geom.attributes.size as THREE.BufferAttribute).needsUpdate = true;

    // rings
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.life -= dt;
      const t = 1 - r.life / r.maxLife;
      r.mesh.scale.setScalar(r.from + (r.to - r.from) * (1 - Math.pow(1 - t, 3)));
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - t);
      if (r.life <= 0) {
        this.scene.remove(r.mesh);
        (r.mesh.material as THREE.Material).dispose();
        this.rings.splice(i, 1);
      }
    }

    // floating text
    const w = window.innerWidth;
    const h = window.innerHeight;
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      t.life -= dt;
      t.pos.y += t.vy * dt;
      t.vy *= 1 - dt * 2;
      if (t.life <= 0) {
        t.el.remove();
        this.textPool.push(t.el);
        this.texts.splice(i, 1);
        continue;
      }
      this.tmp.copy(t.pos).project(this.camera);
      const sx = (this.tmp.x * 0.5 + 0.5) * w;
      const sy = (-this.tmp.y * 0.5 + 0.5) * h;
      t.el.style.transform = `translate(${sx}px, ${sy}px) translate(-50%, -50%)`;
      t.el.style.opacity = String(Math.min(1, t.life * 3));
    }
  }

  clear(): void {
    this.particles.length = 0;
    for (const t of this.texts) t.el.remove();
    this.texts.length = 0;
    for (const r of this.rings) {
      this.scene.remove(r.mesh);
      (r.mesh.material as THREE.Material).dispose();
    }
    this.rings.length = 0;
  }
}
