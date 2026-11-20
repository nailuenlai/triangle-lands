import * as THREE from 'three';
import { Terrain, SEG, HALF, WATER_LEVEL, WORLD_SIZE } from './terrain';
import { mulberry32, Simplex2 } from './noise';

export const TOWER_H = 34;
export const REVEAL_RADIUS = 150;
export const START_POS = { x: 10, z: 70 };

export interface TowerDef { name: string; x: number; z: number; }

/** Hand-placed landmarks. Spread so each tower's summit shows the next beacon. */
export const TOWER_DEFS: TowerDef[] = [
  { name: '初始之塔', x: 0, z: -95 },
  { name: '西嶺之塔', x: -195, z: -40 },
  { name: '東崖之塔', x: 175, z: -140 },
  { name: '南湖之塔', x: 150, z: 150 },
  { name: '霧林之塔', x: -130, z: 185 },
  { name: '北境之塔', x: -20, z: -235 },
];

export const COLORS = {
  skyTop: new THREE.Color('#5d9fd6'),
  horizon: new THREE.Color('#cfe3ea'),
  inactive: new THREE.Color('#ff9a3c'),
  active: new THREE.Color('#4fe3ff'),
};

// ---------------------------------------------------------------- Sky
export function createSky(sunDir: THREE.Vector3): THREE.Mesh {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      top: { value: COLORS.skyTop },
      horizon: { value: COLORS.horizon },
      sunDir: { value: sunDir.clone().normalize() },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 top; uniform vec3 horizon; uniform vec3 sunDir;
      varying vec3 vDir;
      void main() {
        float h = vDir.y;
        vec3 c = mix(horizon, top, pow(clamp(h, 0.0, 1.0), 0.55));
        float sun = max(dot(normalize(vDir), sunDir), 0.0);
        c += vec3(1.0, 0.85, 0.6) * (pow(sun, 8.0) * 0.25 + pow(sun, 600.0) * 2.0);
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1200, 32, 16), mat);
  mesh.renderOrder = -1;
  mesh.frustumCulled = false;
  return mesh;
}

