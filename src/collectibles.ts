import * as THREE from 'three';
import { Terrain, SEG, HALF, WATER_LEVEL, smoothstep } from './terrain';
import { mulberry32 } from './noise';
import { createCelMaterial } from './cel';
import type { Particles } from './fx';

/**
 * Things to chase around the island:
 *  - Spirit orbs (靈光): tiny glowing triangles on summits, cliff faces,
 *    lakes, meadows and high in the sky above rising air. Only emerge as
 *    the explorer approaches within 3D proximity.
 *  - Updrafts (上升氣流): columns of wind that lift the paraglider.
 *  - Wind trials (風之試煉): ring courses anchored by a summit wind-glyph
 *    and luminous butterflies (靈蝶 + 風紋) that swoop out and unfold the
 *    rings sequentially when approached.
 */

export interface Spot { x: number; z: number; }
export type OrbKind = 'trail' | 'peak' | 'sky' | 'cliff' | 'water' | 'field' | 'reward';
export interface OrbDef { x: number; y: number; z: number; kind: OrbKind; }

/** 3D distance (m) beyond which spirit orbs are completely hidden. */
export const ORB_VISIBLE_FAR = 56;
/** 3D distance (m) at which spirit orbs reach full clarity & glow. */
export const ORB_VISIBLE_NEAR = 32;

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
          vec3 nRaw = normalMatrix * normal;
          float nLenSq = dot(nRaw, nRaw);
          vec3 n = nLenSq > 1e-10 ? nRaw * inversesqrt(nLenSq) : vec3(0.0, 1.0, 0.0);
          float vLenSq = dot(mv.xyz, mv.xyz);
          vec3 v = vLenSq > 1e-10 ? (-mv.xyz) * inversesqrt(vLenSq) : vec3(0.0, 0.0, 1.0);
          vF = clamp(1.0 - abs(dot(n, v)), 0.0, 1.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform float time; uniform float fade;
        varying vec2 vUv; varying float vF;
        void main() {
          float band = fract(vUv.x * 7.0 + vUv.y * 2.5 - time * 0.12);
          float line = smoothstep(0.0, 0.06, band) * smoothstep(0.22, 0.06, band);
          float flow = 0.45 + 0.55 * sin(vUv.y * 22.0 - time * 7.0 + vUv.x * 6.283);
          float vTop = clamp(1.0 - vUv.y, 0.0, 1.0);
          float vfade = smoothstep(0.0, 0.08, vUv.y) * (vTop > 1e-6 ? pow(vTop, 1.4) : 0.0);
          float a = (line * flow * 0.55 + vF * 0.12) * vfade * fade;
          gl_FragColor = vec4(vec3(0.85, 0.97, 1.0) * a, a);
          #include <tonemapping_fragment>
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
interface Ring {
  p: THREE.Vector3;
  dir: THREE.Vector3;
  mesh: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  passT: number;
  unfold: number;
}

interface SpiritButterfly {
  root: THREE.Group;
  wingL: THREE.Mesh;
  wingR: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  baseColor: THREE.Color;
  phase: number;
  orbitR: number;
  orbitH: number;
  orbitSpeed: number;
  delay: number;
  scale: number;
  trailAcc: number;
}

export type CourseEvent = { type: 'reveal' | 'start' | 'pass' | 'complete' | 'fail'; index: number; total: number } | null;

// Shared geometries & stone material reused across all wind trial courses
interface TrialSharedAssets {
  ringGeo: THREE.TorusGeometry;
  glyphStoneGeo: THREE.CylinderGeometry;
  glyphOuterGeo: THREE.RingGeometry;
  glyphTriGeo: THREE.RingGeometry;
  glyphArrowGeo: THREE.BufferGeometry;
  glyphSwirlGeo: THREE.CylinderGeometry;
  wingGeo: THREE.BufferGeometry;
  bodyGeo: THREE.BufferGeometry;
  stoneMat: THREE.MeshLambertMaterial;
}
let trialAssets: TrialSharedAssets | null = null;
function getTrialAssets(): TrialSharedAssets {
  if (trialAssets) return trialAssets;

  const ringGeo = new THREE.TorusGeometry(2.7, 0.15, 6, 30);

  // Low-profile carved summit stone disc (18cm thin so distant mountain peak silhouettes stay untouched)
  const glyphStoneGeo = new THREE.CylinderGeometry(0.96, 1.16, 0.24, 6);
  glyphStoneGeo.translate(0, -0.04, 0);

  const glyphOuterGeo = new THREE.RingGeometry(0.76, 0.86, 24);
  glyphOuterGeo.rotateX(-Math.PI / 2);

  // Inner triangle oriented with one apex pointing directly along +Z (launch heading)
  const glyphTriGeo = new THREE.RingGeometry(0.38, 0.48, 3);
  glyphTriGeo.rotateX(-Math.PI / 2);
  glyphTriGeo.rotateY(-Math.PI / 2);

  // Small carved launch chevron ahead of the triangle apex (+Z)
  const glyphArrowGeo = new THREE.BufferGeometry();
  glyphArrowGeo.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, 0.72,
    -0.12, 0, 0.53,
    0.12, 0, 0.53,
  ], 3));
  glyphArrowGeo.computeVertexNormals();

  // Low ankle-high swirling wind-ribbon cylinder over the summit glyph
  const glyphSwirlGeo = new THREE.CylinderGeometry(0.84, 1.24, 0.62, 20, 1, true);
  glyphSwirlGeo.translate(0, 0.31, 0);

  // Crisp triangular swallowtail wing (+X side, hinged at x = 0; mirrored for left wing)
  const wingGeo = new THREE.BufferGeometry();
  wingGeo.setAttribute('position', new THREE.Float32BufferAttribute([
    // Upper triangular forewing
    0, 0, 0.12,
    0.27, 0.03, 0.18,
    0.17, 0, -0.02,
    // Lower triangular hindwing
    0, 0, 0.01,
    0.16, 0, -0.02,
    0.09, -0.01, -0.18,
  ], 3));
  wingGeo.computeVertexNormals();

  const bodyGeo = new THREE.OctahedronGeometry(0.036, 0);
  bodyGeo.scale(0.65, 0.65, 2.5);

  const stoneMat = createCelMaterial({
    color: '#8e8c80',
    flatShading: true,
    shadowTint: '#6c82a8',
    rimStrength: 0.25,
    mossTop: 0.22,
    cacheKey: 'cel_trial_glyph_stone_v1',
  });

  trialAssets = {
    ringGeo,
    glyphStoneGeo,
    glyphOuterGeo,
    glyphTriGeo,
    glyphArrowGeo,
    glyphSwirlGeo,
    wingGeo,
    bodyGeo,
    stoneMat,
  };
  return trialAssets;
}

