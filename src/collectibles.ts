import * as THREE from 'three';
import { Terrain, SEG, HALF, WATER_LEVEL, smoothstep } from './terrain';
import { mulberry32 } from './noise';
import type { Particles } from './fx';

/**
 * Things to chase around the island:
 *  - Spirit orbs (靈光): tiny glowing triangles on summits, cliff faces,
 *    lakes, meadows and high in the sky above rising air.
 *  - Updrafts (上升氣流): columns of wind that lift the paraglider.
 *  - Wind trials (風之試煉): ring courses that start at mountain tops.
 */

export interface Spot { x: number; z: number; }
export type OrbKind = 'trail' | 'peak' | 'sky' | 'cliff' | 'water' | 'field' | 'reward';
export interface OrbDef { x: number; y: number; z: number; kind: OrbKind; }

const ISLAND_R = 212;

// ------------------------------------------------------------------ helpers
let glowTex: THREE.Texture | null = null;
export function softGlowTexture(): THREE.Texture {
  if (glowTex) return glowTex;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const ctx = cv.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.22, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  glowTex = new THREE.CanvasTexture(cv);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}

export interface Peak { x: number; z: number; h: number; }

/** Local maxima of the heightfield, highest first, spaced apart. */
export function findPeaks(terrain: Terrain, minH: number, sep: number, avoid: Spot[], avoidR: number): Peak[] {
  const N = SEG + 1;
  const H = terrain.heights;
  const R = 4;
  const found: Peak[] = [];
  for (let j = R; j < N - R; j++) {
    for (let i = R; i < N - R; i++) {
      const h = H[j * N + i];
      if (h < minH) continue;
      let isMax = true;
      for (let b = -R; b <= R && isMax; b++) {
        for (let a = -R; a <= R; a++) {
          if ((a || b) && H[(j + b) * N + i + a] > h) { isMax = false; break; }
        }
      }
      if (!isMax) continue;
      const x = -HALF + i * terrain.step, z = -HALF + j * terrain.step;
      if (Math.hypot(x, z) > ISLAND_R) continue;
      if (avoid.some((s) => Math.hypot(s.x - x, s.z - z) < avoidR)) continue;
      found.push({ x, z, h });
    }
  }
  found.sort((a, b) => b.h - a.h);
  const out: Peak[] = [];
  for (const p of found) {
    if (out.every((o) => Math.hypot(o.x - p.x, o.z - p.z) > sep)) out.push(p);
  }
  return out;
}

function gradMag(terrain: Terrain, x: number, z: number): [number, number, number] {
  const e = 0.8;
  const gx = (terrain.height(x + e, z) - terrain.height(x - e, z)) / (2 * e);
  const gz = (terrain.height(x, z + e) - terrain.height(x, z - e)) / (2 * e);
  return [Math.hypot(gx, gz), gx, gz];
}

// ------------------------------------------------------------------ Updrafts
export class Updraft {
  readonly group = new THREE.Group();
  readonly r = 4.6;
  active: boolean;
  private grow: number;
  private mat: THREE.ShaderMaterial;
  private spawnAcc = 0;