// ---------------------------------------------------------------- Terrain mesh
export function createTerrainMesh(terrain: Terrain): THREE.Mesh {
  const N = SEG + 1;
  const H = terrain.heights;
  const step = terrain.step;
  const tri = SEG * SEG * 2;
  const pos = new Float32Array(tri * 9);
  const col = new Float32Array(tri * 9);
  const rand = mulberry32(3);
  const varN = new Simplex2(77);

  const sand = new THREE.Color('#dccb93');
  const grassA = new THREE.Color('#86b04f');
  const grassB = new THREE.Color('#5f9440');
  const alpine = new THREE.Color('#8c9a5b');
  const rock = new THREE.Color('#8b8377');
  const rockDark = new THREE.Color('#6d665e');
  const snow = new THREE.Color('#f3f5f6');
  const c = new THREE.Color();
  const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3();
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), nrm = new THREE.Vector3();

  let p = 0;
  const pushTri = (ax: number, az: number, ah: number, bx: number, bz: number, bh: number, cx: number, cz: number, ch: number) => {
    va.set(ax, ah, az); vb.set(bx, bh, bz); vc.set(cx, ch, cz);
    e1.subVectors(vb, va); e2.subVectors(vc, va);
    nrm.crossVectors(e1, e2).normalize();
    const avg = (ah + bh + ch) / 3;
    const mx = (ax + bx + cx) / 3, mz = (az + bz + cz) / 3;
    const ny = nrm.y;

    if (avg < WATER_LEVEL + 1.2) c.copy(sand);
    else if (ny < 0.7) c.copy(rock).lerp(rockDark, rand() * 0.6);
    else if (avg > 64 && ny > 0.78) c.copy(snow);
    else if (avg > 44) c.copy(alpine).lerp(rock, Math.min(1, (avg - 44) / 22));
    else {
      const v = varN.noise(mx * 0.02, mz * 0.02) * 0.5 + 0.5;
      c.copy(grassA).lerp(grassB, v);
      if (ny < 0.82) c.lerp(rock, 0.35);
    }
    const j = 0.94 + rand() * 0.1;
    c.multiplyScalar(j);

    pos.set([ax, ah, az, bx, bh, bz, cx, ch, cz], p);
    col.set([c.r, c.g, c.b, c.r, c.g, c.b, c.r, c.g, c.b], p);
    p += 9;
  };

  for (let j = 0; j < SEG; j++) {
    for (let i = 0; i < SEG; i++) {
      const x0 = -HALF + i * step, x1 = x0 + step;
      const z0 = -HALF + j * step, z1 = z0 + step;
      const a = H[j * N + i], b = H[j * N + i + 1];
      const cc = H[(j + 1) * N + i], d = H[(j + 1) * N + i + 1];
      pushTri(x0, z0, a, x0, z1, cc, x1, z0, b);
      pushTri(x1, z0, b, x0, z1, cc, x1, z1, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  return new THREE.Mesh(geo, mat);
}

export function createWater(): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(2400, 2400, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshLambertMaterial({
    color: '#3f93b5', transparent: true, opacity: 0.82,
  });
  const m = new THREE.Mesh(geo, mat);
  m.position.y = WATER_LEVEL;
  return m;
}

// ---------------------------------------------------------------- Vegetation
export function createVegetation(terrain: Terrain, avoid: { x: number; z: number; r: number }[]): THREE.Group {
  const group = new THREE.Group();
  const rand = mulberry32(11);
  const forest = new Simplex2(5);

  const pineGeo = new THREE.ConeGeometry(1.7, 5, 6);
  pineGeo.translate(0, 3.6, 0);
  const roundGeo = new THREE.IcosahedronGeometry(1.9, 0);
  roundGeo.translate(0, 3.2, 0);
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.34, 1.6, 5);
  trunkGeo.translate(0, 0.8, 0);
  const rockGeo = new THREE.DodecahedronGeometry(1, 0);

  const matFlat = new THREE.MeshLambertMaterial({ flatShading: true });
  const MAX = 1400;
  const pines = new THREE.InstancedMesh(pineGeo, matFlat, MAX);
  const rounds = new THREE.InstancedMesh(roundGeo, matFlat, MAX);
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshLambertMaterial({ color: '#6b4a32', flatShading: true }), MAX * 2);
  const rocks = new THREE.InstancedMesh(rockGeo, new THREE.MeshLambertMaterial({ color: '#9a948a', flatShading: true }), 260);

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const v = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const c = new THREE.Color();
  let np = 0, nr = 0, nt = 0, nk = 0;

  const blocked = (x: number, z: number) => avoid.some((a) => Math.hypot(x - a.x, z - a.z) < a.r);

  for (let k = 0; k < 9000 && (np < MAX || nr < MAX); k++) {
    const x = (rand() - 0.5) * WORLD_SIZE * 0.92;
    const z = (rand() - 0.5) * WORLD_SIZE * 0.92;
    const h = terrain.height(x, z);
    if (h < WATER_LEVEL + 1.6 || h > 58) continue;
    if (terrain.flatness(x, z) < 0.86) continue;
    if (forest.noise(x * 0.012, z * 0.012) < 0.05 + rand() * 0.25) continue;
    if (blocked(x, z)) continue;

    const sc = 0.7 + rand() * 0.7;
    q.setFromAxisAngle(up, rand() * Math.PI * 2);
    s.set(sc, sc * (0.85 + rand() * 0.4), sc);
    v.set(x, h - 0.2, z);
    m.compose(v, q, s);
    const usePine = h > 26 || rand() < 0.35;
    if (usePine && np < MAX) {
      pines.setMatrixAt(np, m);
      c.setHSL(0.3 + rand() * 0.05, 0.42, 0.24 + rand() * 0.08);
      pines.setColorAt(np++, c);
    } else if (!usePine && nr < MAX) {
      rounds.setMatrixAt(nr, m);
      c.setHSL(0.2 + rand() * 0.08, 0.5, 0.35 + rand() * 0.1);
      rounds.setColorAt(nr++, c);
    } else continue;
    trunks.setMatrixAt(nt++, m);
  }

  for (let k = 0; k < 4000 && nk < 260; k++) {
    const x = (rand() - 0.5) * WORLD_SIZE * 0.9;
    const z = (rand() - 0.5) * WORLD_SIZE * 0.9;
    const h = terrain.height(x, z);
    if (h < WATER_LEVEL || blocked(x, z)) continue;
    const f = terrain.flatness(x, z);
    if (f > 0.9 && rand() < 0.8) continue;
    const sc = 0.6 + rand() * 2.2;
    q.setFromEuler(new THREE.Euler(rand() * 3, rand() * 3, rand() * 3));
    s.set(sc * (0.8 + rand() * 0.6), sc * (0.5 + rand() * 0.5), sc * (0.8 + rand() * 0.6));
    v.set(x, h, z);
    m.compose(v, q, s);
    rocks.setMatrixAt(nk++, m);
  }

  pines.count = np; rounds.count = nr; trunks.count = nt; rocks.count = nk;
  [pines, rounds, trunks, rocks].forEach((im) => {
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.computeBoundingSphere();
    group.add(im);
  });
  return group;
}