const BUTTERFLY_SPECS = [
  { color: '#ffe894', scale: 1.48, orbitR: 0.54, orbitH: 0.76, orbitSpeed: 1.25, delay: 0.0, phase: 0.0 },
  { color: '#7eeeff', scale: 1.22, orbitR: 0.88, orbitH: 1.06, orbitSpeed: -1.05, delay: 0.14, phase: 2.15 },
  { color: '#b8fff2', scale: 1.12, orbitR: 0.74, orbitH: 0.6, orbitSpeed: 1.48, delay: 0.26, phase: 4.25 },
];
const COL_GLYPH_ACTIVE = new THREE.Color('#a6f6ff');
const COL_WHITE = new THREE.Color('#ffffff');

export class RingCourse {
  readonly group = new THREE.Group();
  readonly anchor: THREE.Vector3;
  readonly launchYaw: number;
  readonly rings: Ring[] = [];
  next = 0;
  timer = 0;
  done = false;
  discovered = false;
  revealed = false;
  rewardOrb = -1;

  static readonly WINDOW = 6.5;
  /** Approach radius (m) around the summit wind-glyph that awakens the butterflies & unfolds the rings. */
  static readonly REVEAL_DIST = 18;
  /** Distance (m) beyond which an unstarted trial folds its rings back up. */
  static readonly HIDE_DIST = 42;
  /** Time (s) for the lead butterfly to swoop from the summit wind-glyph to ring 0. */
  static readonly RING_START_DELAY = 0.42;
  /** Delay (s) between consecutive rings unfolding along the butterfly wake. */
  static readonly RING_STAGGER = 0.22;
  static readonly RING_UNFOLD_DUR = 0.42;
  static readonly RING_RETRACT_DUR = 0.55;