  constructor(public x: number, public z: number, public base: number, public top: number, active: boolean, public towerIndex = -1) {
    this.active = active;
    this.grow = active ? 1 : 0;
    const h = top - base;
    const geo = new THREE.CylinderGeometry(this.r * 0.85, this.r * 1.1, h, 20, 1, true);
    geo.translate(0, h / 2, 0);
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { time: { value: 0 }, fade: { value: this.grow } },
      vertexShader: /* glsl */ `
        varying vec2 vUv; varying float vF;
        void main() {
          vUv = uv;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vec3 n = normalize(normalMatrix * normal);
          vF = 1.0 - abs(dot(n, normalize(-mv.xyz)));
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform float time; uniform float fade;
        varying vec2 vUv; varying float vF;
        void main() {
          float band = fract(vUv.x * 7.0 + vUv.y * 2.5 - time * 0.12);
          float line = smoothstep(0.0, 0.06, band) * smoothstep(0.22, 0.06, band);
          float flow = 0.45 + 0.55 * sin(vUv.y * 22.0 - time * 7.0 + vUv.x * 6.283);
          float vfade = smoothstep(0.0, 0.08, vUv.y) * pow(1.0 - vUv.y, 1.4);
          float a = (line * flow * 0.55 + vF * 0.12) * vfade * fade;
          gl_FragColor = vec4(vec3(0.85, 0.97, 1.0) * a, a);
          #include <colorspace_fragment>
        }`,
    });
    const mesh = new THREE.Mesh(geo, this.mat);
    this.group.add(mesh);
    this.group.position.set(x, base, z);
    this.group.visible = this.grow > 0.01;
  }

  strength(px: number, py: number, pz: number): number {
    if (!this.active || this.grow < 0.5) return 0;
    const d = Math.hypot(px - this.x, pz - this.z);
    if (d > this.r * 1.35) return 0;
    if (py < this.base - 3 || py > this.top + 2) return 0;
    return smoothstep(this.r * 1.35, this.r * 0.55, d) * smoothstep(this.top + 2, this.top - 14, py);
  }

  update(t: number, dt: number, fx: Particles, viewer: THREE.Vector3) {
    if (this.active && this.grow < 1) this.grow = Math.min(1, this.grow + dt * 0.5);
    this.group.visible = this.grow > 0.01;
    if (!this.group.visible) return;
    this.mat.uniforms.time.value = t;
    this.mat.uniforms.fade.value = this.grow;
    this.group.scale.set(1, Math.max(0.01, this.grow), 1);
    const dist = Math.hypot(viewer.x - this.x, viewer.z - this.z);
    if (dist > 170) return;
    this.spawnAcc += dt * 14 * this.grow;
    while (this.spawnAcc > 1) {
      this.spawnAcc -= 1;
      const a = Math.random() * Math.PI * 2, rr = Math.random() * this.r;
      const y = this.base + Math.random() * (this.top - this.base) * 0.4;
      fx.spawn(this.x + Math.cos(a) * rr, y, this.z + Math.sin(a) * rr,
        -Math.sin(a) * 2, 9 + Math.random() * 6, Math.cos(a) * 2,
        Math.random() < 0.5 ? '#eafcff' : '#c6f0c0', 0.3 + Math.random() * 0.3, 2.6, 0, 0.1);
    }
  }
}

// ------------------------------------------------------------------ Wind trials
interface Ring { p: THREE.Vector3; dir: THREE.Vector3; mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; passT: number; }
export type CourseEvent = { type: 'start' | 'pass' | 'complete' | 'fail'; index: number; total: number } | null;

export class RingCourse {
  readonly group = new THREE.Group();
  readonly rings: Ring[] = [];
  next = 0;
  timer = 0;
  done = false;
  rewardOrb = -1;
  static readonly WINDOW = 6.5;

  constructor(public id: number, public name: string, points: { p: THREE.Vector3; dir: THREE.Vector3 }[]) {
    const geo = new THREE.TorusGeometry(2.7, 0.15, 6, 30);
    for (const pt of points) {
      const mat = new THREE.MeshBasicMaterial({ color: '#9ff3ff', transparent: true, opacity: 0.5, depthWrite: false });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(pt.p);
      mesh.lookAt(pt.p.clone().add(pt.dir));
      this.group.add(mesh);
      this.rings.push({ p: pt.p, dir: pt.dir, mesh, mat, passT: -1 });
    }
  }

  get start() { return this.rings[0].p; }
  get end() { return this.rings[this.rings.length - 1].p; }

  setDone(v: boolean) {
    this.done = v;
    this.group.visible = !v;
  }

  private reset() {
    this.next = 0;
    this.timer = 0;
    for (const r of this.rings) { r.passT = -1; r.mesh.visible = true; }
  }