// ---------------------------------------------------------------- Clouds
export function createClouds(): THREE.Group {
  const g = new THREE.Group();
  const rand = mulberry32(29);
  const geo = new THREE.IcosahedronGeometry(1, 0);
  const mat = new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true, transparent: true, opacity: 0.92 });
  for (let i = 0; i < 18; i++) {
    const cloud = new THREE.Group();
    const puffs = 3 + Math.floor(rand() * 4);
    for (let k = 0; k < puffs; k++) {
      const p = new THREE.Mesh(geo, mat);
      const sc = 6 + rand() * 8;
      p.scale.set(sc * 1.4, sc * 0.7, sc);
      p.position.set((k - puffs / 2) * 9 + rand() * 4, rand() * 3, rand() * 6);
      cloud.add(p);
    }
    cloud.position.set((rand() - 0.5) * 900, 120 + rand() * 50, (rand() - 0.5) * 900);
    cloud.userData.speed = 2 + rand() * 3;
    g.add(cloud);
  }
  return g;
}

// ---------------------------------------------------------------- Towers
function radialTexture(): THREE.Texture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const ctx = cv.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
let glowTex: THREE.Texture | null = null;

export class Tower {
  readonly group = new THREE.Group();
  readonly base: number;
  readonly top: number;
  discovered = false;
  activated = false;
  private crystal: THREE.Mesh;
  private crystalMat: THREE.MeshBasicMaterial;
  private glow: THREE.Sprite;
  private beamMat: THREE.ShaderMaterial;
  private ring: THREE.Mesh;
  private ringT = -1;

  constructor(public def: TowerDef, public index: number, baseY: number) {
    this.base = baseY;
    this.top = baseY + TOWER_H + 0.4;
    const stone = new THREE.MeshLambertMaterial({ color: '#77716a', flatShading: true });
    const dark = new THREE.MeshLambertMaterial({ color: '#4d4a46', flatShading: true });
    this.group.position.set(def.x, baseY, def.z);

    const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(6, 7, 1.5, 8), dark);
    pedestal.position.y = 0.75;
    this.group.add(pedestal);

