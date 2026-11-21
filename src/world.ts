import * as THREE from 'three';
import { Terrain, SEG, HALF, WATER_LEVEL, WORLD_SIZE, smoothstep } from './terrain';
import { mulberry32, Simplex2 } from './noise';

export const EXPLORE_RADIUS = 28;
export const REVEAL_RADIUS = 150;
export const START_POS = { x: 10, z: 70 };

export interface TowerDef { name: string; x: number; z: number; }

/** Hand-placed ancient shrines nestled across distinct regions of the island. */
export const TOWER_DEFS: TowerDef[] = [
  { name: '初始之碑', x: 0, z: -95 },
  { name: '西嶺之碑', x: -195, z: -40 },
  { name: '東崖之碑', x: 175, z: -140 },
  { name: '南湖之碑', x: 150, z: 150 },
  { name: '霧林之碑', x: -130, z: 185 },
  { name: '北境之碑', x: -20, z: -235 },
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

// ---------------------------------------------------------------- Ancient Resonance Shrines
function radialTexture(): THREE.Texture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const ctx = cv.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.28, 'rgba(255,255,255,0.48)');
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
  readonly pillars: { x: number; z: number; r: number }[] = [];
  discovered = false;
  activated = false;

  private stoneMat: THREE.MeshLambertMaterial;
  private darkMat: THREE.MeshLambertMaterial;
  private mossMat: THREE.MeshLambertMaterial;
  private runeMat: THREE.MeshBasicMaterial;
  private crystal: THREE.Mesh;
  private crystalMat: THREE.MeshBasicMaterial;
  private haloA: THREE.Mesh;
  private haloB: THREE.Mesh;
  private haloMat: THREE.MeshBasicMaterial;
  private glow: THREE.Sprite;
  private wisp: THREE.Mesh;
  private wispMat: THREE.ShaderMaterial;
  private motes: { mesh: THREE.Mesh; phase: number; radius: number; speed: number }[] = [];
  private moteMat: THREE.MeshBasicMaterial;
  private ring: THREE.Mesh;
  private ringT = -1;
  private awakenBoost = 0;

  constructor(public def: TowerDef, public index: number, baseY: number) {
    this.base = baseY;
    this.top = baseY + 0.82; // walkable altar surface height
    this.group.position.set(def.x, baseY, def.z);

    this.stoneMat = new THREE.MeshLambertMaterial({ color: '#7f7d72', flatShading: true });
    this.darkMat = new THREE.MeshLambertMaterial({ color: '#585850', flatShading: true });
    this.mossMat = new THREE.MeshLambertMaterial({ color: '#697a54', flatShading: true });
    this.runeMat = new THREE.MeshBasicMaterial({
      color: COLORS.inactive.clone(), transparent: true, opacity: 0.85, side: THREE.DoubleSide,
    });

    // Two-tier walkable stepped stone circle
    const outerTerrace = new THREE.Mesh(new THREE.CylinderGeometry(5.5, 6.4, 0.42, 9), this.mossMat);
    outerTerrace.position.y = 0.21;
    const innerDais = new THREE.Mesh(new THREE.CylinderGeometry(3.65, 4.3, 0.42, 9), this.stoneMat);
    innerDais.position.y = 0.62;
    this.group.add(outerTerrace, innerDais);

    // Engraved floor rune circle & sacred triangle
    const floorRing = new THREE.Mesh(new THREE.RingGeometry(2.62, 2.82, 36), this.runeMat);
    floorRing.rotation.x = -Math.PI / 2;
    floorRing.position.y = 0.85;
    const floorTri = new THREE.Mesh(new THREE.RingGeometry(1.55, 1.72, 3), this.runeMat);
    floorTri.rotation.x = -Math.PI / 2;
    floorTri.rotation.z = index * 0.5;
    floorTri.position.y = 0.855;
    this.group.add(floorRing, floorTri);

    // Three tilted weathered monoliths arranged in a triangle
    const heights = [5.3, 6.1, 5.65];
    const baseAngle = index * 0.7 + 0.35;
    const pillarR = 3.15;
    for (let k = 0; k < 3; k++) {
      const ang = baseAngle + (k * Math.PI * 2) / 3;
      const px = Math.sin(ang) * pillarR;
      const pz = Math.cos(ang) * pillarR;
      const h = heights[k];

      const holder = new THREE.Group();
      holder.position.set(px, 0.75, pz);
      holder.rotation.y = ang + Math.PI; // +Z faces center of shrine
      holder.rotation.x = 0.14;          // subtle inward lean

      const slabGeo = new THREE.CylinderGeometry(0.34, 0.66, h, 5);
      slabGeo.scale(1.18, 1, 0.74);
      slabGeo.translate(0, h / 2, 0);
      const slab = new THREE.Mesh(slabGeo, k === 1 ? this.darkMat : this.stoneMat);
      holder.add(slab);

      // Glowing vertical rune strip inlaid on the inner face
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.11, h * 0.56, 0.06), this.runeMat);
      strip.position.set(0, h * 0.48, 0.36);
      strip.rotation.x = -0.05;
      holder.add(strip);

      this.group.add(holder);
      this.pillars.push({ x: def.x + px, z: def.z + pz, r: 0.85 });
    }

    // Central carved altar plinth
    const plinth = new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.98, 1.28, 6), this.darkMat);
    plinth.position.y = 0.82 + 0.64;
    this.group.add(plinth);
    this.pillars.push({ x: def.x, z: def.z, r: 1.15 });

    // Floating triangular crystal core
    this.crystalMat = new THREE.MeshBasicMaterial({
      color: COLORS.inactive.clone(), transparent: true, opacity: 1,
    });
    this.crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.76, 0), this.crystalMat);
    this.crystal.position.y = 3.55;
    this.crystal.scale.set(0.95, 1.65, 0.95);
    this.group.add(this.crystal);

    // Interlocking resonance rings around the crystal
    this.haloMat = new THREE.MeshBasicMaterial({
      color: COLORS.inactive.clone(), transparent: true, opacity: 0.72,
    });
    this.haloA = new THREE.Mesh(new THREE.TorusGeometry(1.28, 0.045, 5, 24), this.haloMat);
    this.haloB = new THREE.Mesh(new THREE.TorusGeometry(1.62, 0.036, 5, 24), this.haloMat);
    this.haloA.position.y = 3.55;
    this.haloB.position.y = 3.55;
    this.group.add(this.haloA, this.haloB);

    // Soft ambient radial glow
    glowTex ??= radialTexture();
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color: COLORS.inactive.clone(), blending: THREE.AdditiveBlending,
      depthWrite: false, transparent: true, opacity: 0.85,
    }));
    this.glow.scale.setScalar(7.5);
    this.glow.position.y = 3.55;
    this.group.add(this.glow);

    // Gentle low spirit wisp (only ~13m high, never a sky-piercing beacon)
    const wispGeo = new THREE.CylinderGeometry(0.18, 1.05, 13, 12, 1, true);
    wispGeo.translate(0, 6.5, 0);
    this.wispMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: {
        color: { value: COLORS.inactive.clone() },
        time: { value: 0 },
        fade: { value: 0 },
      },
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
        uniform vec3 color; uniform float time; uniform float fade;
        varying vec2 vUv; varying vec3 vN; varying vec3 vV;
        void main() {
          float f = pow(abs(dot(normalize(vN), normalize(vV))), 1.6);
          float wave = 0.72 + 0.28 * sin(time * 1.8 - vUv.y * 6.0);
          float a = pow(1.0 - vUv.y, 1.9) * smoothstep(0.0, 0.15, vUv.y) * f * wave * 0.42 * fade;
          gl_FragColor = vec4(color, a);
          #include <colorspace_fragment>
        }`,
    });
    this.wisp = new THREE.Mesh(wispGeo, this.wispMat);
    this.wisp.position.y = 2.6;
    this.group.add(this.wisp);

    // Drifting firefly-like light motes rising around the altar
    this.moteMat = new THREE.MeshBasicMaterial({
      color: COLORS.inactive.clone(), transparent: true, opacity: 0.85,
    });
    const moteGeo = new THREE.OctahedronGeometry(0.09, 0);
    const rand = mulberry32(101 + index * 37);
    for (let m = 0; m < 10; m++) {
      const mesh = new THREE.Mesh(moteGeo, this.moteMat);
      this.group.add(mesh);
      this.motes.push({
        mesh,
        phase: rand() * Math.PI * 2,
        radius: 1.2 + rand() * 2.4,
        speed: 0.35 + rand() * 0.4,
      });
    }

    // Resonance pulse wave across the terrain
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.88, 1, 48),
      new THREE.MeshBasicMaterial({
        color: COLORS.active, transparent: true, opacity: 0,
        side: THREE.DoubleSide, depthWrite: false, fog: false, blending: THREE.AdditiveBlending,
      }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 1.05;
    this.ring.visible = false;
    this.group.add(this.ring);
  }

  setActivated(v: boolean) {
    this.activated = v;
    const col = v ? COLORS.active : COLORS.inactive;
    this.crystalMat.color.copy(col);
    this.runeMat.color.copy(col);
    this.haloMat.color.copy(col);
    this.moteMat.color.copy(col);
    this.glow.material.color.copy(col);
    (this.wispMat.uniforms.color.value as THREE.Color).copy(col);
  }

  pulse() {
    this.ringT = 0;
    this.ring.visible = true;
    this.awakenBoost = 1;
  }

  update(t: number, dt: number, playerPos: THREE.Vector3, inTitle = false) {
    const dist = Math.hypot(playerPos.x - this.def.x, playerPos.z - this.def.z);

    // Proximity emergence: hidden in distant wilderness, materializing out of the mist up close
    const stoneFade = inTitle && !this.activated
      ? 0
      : this.activated
        ? smoothstep(185, 128, dist)
        : smoothstep(116, 76, dist);

    const glowFade = inTitle && !this.activated
      ? 0
      : this.activated
        ? smoothstep(155, 92, dist)
        : smoothstep(96, 52, dist);

    this.group.visible = stoneFade > 0.005 || this.ringT >= 0;
    if (!this.group.visible) return;

    for (const m of [this.stoneMat, this.darkMat, this.mossMat]) {
      m.transparent = stoneFade < 0.995;
      m.opacity = stoneFade;
      m.depthWrite = stoneFade > 0.45;
    }

    const nearBoost = smoothstep(12, 4, dist);
    this.awakenBoost = Math.max(0, this.awakenBoost - dt * 0.45);
    const spin = 0.65 + nearBoost * 0.9 + this.awakenBoost * 2.8 + (this.activated ? 0.35 : 0);

    const cy = 3.55 + Math.sin(t * 1.6 + this.index) * 0.22 + this.awakenBoost * 0.45;
    this.crystal.rotation.y += dt * spin;
    this.crystal.position.y = cy;

    this.haloA.position.y = cy;
    this.haloB.position.y = cy;
    this.haloA.rotation.x = 0.65 + Math.sin(t * 0.7 + this.index) * 0.25;
    this.haloA.rotation.y = t * (0.5 * spin);
    this.haloB.rotation.x = -0.55 + Math.cos(t * 0.55 + this.index) * 0.25;
    this.haloB.rotation.z = t * (0.38 * spin);

    this.glow.position.y = cy;
    this.glow.scale.setScalar(6.8 + nearBoost * 1.8 + this.awakenBoost * 4.0);

    const lumVisible = glowFade > 0.005;
    this.crystal.visible = lumVisible;
    this.haloA.visible = lumVisible;
    this.haloB.visible = lumVisible;
    this.glow.visible = lumVisible;
    this.wisp.visible = lumVisible;

    this.crystalMat.opacity = glowFade * 0.95;
    this.haloMat.opacity = glowFade * (0.55 + nearBoost * 0.3);
    this.runeMat.opacity = stoneFade * (0.25 + glowFade * 0.7);
    this.glow.material.opacity = glowFade * (0.65 + nearBoost * 0.25);
    this.moteMat.opacity = glowFade * 0.85;

    this.wispMat.uniforms.time.value = t;
    this.wispMat.uniforms.fade.value = glowFade * (this.activated ? 0.75 : 1.0);

    for (let i = 0; i < this.motes.length; i++) {
      const m = this.motes[i];
      m.mesh.visible = lumVisible;
      if (!lumVisible) continue;
      const p = ((t * m.speed + m.phase) % (Math.PI * 2)) / (Math.PI * 2); // 0..1
      const ang = m.phase + t * 0.35 + p * 1.8;
      const r = m.radius * (1 - p * 0.35);
      m.mesh.position.set(Math.cos(ang) * r, 1.0 + p * 5.6, Math.sin(ang) * r);
      const s = Math.sin(p * Math.PI) * (0.8 + nearBoost * 0.5);
      m.mesh.scale.setScalar(Math.max(0.01, s));
    }

    if (this.ringT >= 0) {
      this.ringT += dt;
      const k = this.ringT / 2.5;
      const s = 2 + k * 155;
      this.ring.scale.setScalar(s);
      (this.ring.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - k) * 0.88;
      if (k >= 1) { this.ringT = -1; this.ring.visible = false; }
    }
  }
}