  update(t: number, dt: number, chest: THREE.Vector3): CourseEvent {
    if (this.done) {
      // Let the last rings finish their fade-out flourish
      let any = false;
      for (const r of this.rings) if (r.passT >= 0) { any = true; this.animatePassed(r, dt); }
      this.group.visible = any;
      return null;
    }
    let ev: CourseEvent = null;
    if (this.next > 0) {
      this.timer -= dt;
      if (this.timer <= 0) { this.reset(); ev = { type: 'fail', index: 0, total: this.rings.length }; }
    }
    const r = this.rings[this.next];
    if (r && chest.distanceTo(r.p) < 3.4) {
      r.passT = 0;
      this.next++;
      this.timer = RingCourse.WINDOW;
      if (this.next >= this.rings.length) {
        this.done = true;
        ev = { type: 'complete', index: this.next, total: this.rings.length };
      } else {
        ev = { type: this.next === 1 ? 'start' : 'pass', index: this.next, total: this.rings.length };
      }
    }
    for (let i = 0; i < this.rings.length; i++) {
      const ring = this.rings[i];
      if (ring.passT >= 0) { this.animatePassed(ring, dt); continue; }
      const isNext = i === this.next;
      const soon = i === this.next + 1;
      const pulse = 1 + Math.sin(t * 5 + i) * 0.06;
      ring.mesh.scale.setScalar(isNext ? pulse * 1.08 : 1);
      ring.mat.color.set(isNext ? '#ffd36a' : '#9ff3ff');
      ring.mat.opacity = isNext ? 0.95 : soon ? 0.6 : 0.32;
      ring.mesh.rotation.z = t * (isNext ? 1.2 : 0.3);
    }
    return ev;
  }

  private animatePassed(r: Ring, dt: number) {
    r.passT += dt;
    const k = r.passT / 0.6;
    r.mesh.scale.setScalar(1 + k * 0.9);
    r.mat.color.set('#ffffff');
    r.mat.opacity = Math.max(0, 1 - k);
    if (k >= 1) { r.mesh.visible = false; r.passT = -2; }
  }
}

// ------------------------------------------------------------------ Orbs
export class Orbs {
  readonly collected: boolean[];
  readonly hidden: boolean[];
  private inst: THREE.InstancedMesh;
  private glow: THREE.Points;
  private glowPos: Float32Array;
  private live: Float32Array;
  private magnet: Uint8Array;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly s = new THREE.Vector3();
  private readonly v = new THREE.Vector3();
  readonly group = new THREE.Group();