    // Four splayed legs.
    const legGeo = new THREE.BoxGeometry(0.8, 0.8, 1);
    const corners = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
    for (const [sx, sz] of corners) {
      const a = new THREE.Vector3(sx * 4.2, 0, sz * 4.2);
      const b = new THREE.Vector3(sx * 2.2, TOWER_H, sz * 2.2);
      const leg = new THREE.Mesh(legGeo, stone);
      leg.position.copy(a).add(b).multiplyScalar(0.5);
      leg.scale.z = a.distanceTo(b);
      leg.lookAt(b.clone().add(this.group.position));
      this.group.add(leg);
    }
    // Ring frames.
    for (let k = 1; k <= 4; k++) {
      const y = (TOWER_H * k) / 5;
      const half = 4.2 - (2.0 * y) / TOWER_H;
      for (let side = 0; side < 4; side++) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(half * 2 + 0.8, 0.5, 0.5), dark);
        const ang = (side * Math.PI) / 2;
        bar.position.set(Math.sin(ang) * half, y, Math.cos(ang) * half);
        bar.rotation.y = ang;
        this.group.add(bar);
      }
    }
    // Central spine.
    const spine = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.4, TOWER_H, 6), dark);
    spine.position.y = TOWER_H / 2;
    this.group.add(spine);
    // Platform.
    const plat = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 3.8, 0.8, 8), stone);
    plat.position.y = TOWER_H;
    this.group.add(plat);

    this.crystalMat = new THREE.MeshBasicMaterial({ color: COLORS.inactive.clone(), fog: false });
    this.crystal = new THREE.Mesh(new THREE.OctahedronGeometry(1.4, 0), this.crystalMat);
    this.crystal.position.y = TOWER_H + 3.2;
    this.crystal.scale.y = 1.6;
    this.group.add(this.crystal);

    glowTex ??= radialTexture();
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color: COLORS.inactive.clone(), blending: THREE.AdditiveBlending,
      depthWrite: false, fog: false, transparent: true,
    }));
    this.glow.scale.setScalar(14);
    this.glow.position.y = TOWER_H + 3.2;
    this.group.add(this.glow);

    // Beam of light: the long-range lure. Depth-tested, so ridges hide it.
    const beamGeo = new THREE.CylinderGeometry(1.1, 1.1, 90, 12, 1, true);
    beamGeo.translate(0, 45, 0);
    this.beamMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
      uniforms: { color: { value: COLORS.inactive.clone() }, time: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv; varying vec3 vN; varying vec3 vV;
        void main() {
          vUv = uv;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vN = normalize(normalMatrix * normal);
          vV = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 color; uniform float time;
        varying vec2 vUv; varying vec3 vN; varying vec3 vV;
        void main() {
          float f = pow(abs(dot(normalize(vN), normalize(vV))), 1.5);
          float a = pow(1.0 - vUv.y, 1.4) * f * (0.55 + 0.12 * sin(time * 2.0 + vUv.y * 8.0));
          gl_FragColor = vec4(color, a);
          #include <colorspace_fragment>
        }`,
    });
    const beam = new THREE.Mesh(beamGeo, this.beamMat);
    beam.position.y = TOWER_H + 3;
    beam.frustumCulled = false;
    this.group.add(beam);

    // Activation pulse ring.
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.9, 1, 48),
      new THREE.MeshBasicMaterial({ color: COLORS.active, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = TOWER_H + 1;
    this.ring.visible = false;
    this.group.add(this.ring);
  }

  setActivated(v: boolean) {
    this.activated = v;
    const col = v ? COLORS.active : COLORS.inactive;
    this.crystalMat.color.copy(col);
    this.glow.material.color.copy(col);
    (this.beamMat.uniforms.color.value as THREE.Color).copy(col);
  }

  pulse() { this.ringT = 0; this.ring.visible = true; }

  update(t: number, dt: number, camPos?: THREE.Vector3) {
    this.crystal.rotation.y = t * 0.8;
    this.crystal.position.y = TOWER_H + 3.2 + Math.sin(t * 1.5 + this.index) * 0.3;
    this.glow.position.y = this.crystal.position.y;
    if (camPos) {
      // Fade the crystal when the camera is near so it never blocks the summit view.
      const d = Math.hypot(camPos.x - this.def.x, camPos.y - (this.base + this.crystal.position.y), camPos.z - this.def.z);
      const o = Math.min(1, Math.max(0.08, (d - 8) / 14));
      this.crystalMat.opacity = o;
      this.crystalMat.transparent = o < 1;
      this.glow.material.opacity = o;
    }
    this.beamMat.uniforms.time.value = t;
    if (this.ringT >= 0) {
      this.ringT += dt;
      const k = this.ringT / 2.4;
      const s = 2 + k * 160;
      this.ring.scale.setScalar(s);
      (this.ring.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - k) * 0.9;
      if (k >= 1) { this.ringT = -1; this.ring.visible = false; }
    }
  }
}