  private revealT = 0;
  private glowLevel = 0;
  private readonly glyphMat: THREE.MeshBasicMaterial;
  private readonly swirlMat: THREE.ShaderMaterial;
  private readonly swirlMesh: THREE.Mesh;
  private readonly butterflies: SpiritButterfly[] = [];
  private readonly waypoints: THREE.Vector3[];

  private readonly tmpPos = new THREE.Vector3();
  private readonly tmpNext = new THREE.Vector3();
  private readonly tmpRight = new THREE.Vector3();
  private readonly tmpUp = new THREE.Vector3(0, 1, 0);
  private readonly tmpCol = new THREE.Color();

  constructor(
    public id: number,
    public name: string,
    anchor: THREE.Vector3,
    points: { p: THREE.Vector3; dir: THREE.Vector3 }[],
  ) {
    this.anchor = anchor.clone();
    this.launchYaw = Math.atan2(points[0].p.x - anchor.x, points[0].p.z - anchor.z);
    const assets = getTrialAssets();

    // 1. Grounded summit wind-glyph stone medallion (subtle from afar, lights up on approach)
    const glyphGroup = new THREE.Group();
    glyphGroup.position.copy(this.anchor);
    glyphGroup.rotation.y = this.launchYaw;

    const stone = new THREE.Mesh(assets.glyphStoneGeo, assets.stoneMat);
    stone.receiveShadow = true;
    stone.castShadow = true;
    glyphGroup.add(stone);

    this.glyphMat = new THREE.MeshBasicMaterial({
      color: '#6ea6ae',
      transparent: true,
      opacity: 0.26,
      side: THREE.DoubleSide,
      depthWrite: false,
      fog: true,
    });
    const outerRing = new THREE.Mesh(assets.glyphOuterGeo, this.glyphMat);
    outerRing.position.y = 0.092;
    const innerTri = new THREE.Mesh(assets.glyphTriGeo, this.glyphMat);
    innerTri.position.y = 0.095;
    const arrow = new THREE.Mesh(assets.glyphArrowGeo, this.glyphMat);
    arrow.position.y = 0.098;
    glyphGroup.add(outerRing, innerTri, arrow);

    this.swirlMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      uniforms: {
        time: { value: 0 },
        fade: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float time;
        uniform float fade;
        varying vec2 vUv;
        void main() {
          float band = fract(vUv.x * 3.0 + vUv.y * 1.4 - time * 0.42);
          float ribbon = smoothstep(0.0, 0.08, band) * smoothstep(0.26, 0.08, band);
          float vFade = smoothstep(0.0, 0.18, vUv.y) * smoothstep(1.0, 0.15, vUv.y);
          float shimmer = 0.65 + 0.35 * sin(vUv.x * 12.566 - time * 3.2);
          float a = ribbon * vFade * shimmer * fade * 0.55;
          gl_FragColor = vec4(vec3(0.76, 0.97, 1.0) * a, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.swirlMesh = new THREE.Mesh(assets.glyphSwirlGeo, this.swirlMat);
    this.swirlMesh.position.y = 0.08;
    this.swirlMesh.visible = false;
    glyphGroup.add(this.swirlMesh);
    this.group.add(glyphGroup);

    // 2. Three luminous triangular butterflies (靈蝶) fluttering over the wind-glyph
    for (const spec of BUTTERFLY_SPECS) {
      const root = new THREE.Group();
      const baseColor = new THREE.Color(spec.color);
      const mat = new THREE.MeshBasicMaterial({
        color: baseColor.clone(),
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthWrite: false,
        fog: true,
      });
      const wingR = new THREE.Mesh(assets.wingGeo, mat);
      const wingL = new THREE.Mesh(assets.wingGeo, mat);
      wingL.scale.x = -1;
      const body = new THREE.Mesh(assets.bodyGeo, mat);
      root.add(wingR, wingL, body);
      root.scale.setScalar(spec.scale);
      root.visible = false;
      this.group.add(root);
      this.butterflies.push({
        root,
        wingL,
        wingR,
        mat,
        baseColor,
        phase: spec.phase + id * 1.3,
        orbitR: spec.orbitR,
        orbitH: spec.orbitH,
        orbitSpeed: spec.orbitSpeed,
        delay: spec.delay,
        scale: spec.scale,
        trailAcc: 0,
      });
    }

    // 3. Flight path waypoints: summit wind-glyph -> ring 0 -> ring 1 -> ... -> ring N-1
    this.waypoints = [
      this.anchor.clone().add(new THREE.Vector3(0, 0.9, 0)),
      ...points.map((pt) => pt.p.clone()),
    ];

    // 4. Trial rings (initially folded/hidden until approached)
    for (const pt of points) {
      const mat = new THREE.MeshBasicMaterial({
        color: '#9ff3ff',
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(assets.ringGeo, mat);
      mesh.position.copy(pt.p);
      mesh.lookAt(pt.p.clone().add(pt.dir));
      mesh.visible = false;
      this.group.add(mesh);
      this.rings.push({ p: pt.p, dir: pt.dir, mesh, mat, passT: -1, unfold: 0 });
    }
  }

  get start() { return this.rings[0].p; }
  get end() { return this.rings[this.rings.length - 1].p; }

  setDone(v: boolean) {
    this.done = v;
    this.next = 0;
    this.timer = 0;
    this.revealed = false;
    this.revealT = 0;
    this.glowLevel = 0;
    this.swirlMesh.visible = false;
    for (const b of this.butterflies) b.root.visible = false;
    for (const r of this.rings) {
      r.passT = -1;
      r.unfold = 0;
      r.mesh.visible = false;
    }
    if (v) this.discovered = true;
  }

  private reset(keepRevealed: boolean) {
    this.next = 0;
    this.timer = 0;
    this.revealed = keepRevealed;
    if (!keepRevealed) this.revealT = 0;
    for (const r of this.rings) {
      r.passT = -1;
      r.unfold = keepRevealed ? 1 : r.unfold;
      r.mesh.visible = r.unfold > 0.002;
    }
  }

  /** Evaluates smooth Catmull-Rom position along [anchor, ring0, ring1, ...] in ring-index space (s = -1 at anchor, s = i at rings[i]). */
  private evalGuidePoint(s: number, out: THREE.Vector3) {
    const wp = this.waypoints;
    const maxSeg = wp.length - 1;
    const u = Math.max(0, Math.min(maxSeg, s + 1));
    const idx = Math.min(maxSeg - 1, Math.floor(u));
    const t = u - idx;
    const p0 = wp[Math.max(0, idx - 1)];
    const p1 = wp[idx];
    const p2 = wp[Math.min(maxSeg, idx + 1)];
    const p3 = wp[Math.min(maxSeg, idx + 2)];
    const t2 = t * t;
    const t3 = t2 * t;
    out.set(
      0.5 * ((2 * p1.x) + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
      0.5 * ((2 * p1.y) + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      0.5 * ((2 * p1.z) + (-p0.z + p2.z) * t + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * t2 + (-p0.z + 3 * p1.z - 3 * p2.z + p3.z) * t3),
    );
  }

  private updateGlyphAndButterflies(t: number, dt: number, distAnchor: number, fx?: Particles) {
    // 1. Ground wind-glyph & low swirling breeze ribbon
    const targetGlow = this.done
      ? 0
      : this.revealed
        ? 1
        : smoothstep(26, 12, distAnchor) * 0.45;
    this.glowLevel += (targetGlow - this.glowLevel) * Math.min(1, dt * 4.5);

    if (this.done) {
      this.glyphMat.color.set('#6d8b8c');
      this.glyphMat.opacity = 0.2;
      this.swirlMesh.visible = false;
      for (const b of this.butterflies) b.root.visible = false;
      return;
    }

    const pulse = 0.92 + 0.08 * Math.sin(t * 3.6 + this.id);
    this.tmpCol.set('#6ea6ae').lerp(COL_GLYPH_ACTIVE, this.glowLevel);
    this.glyphMat.color.copy(this.tmpCol).multiplyScalar(0.85 + this.glowLevel * 0.55 * pulse);
    this.glyphMat.opacity = 0.24 + this.glowLevel * 0.66;

    const swirlVis = smoothstep(34, 16, distAnchor) * (0.36 + this.glowLevel * 0.64);
    this.swirlMesh.visible = swirlVis > 0.01;
    if (this.swirlMesh.visible) {
      this.swirlMat.uniforms.time.value = t;
      this.swirlMat.uniforms.fade.value = swirlVis;
    }

    // 2. Luminous triangular butterflies (idle around wind-glyph, or swooping out to unfold rings)
    const lastS = this.rings.length - 1;
    const totalFlightDur = RingCourse.RING_START_DELAY + lastS * RingCourse.RING_STAGGER;

    for (let bi = 0; bi < this.butterflies.length; bi++) {
      const b = this.butterflies[bi];
      if (!this.revealed) {
        // Calm idle fluttering above the summit wind-glyph (invisible from far away)
        const idleVis = smoothstep(44, 22, distAnchor);
        if (idleVis <= 0.005) {
          b.root.visible = false;
          continue;
        }
        b.root.visible = true;
        const ang = t * b.orbitSpeed + b.phase;
        const r = b.orbitR * (0.85 + 0.15 * Math.sin(t * 1.4 + b.phase));
        const ox = Math.cos(ang) * r;
        const oz = Math.sin(ang) * r * 0.85;
        const oy = b.orbitH + Math.sin(t * 2.1 + b.phase) * 0.22;
        b.root.position.set(this.anchor.x + ox, this.anchor.y + oy, this.anchor.z + oz);

        // Face forward along the orbit tangent
        const tangAng = ang + (b.orbitSpeed >= 0 ? Math.PI / 2 : -Math.PI / 2);
        this.tmpNext.set(
          b.root.position.x + Math.cos(tangAng),
          b.root.position.y + Math.cos(t * 2.1 + b.phase) * 0.15,
          b.root.position.z + Math.sin(tangAng) * 0.85,
        );
        b.root.lookAt(this.tmpNext);

        const flap = Math.sin(t * 7.5 + b.phase) * 0.72 + 0.14;
        b.wingR.rotation.z = flap;
        b.wingL.rotation.z = -flap;
        b.root.scale.setScalar(b.scale * (0.35 + 0.65 * idleVis));
        b.mat.color.copy(b.baseColor).multiplyScalar(0.8 + idleVis * 0.48);
        b.mat.opacity = idleVis * 0.92;
      } else {
        // Swooping along the trial spline from summit -> ring 0 -> ... -> final ring
        const bt = this.revealT - b.delay;
        const fadeDur = 0.65;
        if (bt > totalFlightDur + fadeDur) {
          b.root.visible = false;
          continue;
        }
        b.root.visible = true;

        let s: number;
        let alpha = 1;
        if (bt < 0) {
          // Brief anticipatory lift above the glyph before darting off the cliff
          const k = 1 + bt / Math.max(0.05, b.delay);
          const ang = t * b.orbitSpeed + b.phase;
          b.root.position.set(
            this.anchor.x + Math.cos(ang) * b.orbitR * (1 - k * 0.65),
            this.anchor.y + b.orbitH + k * 0.45,
            this.anchor.z + Math.sin(ang) * b.orbitR * (1 - k * 0.65),
          );
          b.root.lookAt(this.start);
          const flap = Math.sin(t * 17 + b.phase) * 0.85 + 0.1;
          b.wingR.rotation.z = flap;
          b.wingL.rotation.z = -flap;
          b.root.scale.setScalar(b.scale * (1 + k * 0.12));
          b.mat.color.copy(b.baseColor).multiplyScalar(1.42);
          b.mat.opacity = 0.95;
          continue;
        } else if (bt < RingCourse.RING_START_DELAY) {
          s = -1 + bt / RingCourse.RING_START_DELAY;
        } else {
          s = (bt - RingCourse.RING_START_DELAY) / RingCourse.RING_STAGGER;
        }

        const clampedS = Math.min(lastS, s);
        this.evalGuidePoint(clampedS, this.tmpPos);
        this.evalGuidePoint(Math.min(lastS, clampedS + 0.08), this.tmpNext);

        if (s > lastS) {
          // Graceful upward spiral & dissolve past the final ring
          const over = Math.min(1, (bt - totalFlightDur) / fadeDur);
          const spAng = over * Math.PI * 2.2 + b.phase;
          this.tmpPos.x += Math.cos(spAng) * over * 1.4;
          this.tmpPos.y += over * 2.4;
          this.tmpPos.z += Math.sin(spAng) * over * 1.4;
          this.tmpNext.set(
            this.tmpPos.x - Math.sin(spAng),
            this.tmpPos.y + 0.7,
            this.tmpPos.z + Math.cos(spAng),
          );
          alpha = 1 - over;
        } else if (bi > 0) {
          // Companion butterflies weave gently around the lead wake
          this.tmpRight.subVectors(this.tmpNext, this.tmpPos);
          if (this.tmpRight.lengthSq() > 1e-6) {
            this.tmpRight.normalize().cross(this.tmpUp).normalize();
            const weave = bt * 6.5 + b.phase;
            const spread = 0.62 * smoothstep(-1, -0.35, s);
            this.tmpPos.addScaledVector(this.tmpRight, Math.cos(weave) * spread);
            this.tmpPos.y += Math.sin(weave) * spread * 0.75;
            this.tmpNext.addScaledVector(this.tmpRight, Math.cos(weave + 0.35) * spread);
            this.tmpNext.y += Math.sin(weave + 0.35) * spread * 0.75;
          }
        }

        b.root.position.copy(this.tmpPos);
        if (this.tmpNext.distanceToSquared(this.tmpPos) > 1e-6) {
          b.root.lookAt(this.tmpNext);
        }
        const flap = Math.sin(t * 19 + b.phase) * 0.88 + 0.08;
        b.wingR.rotation.z = flap;
        b.wingL.rotation.z = -flap;
        b.root.scale.setScalar(b.scale * (0.45 + 0.7 * alpha));
        b.mat.color.copy(b.baseColor).multiplyScalar(1.5);
        b.mat.opacity = alpha * 0.96;

        // Luminous trail sparkles behind flying butterflies
        if (fx && alpha > 0.25) {
          b.trailAcc += dt * (bi === 0 ? 18 : 10);
          while (b.trailAcc >= 1) {
            b.trailAcc -= 1;
            fx.spawn(
              this.tmpPos.x + (Math.random() - 0.5) * 0.25,
              this.tmpPos.y + (Math.random() - 0.5) * 0.25,
              this.tmpPos.z + (Math.random() - 0.5) * 0.25,
              (Math.random() - 0.5) * 0.6,
              0.4 + Math.random() * 0.6,
              (Math.random() - 0.5) * 0.6,
              bi === 0 ? '#ffe994' : '#bff8ff',
              0.38 + Math.random() * 0.22,
              0.55 + Math.random() * 0.3,
              0,
              0.25,
            );
          }
        }
      }
    }
  }

  update(t: number, dt: number, chest: THREE.Vector3, fx?: Particles): CourseEvent {
    const distAnchor = chest.distanceTo(this.anchor);
    const distStart = chest.distanceTo(this.start);

    if (this.done) {
      this.updateGlyphAndButterflies(t, dt, distAnchor);
      // Let the last rings finish their fade-out flourish
      for (const r of this.rings) if (r.passT >= 0) this.animatePassed(r, dt);
      return null;
    }

    let ev: CourseEvent = null;

    // 1. Proximity reveal & retract state transitions
    if (!this.revealed && (distAnchor < RingCourse.REVEAL_DIST || distStart < 14)) {
      this.revealed = true;
      this.discovered = true;
      this.revealT = 0;
      ev = { type: 'reveal', index: 0, total: this.rings.length };
    } else if (
      this.revealed &&
      this.next === 0 &&
      distAnchor > RingCourse.HIDE_DIST &&
      distStart > RingCourse.HIDE_DIST
    ) {
      this.revealed = false;
      this.revealT = 0;
    }

    if (this.revealed) {
      this.revealT += dt;
      if (this.next > 0) {
        // Ensure the player can never out-fly rings still unfolding ahead
        const minReveal = RingCourse.RING_START_DELAY + Math.min(this.rings.length - 1, this.next + 1) * RingCourse.RING_STAGGER;
        if (this.revealT < minReveal) this.revealT = minReveal;
      }
    }

    // 2. Active trial timer & ring pass detection
    if (this.next > 0) {
      this.timer -= dt;
      if (this.timer <= 0) {
        const stayOpen = distAnchor <= RingCourse.HIDE_DIST || distStart <= RingCourse.HIDE_DIST;
        this.reset(stayOpen);
        ev = { type: 'fail', index: 0, total: this.rings.length };
      }
    }
    const r = this.rings[this.next];
    if (r && (this.revealed || this.next > 0) && chest.distanceTo(r.p) < 3.4) {
      r.passT = 0;
      this.next++;
      this.discovered = true;
      this.timer = RingCourse.WINDOW;
      if (this.next >= this.rings.length) {
        this.done = true;
        ev = { type: 'complete', index: this.next, total: this.rings.length };
      } else {
        ev = { type: this.next === 1 ? 'start' : 'pass', index: this.next, total: this.rings.length };
      }
    }

    // 3. Animate wind-glyph & butterflies
    this.updateGlyphAndButterflies(t, dt, distAnchor, fx);

    // 4. Animate rings unfolding sequentially from ring 0 onward (or retracting smoothly)
    for (let i = 0; i < this.rings.length; i++) {
      const ring = this.rings[i];
      if (ring.passT >= 0) {
        this.animatePassed(ring, dt);
        continue;
      }
      if (this.revealed) {
        const unlockAt = RingCourse.RING_START_DELAY + i * RingCourse.RING_STAGGER;
        if (this.revealT >= unlockAt) {
          ring.unfold = Math.min(1, ring.unfold + dt / RingCourse.RING_UNFOLD_DUR);
        }
      } else {
        ring.unfold = Math.max(0, ring.unfold - dt / RingCourse.RING_RETRACT_DUR);
      }

      if (ring.unfold <= 0.002) {
        ring.mesh.visible = false;
        continue;
      }
      ring.mesh.visible = true;

      const u = ring.unfold;
      const ease = 1 - (1 - u) * (1 - u);
      const pop = Math.sin(u * Math.PI) * 0.14;
      const isNext = i === this.next;
      const soon = i === this.next + 1;
      const pulse = 1 + Math.sin(t * 5 + i) * 0.06;
      ring.mesh.scale.setScalar((isNext ? pulse * 1.08 : 1) * (0.22 + 0.78 * ease + pop));

      const flash = Math.max(0, 1 - u * 1.9);
      this.tmpCol.set(isNext ? '#ffd36a' : '#9ff3ff').lerp(COL_WHITE, flash * 0.65);
      ring.mat.color.copy(this.tmpCol).multiplyScalar((isNext ? 1.55 : 1.15) + flash * 0.45);
      ring.mat.opacity = (isNext ? 0.95 : soon ? 0.6 : 0.32) * ease;
      ring.mesh.rotation.z = t * (isNext ? 1.2 : 0.3);
    }

    return ev;
  }

  private animatePassed(r: Ring, dt: number) {
    r.passT += dt;
    const k = r.passT / 0.6;
    r.mesh.scale.setScalar(1 + k * 0.9);
    r.mat.color.set('#ffffff').multiplyScalar(1.8);
    r.mat.opacity = Math.max(0, 1 - k);
    if (k >= 1) { r.mesh.visible = false; r.passT = -2; }
  }
}

// ------------------------------------------------------------------ Orbs
export class Orbs {
  readonly collected: boolean[];
  readonly hidden: boolean[];
  /** Current 0..1 proximity visibility factor per orb (0 beyond ORB_VISIBLE_FAR). */
  readonly visibility: Float32Array;
  private inst: THREE.InstancedMesh;
  private glow: THREE.Points;
  private glowPos: Float32Array;
  private glowCol: Float32Array;
  private live: Float32Array;
  private magnet: Uint8Array;
  private readonly coreBaseCol = new THREE.Color('#fff2a6').multiplyScalar(1.95);
  private readonly glowBaseCol = new THREE.Color('#ffcf55').multiplyScalar(1.25);
  private readonly tmpCol = new THREE.Color();
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
    this.visibility = new Float32Array(n);
    this.live = new Float32Array(n * 3);
    this.magnet = new Uint8Array(n);
    defs.forEach((d, i) => { this.live[i * 3] = d.x; this.live[i * 3 + 1] = d.y; this.live[i * 3 + 2] = d.z; });

    const geo = new THREE.TetrahedronGeometry(0.42, 0);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      fog: false,
    });
    this.inst = new THREE.InstancedMesh(geo, mat, n);
    this.inst.frustumCulled = false;
    for (let i = 0; i < n; i++) this.inst.setColorAt(i, this.coreBaseCol);

    this.glowPos = new Float32Array(n * 3);
    this.glowCol = new Float32Array(n * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.glowPos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.glowCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.glow = new THREE.Points(g, new THREE.PointsMaterial({
      map: softGlowTexture(),
      color: 0xffffff,
      vertexColors: true,
      size: 3.4,
      sizeAttenuation: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
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
      const dx = chest.x - x, dy = chest.y - y, dz = chest.z - z;
      const d = Math.hypot(dx, dy, dz);
      if (!off && active) {
        if (d < 5.2) this.magnet[i] = 1;
        if (this.magnet[i]) {
          const sp = Math.min(1, dt * 9);
          x += dx * sp; y += dy * sp; z += dz * sp;
          this.live[i * 3] = x; this.live[i * 3 + 1] = y; this.live[i * 3 + 2] = z;
        }
        if (d < 1.3) { this.collected[i] = true; got.push(i); }
      }
      const hiddenNow = this.collected[i] || this.hidden[i];
      const vis = hiddenNow ? 0 : (this.magnet[i] ? 1 : smoothstep(ORB_VISIBLE_FAR, ORB_VISIBLE_NEAR, d));
      this.visibility[i] = vis;

      const bob = this.magnet[i] ? 0 : Math.sin(t * 2 + i * 1.7) * 0.22;
      this.v.set(x, y + bob, z);
      this.e.set(t * 0.9 + i, t * 1.7 + i, 0);
      this.q.setFromEuler(this.e);
      const visible = vis > 0.002;
      const sc = visible ? (0.22 + 0.78 * vis) * (1 + Math.sin(t * 4 + i) * 0.08) : 0;
      this.s.setScalar(sc);
      this.m.compose(this.v, this.q, this.s);
      this.inst.setMatrixAt(i, this.m);

      if (visible) {
        this.tmpCol.copy(this.coreBaseCol).multiplyScalar(0.22 + 0.78 * vis);
        this.inst.setColorAt(i, this.tmpCol);
        const gv = vis * vis;
        this.glowPos[i * 3] = x;
        this.glowPos[i * 3 + 1] = y + bob;
        this.glowPos[i * 3 + 2] = z;
        this.glowCol[i * 3] = this.glowBaseCol.r * gv;
        this.glowCol[i * 3 + 1] = this.glowBaseCol.g * gv;
        this.glowCol[i * 3 + 2] = this.glowBaseCol.b * gv;
      } else {
        this.tmpCol.setRGB(0, 0, 0);
        this.inst.setColorAt(i, this.tmpCol);
        this.glowPos[i * 3] = x;
        this.glowPos[i * 3 + 1] = -9999;
        this.glowPos[i * 3 + 2] = z;
        this.glowCol[i * 3] = 0;
        this.glowCol[i * 3 + 1] = 0;
        this.glowCol[i * 3 + 2] = 0;
      }
    }
    this.inst.instanceMatrix.needsUpdate = true;
    if (this.inst.instanceColor) this.inst.instanceColor.needsUpdate = true;
    this.glow.geometry.attributes.position.needsUpdate = true;
    this.glow.geometry.attributes.color.needsUpdate = true;
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
    if (best) courses.push(new RingCourse(courses.length, COURSE_NAMES[courses.length], new THREE.Vector3(p.x, p.h, p.z), best));
  }
  for (const c of courses) {
    c.rewardOrb = defs.length;
    defs.push({ x: c.end.x, y: c.end.y, z: c.end.z, kind: 'reward' });
  }

  return { orbs: new Orbs(defs), updrafts, courses };
}