  constructor(public defs: OrbDef[]) {
    const n = defs.length;
    this.collected = new Array(n).fill(false);
    this.hidden = defs.map((d) => d.kind === 'reward');
    this.live = new Float32Array(n * 3);
    this.magnet = new Uint8Array(n);
    defs.forEach((d, i) => { this.live[i * 3] = d.x; this.live[i * 3 + 1] = d.y; this.live[i * 3 + 2] = d.z; });

    const geo = new THREE.TetrahedronGeometry(0.42, 0);
    const mat = new THREE.MeshBasicMaterial({ color: '#fff3b0' });
    this.inst = new THREE.InstancedMesh(geo, mat, n);
    this.inst.frustumCulled = false;

    this.glowPos = new Float32Array(n * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.glowPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.glow = new THREE.Points(g, new THREE.PointsMaterial({
      map: softGlowTexture(), color: '#ffcf55', size: 3.4, sizeAttenuation: true,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.glow.frustumCulled = false;
    this.group.add(this.inst, this.glow);
  }

  get total() { return this.defs.length; }
  get count() { return this.collected.filter(Boolean).length; }

  setCollected(i: number, v: boolean) {
    this.collected[i] = v;
    this.magnet[i] = 0;
    const d = this.defs[i];
    this.live[i * 3] = d.x; this.live[i * 3 + 1] = d.y; this.live[i * 3 + 2] = d.z;
  }

  reveal(i: number) { this.hidden[i] = false; }
  hide(i: number) { this.hidden[i] = true; }

  /** Returns indices collected this frame. */
  update(t: number, dt: number, chest: THREE.Vector3, active: boolean): number[] {
    const got: number[] = [];
    for (let i = 0; i < this.defs.length; i++) {
      const off = this.collected[i] || this.hidden[i];
      let x = this.live[i * 3], y = this.live[i * 3 + 1], z = this.live[i * 3 + 2];
      if (!off && active) {
        const dx = chest.x - x, dy = chest.y - y, dz = chest.z - z;
        const d = Math.hypot(dx, dy, dz);
        if (d < 5.2) this.magnet[i] = 1;
        if (this.magnet[i]) {
          const sp = Math.min(1, dt * 9);
          x += dx * sp; y += dy * sp; z += dz * sp;
          this.live[i * 3] = x; this.live[i * 3 + 1] = y; this.live[i * 3 + 2] = z;
        }
        if (d < 1.3) { this.collected[i] = true; got.push(i); }
      }
      const hiddenNow = this.collected[i] || this.hidden[i];
      const bob = this.magnet[i] ? 0 : Math.sin(t * 2 + i * 1.7) * 0.22;
      this.v.set(x, y + bob, z);
      this.e.set(t * 0.9 + i, t * 1.7 + i, 0);
      this.q.setFromEuler(this.e);
      const sc = hiddenNow ? 0 : 1 + Math.sin(t * 4 + i) * 0.08;
      this.s.setScalar(sc);
      this.m.compose(this.v, this.q, this.s);
      this.inst.setMatrixAt(i, this.m);
      this.glowPos[i * 3] = x;
      this.glowPos[i * 3 + 1] = hiddenNow ? -9999 : y + bob;
      this.glowPos[i * 3 + 2] = z;
    }
    this.inst.instanceMatrix.needsUpdate = true;
    this.glow.geometry.attributes.position.needsUpdate = true;
    return got;
  }
}

// ------------------------------------------------------------------ World generation
export interface Wilds {
  orbs: Orbs;
  updrafts: Updraft[];
  courses: RingCourse[];
}

const COURSE_NAMES = ['鷹落之試', '雲渡之試', '迴風之試', '長空之試', '霞穿之試', '白羽之試'];

export function createWilds(terrain: Terrain, towers: (Spot & { base: number })[], start: Spot): Wilds {
  const rand = mulberry32(2024);
  const defs: OrbDef[] = [];
  const avoidTowers = towers.map((t) => ({ x: t.x, z: t.z }));
  const farFromOrbs = (x: number, z: number, d: number) => defs.every((o) => Math.hypot(o.x - x, o.z - z) > d);
  const farFromTowers = (x: number, z: number, d: number) => avoidTowers.every((o) => Math.hypot(o.x - x, o.z - z) > d);

  // 1. Breadcrumb trail leading from the start toward the first shrine
  for (const [x, z] of [[9, 52], [6, 38], [3, 24], [0, 8]]) {
    const h = terrain.height(x, z);
    if (h > WATER_LEVEL + 0.5) defs.push({ x, y: h + 1.1, z, kind: 'trail' });
  }

  // 2. Summits (climb up for these)
  const peaks = findPeaks(terrain, 30, 42, avoidTowers, 20);
  for (const p of peaks.slice(0, 16)) {
    defs.push({ x: p.x, y: p.h + 1.3, z: p.z, kind: 'peak' });
  }

  // 3. Updrafts: one beside every shrine (awakens on resonance) + natural ones
  const updrafts: Updraft[] = [];
  towers.forEach((t, i) => {
    const a = i * 2.1 + 0.6;
    const x = t.x + Math.sin(a) * 15, z = t.z + Math.cos(a) * 15;
    const base = Math.max(terrain.height(x, z), WATER_LEVEL);
    updrafts.push(new Updraft(x, z, base, base + 48, false, i));
  });
  let natural = 0;
  for (let k = 0; k < 4000 && natural < 7; k++) {
    const x = (rand() - 0.5) * ISLAND_R * 2, z = (rand() - 0.5) * ISLAND_R * 2;
    if (Math.hypot(x, z) > ISLAND_R - 10) continue;
    const h = terrain.height(x, z);
    if (h < WATER_LEVEL + 1 || h > 34) continue;
    if (terrain.flatness(x, z) < 0.85) continue;
    // Next to a big mountain so riding it up opens a view & glide line
    const tall = peaks.find((p) => p.h - h > 28 && Math.hypot(p.x - x, p.z - z) < 70);
    if (!tall) continue;
    if (!farFromTowers(x, z, 40)) continue;
    if (Math.hypot(x - start.x, z - start.z) < 24) continue;
    if (updrafts.some((u) => Math.hypot(u.x - x, u.z - z) < 85)) continue;
    updrafts.push(new Updraft(x, z, h, Math.max(h + 40, tall.h + 12), true));
    natural++;
  }
  // Sky orbs ride on top of every updraft
  for (const u of updrafts) defs.push({ x: u.x, y: u.top - 3, z: u.z, kind: 'sky' });

  // 4. Cliff-face orbs (grab them mid-climb)
  let cliffs = 0;
  for (let k = 0; k < 9000 && cliffs < 7; k++) {
    const x = (rand() - 0.5) * ISLAND_R * 2, z = (rand() - 0.5) * ISLAND_R * 2;
    if (Math.hypot(x, z) > ISLAND_R) continue;
    const h = terrain.height(x, z);
    if (h < 16) continue;
    const [g, gx, gz] = gradMag(terrain, x, z);
    if (g < 1.5 || g > 4) continue;
    if (!farFromOrbs(x, z, 45) || !farFromTowers(x, z, 25)) continue;
    const ox = (-gx / g) * 0.9, oz = (-gz / g) * 0.9;
    defs.push({ x: x + ox, y: h + 0.9, z: z + oz, kind: 'cliff' });
    cliffs++;
  }

  // 5. Lake orbs (swim out for these)
  let lakes = 0;
  for (let k = 0; k < 6000 && lakes < 5; k++) {
    const x = (rand() - 0.5) * ISLAND_R * 2, z = (rand() - 0.5) * ISLAND_R * 2;
    if (Math.hypot(x, z) > ISLAND_R - 25) continue;
    if (terrain.height(x, z) > WATER_LEVEL - 2.5) continue;
    let shore = false;
    for (let a = 0; a < 8 && !shore; a++) {
      if (terrain.height(x + Math.cos(a * 0.785) * 28, z + Math.sin(a * 0.785) * 28) > WATER_LEVEL + 1) shore = true;
    }
    if (!shore || !farFromOrbs(x, z, 50)) continue;
    defs.push({ x, y: WATER_LEVEL + 0.9, z, kind: 'water' });
    lakes++;
  }

  // 6. Meadow / forest orbs
  let fields = 0;
  for (let k = 0; k < 12000 && fields < 22; k++) {
    const x = (rand() - 0.5) * ISLAND_R * 2, z = (rand() - 0.5) * ISLAND_R * 2;
    if (Math.hypot(x, z) > ISLAND_R) continue;
    const h = terrain.height(x, z);
    if (h < WATER_LEVEL + 2 || h > 48) continue;
    if (terrain.flatness(x, z) < 0.8) continue;
    if (!farFromOrbs(x, z, 34) || !farFromTowers(x, z, 14)) continue;
    if (Math.hypot(x - start.x, z - start.z) < 20) continue;
    defs.push({ x, y: h + 1.1, z, kind: 'field' });
    fields++;
  }

  // 7. Wind trials: ring courses gliding down from summits
  const courses: RingCourse[] = [];
  for (const p of peaks) {
    if (courses.length >= 5) break;
    if (p.h < 38) continue;
    if (courses.some((c) => Math.hypot(c.start.x - p.x, c.start.z - p.z) < 90)) continue;
    let best: { p: THREE.Vector3; dir: THREE.Vector3 }[] | null = null;
    let bestClear = 5;
    const curve = (courses.length % 2 ? 1 : -1) * (0.08 + rand() * 0.08);
    for (let a = 0; a < 16; a++) {
      let ang = (a / 16) * Math.PI * 2;
      const pts: { p: THREE.Vector3; dir: THREE.Vector3 }[] = [];
      let x = p.x + Math.sin(ang) * 14, z = p.z + Math.cos(ang) * 14, y = p.h - 3;
      let minClear = Infinity;
      for (let i = 0; i < 8; i++) {
        const dir = new THREE.Vector3(Math.sin(ang), -0.2, Math.cos(ang)).normalize();
        pts.push({ p: new THREE.Vector3(x, y, z), dir });
        // Must stay inside the playable radius (the player is clamped at HALF - 12)
        if (Math.hypot(x, z) > HALF - 40) minClear = -Infinity;
        // check clearance along the next segment
        for (let s = 0; s <= 4; s++) {
          const f = s / 4;
          const sx = x + Math.sin(ang) * 16 * f, sz = z + Math.cos(ang) * 16 * f, sy = y - 3.2 * f;
          minClear = Math.min(minClear, sy - Math.max(terrain.height(sx, sz), WATER_LEVEL));
        }
        if (i < 7) {
          ang += curve;
          x += Math.sin(ang) * 16; z += Math.cos(ang) * 16; y -= 3.2;
        }
      }
      if (minClear > bestClear) { bestClear = minClear; best = pts; }
    }
    if (best) courses.push(new RingCourse(courses.length, COURSE_NAMES[courses.length], best));
  }
  for (const c of courses) {
    c.rewardOrb = defs.length;
    defs.push({ x: c.end.x, y: c.end.y, z: c.end.z, kind: 'reward' });
  }

  return { orbs: new Orbs(defs), updrafts, courses };
}
