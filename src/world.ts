import * as THREE from 'three';
import { Terrain, SEG, HALF, WATER_LEVEL, WORLD_SIZE, smoothstep } from './terrain';
import { mulberry32, Simplex2 } from './noise';
import {
  BOTW_PALETTE,
  CEL_SAFE_MATH_GLSL,
  celUniforms,
  createCelMaterial,
  createCloudMaterial,
  createGrassMaterial,
  createTerrainMaterial,
  createWaterMaterial,
} from './cel';

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
  skyTop: BOTW_PALETTE.skyZenith,
  horizon: BOTW_PALETTE.skyHorizon,
  inactive: BOTW_PALETTE.inactive,
  active: BOTW_PALETTE.active,
};

// ---------------------------------------------------------------- Geometry helpers
function mergeGeometries(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const expanded = geos.map((g) => (g.index ? g.toNonIndexed() : g));
  let totalVerts = 0;
  let hasUv = true;
  for (const g of expanded) {
    totalVerts += g.attributes.position.count;
    if (!g.attributes.uv) hasUv = false;
  }
  const pos = new Float32Array(totalVerts * 3);
  const nrm = new Float32Array(totalVerts * 3);
  const uv = hasUv ? new Float32Array(totalVerts * 2) : null;

  let offset = 0;
  for (const g of expanded) {
    if (!g.attributes.normal) g.computeVertexNormals();
    const pAttr = g.attributes.position as THREE.BufferAttribute;
    const nAttr = g.attributes.normal as THREE.BufferAttribute;
    pos.set(pAttr.array as Float32Array, offset * 3);
    nrm.set(nAttr.array as Float32Array, offset * 3);
    if (uv && g.attributes.uv) {
      uv.set((g.attributes.uv as THREE.BufferAttribute).array as Float32Array, offset * 2);
    }
    offset += pAttr.count;
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  if (uv) merged.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return merged;
}

/**
 * Recomputes smooth radial normals pointing outward from a foliage center
 * with gentle upward lift — gives stylized canopies a soft painted Ghibli/BotW volume.
 */
function applyRadialFoliageNormals(geo: THREE.BufferGeometry, centerY: number, upBias = 0.45, blend = 0.78) {
  geo.computeVertexNormals();
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const nrm = geo.attributes.normal as THREE.BufferAttribute;
  const r = new THREE.Vector3();
  const o = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    r.set(pos.getX(i), pos.getY(i) - centerY, pos.getZ(i));
    r.y += upBias;
    if (r.lengthSq() > 1e-5) r.normalize();
    o.set(nrm.getX(i), nrm.getY(i), nrm.getZ(i));
    o.lerp(r, blend).normalize();
    nrm.setXYZ(i, o.x, o.y, o.z);
  }
  nrm.needsUpdate = true;
}

function buildPineCanopyGeo(): THREE.BufferGeometry {
  const c1 = new THREE.ConeGeometry(1.95, 2.55, 7, 1, true);
  c1.translate(0, 2.35, 0);
  const c2 = new THREE.ConeGeometry(1.52, 2.35, 7, 1, true);
  c2.rotateY(0.45);
  c2.translate(0, 3.65, 0);
  const c3 = new THREE.ConeGeometry(1.02, 2.15, 6, 1, true);
  c3.rotateY(0.9);
  c3.translate(0, 4.95, 0);
  const geo = mergeGeometries([c1, c2, c3]);
  applyRadialFoliageNormals(geo, 3.2, 0.55, 0.62);
  return geo;
}

function buildBroadleafCanopyGeo(): THREE.BufferGeometry {
  const puffs: THREE.BufferGeometry[] = [];
  const specs: [number, number, number, number, number][] = [
    [0, 3.6, 0, 1.58, 1.32],
    [0.95, 3.05, 0.45, 1.15, 0.98],
    [-0.92, 3.1, 0.35, 1.18, 1.0],
    [0.08, 3.02, -0.9, 1.16, 0.96],
  ];
  for (const [x, y, z, rx, ry] of specs) {
    const g = new THREE.SphereGeometry(1, 7, 5);
    g.scale(rx, ry, rx);
    g.translate(x, y, z);
    puffs.push(g);
  }
  const geo = mergeGeometries(puffs);
  applyRadialFoliageNormals(geo, 3.25, 0.68, 0.88);
  return geo;
}

function buildGrassTuftGeo(): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const blades: [number, number, number, number, number, number][] = [
    // [offsetX, offsetZ, yaw, halfWidth, height, lean]
    [0.0, 0.0, 0.0, 0.10, 0.56, 0.16],
    [0.19, 0.09, 1.25, 0.095, 0.48, 0.18],
    [-0.17, 0.14, 2.55, 0.095, 0.52, 0.17],
    [0.08, -0.18, 3.85, 0.09, 0.44, 0.15],
    [-0.14, -0.12, 5.15, 0.09, 0.49, 0.16],
  ];
  for (const [ox, oz, yaw, w, h, lean] of blades) {
    const cx = Math.cos(yaw), sz = Math.sin(yaw);
    const rx = cx * w, rz = sz * w;
    const fx = -sz * lean, fz = cx * lean;
    positions.push(
      ox - rx, 0, oz - rz,
      ox + rx, 0, oz + rz,
      ox + fx, h, oz + fz,
    );
    uvs.push(0, 0, 1, 0, 0.5, 1.0);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.computeVertexNormals();
  return geo;
}

function buildWildflowerGeo(): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  // Cluster of 3 tiny watercolor blossoms nestled in the grass
  const spots: [number, number, number, number][] = [
    [0.0, 0.0, 0.11, 0.42],
    [0.24, 0.16, 0.09, 0.36],
    [-0.20, 0.18, 0.095, 0.38],
  ];
  for (const [ox, oz, r, y] of spots) {
    for (let k = 0; k < 2; k++) {
      const a = (k * Math.PI) / 2 + ox * 5.0;
      const dx = Math.cos(a) * r, dz = Math.sin(a) * r;
      positions.push(
        ox - dx, y - 0.11, oz - dz,
        ox + dx, y - 0.11, oz + dz,
        ox, y + 0.06, oz,
      );
      uvs.push(0, 0.72, 1, 0.72, 0.5, 1.0);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.computeVertexNormals();
  return geo;
}

// ---------------------------------------------------------------- Sky
export function createSky(sunDir: THREE.Vector3): THREE.Mesh {
  celUniforms.uSunDir.value.copy(sunDir).normalize();
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uTime: celUniforms.uTime,
      uZenith: celUniforms.uSkyZenith,
      uMid: celUniforms.uSkyMid,
      uHorizon: celUniforms.uSkyHorizon,
      uSunHaze: celUniforms.uSunHaze,
      uSunDir: celUniforms.uSunDir,
      uMoonDir: celUniforms.uMoonDir,
      uNightFactor: celUniforms.uNightFactor,
      uSunsetFactor: celUniforms.uSunsetFactor,
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uZenith;
      uniform vec3 uMid;
      uniform vec3 uHorizon;
      uniform vec3 uSunHaze;
      uniform vec3 uSunDir;
      uniform vec3 uMoonDir;
      uniform float uNightFactor;
      uniform float uSunsetFactor;
      varying vec3 vDir;
      ${CEL_SAFE_MATH_GLSL}

      float skyHash(vec2 p) {
        p = fract(p * vec2(234.34, 435.345));
        p += dot(p, p + 34.23);
        return fract(p.x * p.y);
      }

      void main() {
        vec3 d = safeNormalize(vDir);
        float h = clamp(d.y, 0.0, 1.0);

        // Three-band BotW sky gradient (adapts smoothly across dawn, day, sunset & night)
        vec3 c = mix(uHorizon, uMid, smoothstep(0.0, 0.28, h));
        c = mix(c, uZenith, smoothstep(0.22, 0.82, h));

        // Warm sunset / dawn horizon scatter toward the sun
        float sunDot = clamp(dot(d, uSunDir), 0.0, 1.0);
        float sunAbove = smoothstep(-0.14, 0.08, uSunDir.y);
        float horizonMask = smoothstep(0.52, 0.0, h);
        c = mix(c, uSunHaze, sunDot * sunDot * sunDot * (0.32 + 0.42 * horizonMask) * sunAbove);

        // Extra warm painterly glow ribbon along the horizon at dawn & golden hour
        c += uSunHaze * safePow(horizonMask, 2.4) * uSunsetFactor * 0.22;

        // Crisp HDR anime sun disc + gentle painterly aura (triggers Selective Soft Bloom)
        float aura = safePow(sunDot, 20.0) * (0.38 + 0.26 * uSunsetFactor) * sunAbove;
        float disc = smoothstep(0.9970, 0.9990, sunDot) * 1.95 * smoothstep(-0.04, 0.06, uSunDir.y);
        vec3 sunTint = mix(vec3(1.0, 0.95, 0.80), vec3(1.0, 0.72, 0.42), uSunsetFactor * 0.85);
        c += sunTint * (aura + disc);

        // Luminous Anime Moon + soft cerulean lunar halo
        float moonDot = clamp(dot(d, uMoonDir), 0.0, 1.0);
        float moonAbove = smoothstep(-0.08, 0.08, uMoonDir.y);
        float moonVis = uNightFactor * moonAbove;
        float moonHalo = (safePow(moonDot, 10.0) * 0.16 + safePow(moonDot, 64.0) * 0.42) * moonVis;
        float moonDisc = smoothstep(0.9978, 0.9988, moonDot) * moonVis;
        // Subtle painterly mare shading inside the moon disc
        float moonTex = 0.88 + 0.12 * sin(d.x * 90.0 + d.z * 70.0) * cos(d.y * 85.0);
        c += vec3(0.68, 0.84, 1.0) * moonHalo;
        c += vec3(1.28, 1.38, 1.52) * moonDisc * moonTex;

        // Starry night sky + delicate Milky Way shimmer
        if (uNightFactor > 0.04 && h > 0.03) {
          float starFade = smoothstep(0.04, 0.34, h) * smoothstep(0.08, 0.72, uNightFactor);
          // Subtle diagonal watercolor Milky Way band
          float mwAxis = abs(d.x * 0.58 + d.z * 0.62 - d.y * 0.52);
          float mwBand = exp(-mwAxis * mwAxis * 16.0) * starFade;
          c += vec3(0.11, 0.17, 0.30) * mwBand * 0.65;

          // Multi-layer crisp twinkling stars (projected onto upper dome)
          vec2 domeUv = d.xz / (d.y + 0.32);
          vec2 g1 = floor(domeUv * 125.0);
          vec2 f1 = fract(domeUv * 125.0) - 0.5;
          float h1 = skyHash(g1);
          float s1 = step(0.986, h1) * smoothstep(0.32, 0.05, length(f1));
          float tw1 = 0.55 + 0.45 * sin(uTime * (1.8 + fract(h1 * 71.0) * 3.2) + h1 * 90.0);

          vec2 g2 = floor(domeUv * 68.0 + 17.3);
          vec2 f2 = fract(domeUv * 68.0 + 17.3) - 0.5;
          float h2 = skyHash(g2);
          float s2 = step(0.992, h2) * smoothstep(0.28, 0.04, length(f2));
          float tw2 = 0.65 + 0.35 * sin(uTime * (1.3 + fract(h2 * 53.0) * 2.5) + h2 * 60.0);

          vec3 starTint1 = mix(vec3(0.78, 0.88, 1.0), vec3(1.0, 0.93, 0.78), fract(h1 * 37.0));
          vec3 starTint2 = mix(vec3(0.82, 0.92, 1.0), vec3(1.0, 0.88, 0.70), fract(h2 * 29.0));
          c += (starTint1 * s1 * tw1 * 0.95 + starTint2 * s2 * tw2 * 1.45) * starFade * (1.0 - moonDisc);
        }

        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1200, 32, 20), mat);
  mesh.renderOrder = -1;
  mesh.frustumCulled = false;
  return mesh;
}

// ---------------------------------------------------------------- Terrain mesh
export function createTerrainMesh(terrain: Terrain): THREE.Mesh {
  const N = SEG + 1;
  const H = terrain.heights;
  const step = terrain.step;

  // Indexed smooth-normal mesh with identical triangle diagonals to terrain.height()
  const pos = new Float32Array(N * N * 3);
  for (let j = 0; j < N; j++) {
    const z = -HALF + j * step;
    for (let i = 0; i < N; i++) {
      const idx = j * N + i;
      pos[idx * 3] = -HALF + i * step;
      pos[idx * 3 + 1] = H[idx];
      pos[idx * 3 + 2] = z;
    }
  }

  const indices = new Uint32Array(SEG * SEG * 6);
  let k = 0;
  for (let j = 0; j < SEG; j++) {
    for (let i = 0; i < SEG; i++) {
      const a = j * N + i;
      const b = a + 1;
      const c = (j + 1) * N + i;
      const d = c + 1;
      indices[k++] = a; indices[k++] = c; indices[k++] = b;
      indices[k++] = b; indices[k++] = c; indices[k++] = d;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.computeVertexNormals();

  const mesh = new THREE.Mesh(geo, createTerrainMaterial());
  mesh.receiveShadow = true;
  return mesh;
}

export function createWater(terrain: Terrain): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(2400, 2400, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(geo, createWaterMaterial(terrain));
  m.position.y = WATER_LEVEL;
  m.renderOrder = 1;
  return m;
}

// ---------------------------------------------------------------- Vegetation
export function createVegetation(terrain: Terrain, avoid: { x: number; z: number; r: number }[]): THREE.Group {
  const group = new THREE.Group();
  const rand = mulberry32(11);
  const forest = new Simplex2(5);

  const pineGeo = buildPineCanopyGeo();
  const roundGeo = buildBroadleafCanopyGeo();
  const trunkGeo = new THREE.CylinderGeometry(0.18, 0.34, 2.0, 7);
  trunkGeo.translate(0, 1.0, 0);
  const rockGeo = new THREE.DodecahedronGeometry(1, 0);

  const pineMat = createCelMaterial({
    shadowTint: '#3f6496',
    rimStrength: 0.42,
    rimPower: 2.6,
    stepLow: -0.04,
    stepHigh: 0.16,
    highlight: 0.16,
    wind: { amp: 0.13, freq: 1.5, heightOffset: 1.4 },
    cacheKey: 'cel_pine_v2',
  });
  const roundMat = createCelMaterial({
    shadowTint: '#436996',
    rimStrength: 0.46,
    rimPower: 2.5,
    stepLow: -0.05,
    stepHigh: 0.18,
    highlight: 0.20,
    wind: { amp: 0.16, freq: 1.7, heightOffset: 1.6 },
    cacheKey: 'cel_broadleaf_v2',
  });
  const trunkMat = createCelMaterial({
    color: '#73533a',
    shadowTint: '#4e5d85',
    rimStrength: 0.18,
    cacheKey: 'cel_trunk_v2',
  });
  const rockMat = createCelMaterial({
    color: '#9c9385',
    flatShading: true,
    shadowTint: '#526b96',
    rimStrength: 0.28,
    mossTop: 0.56,
    cacheKey: 'cel_rock_v2',
  });

  const MAX = 1400;
  const pines = new THREE.InstancedMesh(pineGeo, pineMat, MAX);
  const rounds = new THREE.InstancedMesh(roundGeo, roundMat, MAX);
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, MAX * 2);
  const rocks = new THREE.InstancedMesh(rockGeo, rockMat, 260);

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

    const sc = 0.72 + rand() * 0.68;
    q.setFromAxisAngle(up, rand() * Math.PI * 2);
    s.set(sc, sc * (0.86 + rand() * 0.36), sc);
    v.set(x, h - 0.22, z);
    m.compose(v, q, s);
    const usePine = h > 26 || rand() < 0.35;
    if (usePine && np < MAX) {
      pines.setMatrixAt(np, m);
      // Rich emerald alpine pine palette
      c.setHSL(0.34 + rand() * 0.06, 0.52, 0.22 + rand() * 0.08);
      pines.setColorAt(np++, c);
    } else if (!usePine && nr < MAX) {
      rounds.setMatrixAt(nr, m);
      // Vivid BotW sunlit canopy greens + occasional warm golden & blossom accents
      const accent = rand();
      if (accent < 0.09) {
        c.setHSL(0.11 + rand() * 0.04, 0.68, 0.44 + rand() * 0.06); // sunlit golden-amber tree
      } else if (accent < 0.13) {
        c.setHSL(0.95 + rand() * 0.04, 0.52, 0.68 + rand() * 0.05); // soft sakura blossom accent
      } else {
        c.setHSL(0.24 + rand() * 0.08, 0.60, 0.30 + rand() * 0.10);
      }
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
    im.castShadow = true;
    im.receiveShadow = true;
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.computeBoundingSphere();
    group.add(im);
  });

  return group;
}

// ---------------------------------------------------------------- Dynamic BotW Grass & Wildflowers
function cellHash(ix: number, iz: number, salt: number): number {
  let h = Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(salt, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * World-anchored toroidal meadow patch following the viewer (~75m x 75m dense grass
 * carpet + clustered watercolor wildflowers). Each world grid cell hashes deterministically
 * so blades stay planted on the ground while only newly entered border cells update.
 */
export class DynamicGrassField {
  readonly group = new THREE.Group();
  private readonly grass: THREE.InstancedMesh;
  private readonly flowers: THREE.InstancedMesh;
  private readonly meadow = new Simplex2(31);
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();
  private readonly v = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly c = new THREE.Color();

  private static readonly GRID = 58;
  private static readonly STEP = 1.25;
  private static readonly FGRID = 24;
  private static readonly FSTEP = 3.0;

  private lastGx = 1e9;
  private lastGz = 1e9;
  private lastFx = 1e9;
  private lastFz = 1e9;

  private readonly flowerPalette = [
    new THREE.Color('#fffdf0'), // creamy daisy
    new THREE.Color('#ffe054'), // sunlit buttercup
    new THREE.Color('#86d2ff'), // sky forget-me-not
    new THREE.Color('#ffaa90'), // warm peach blossom
  ];

  constructor(private readonly terrain: Terrain) {
    const gMat = createGrassMaterial(false);
    const fMat = createGrassMaterial(true);
    this.grass = new THREE.InstancedMesh(buildGrassTuftGeo(), gMat, DynamicGrassField.GRID ** 2);
    this.flowers = new THREE.InstancedMesh(buildWildflowerGeo(), fMat, DynamicGrassField.FGRID ** 2);
    this.grass.frustumCulled = false;
    this.flowers.frustumCulled = false;
    this.group.add(this.grass, this.flowers);
  }

  private shrineKeepOut(x: number, z: number): boolean {
    for (let i = 0; i < TOWER_DEFS.length; i++) {
      const t = TOWER_DEFS[i];
      const dx = x - t.x, dz = z - t.z;
      if (dx * dx + dz * dz < 6.5 * 6.5) return true;
    }
    return false;
  }

  private fillGrassCell(gx: number, gz: number) {
    const G = DynamicGrassField.GRID;
    const sx = ((gx % G) + G) % G;
    const sz = ((gz % G) + G) % G;
    const idx = sz * G + sx;

    const jx = (cellHash(gx, gz, 1) - 0.5) * 0.92;
    const jz = (cellHash(gx, gz, 2) - 0.5) * 0.92;
    const x = (gx + 0.5 + jx) * DynamicGrassField.STEP;
    const z = (gz + 0.5 + jz) * DynamicGrassField.STEP;

    const rOk = Math.abs(x) < HALF - 8 && Math.abs(z) < HALF - 8;
    const h = rOk ? this.terrain.height(x, z) : -99;
    const flat = rOk && h > WATER_LEVEL + 1.9 && h < 44 ? this.terrain.flatness(x, z) : 0;
    const patch = flat > 0.78 ? this.meadow.noise(x * 0.022, z * 0.022) * 0.5 + 0.5 : 0;
    const keep = flat > 0.78 && !this.shrineKeepOut(x, z) && (patch > 0.22 || cellHash(gx, gz, 3) < 0.35);

    if (!keep) {
      this.m.makeScale(0, 0, 0);
      this.grass.setMatrixAt(idx, this.m);
      return;
    }

    const sc = 0.78 + cellHash(gx, gz, 4) * 0.65;
    const sy = sc * (0.72 + patch * 0.45 + cellHash(gx, gz, 5) * 0.28);
    this.q.setFromAxisAngle(this.up, cellHash(gx, gz, 6) * Math.PI * 2);
    this.s.set(sc, sy, sc);
    this.v.set(x, h - 0.05, z);
    this.m.compose(this.v, this.q, this.s);
    this.grass.setMatrixAt(idx, this.m);

    // Rich sunlit Hyrule meadow green harmonized with terrain
    const hue = 0.245 + patch * 0.045 + (cellHash(gx, gz, 7) - 0.5) * 0.025;
    const sat = 0.64 + cellHash(gx, gz, 8) * 0.12;
    const lit = 0.32 + patch * 0.08 + cellHash(gx, gz, 9) * 0.05;
    this.c.setHSL(hue, sat, lit);
    this.grass.setColorAt(idx, this.c);
  }

  private fillFlowerCell(fx: number, fz: number) {
    const F = DynamicGrassField.FGRID;
    const sx = ((fx % F) + F) % F;
    const sz = ((fz % F) + F) % F;
    const idx = sz * F + sx;

    const jx = (cellHash(fx, fz, 11) - 0.5) * 0.85;
    const jz = (cellHash(fx, fz, 12) - 0.5) * 0.85;
    const x = (fx + 0.5 + jx) * DynamicGrassField.FSTEP;
    const z = (fz + 0.5 + jz) * DynamicGrassField.FSTEP;

    const rOk = Math.abs(x) < HALF - 10 && Math.abs(z) < HALF - 10;
    const h = rOk ? this.terrain.height(x, z) : -99;
    const flat = rOk && h > WATER_LEVEL + 2.2 && h < 42 ? this.terrain.flatness(x, z) : 0;
    const patch = flat > 0.80 ? this.meadow.noise(x * 0.025, z * 0.025) * 0.5 + 0.5 : 0;
    const keep = flat > 0.80 && patch > 0.46 && cellHash(fx, fz, 13) < 0.42 && !this.shrineKeepOut(x, z);

    if (!keep) {
      this.m.makeScale(0, 0, 0);
      this.flowers.setMatrixAt(idx, this.m);
      return;
    }

    const sc = 0.85 + cellHash(fx, fz, 14) * 0.55;
    this.q.setFromAxisAngle(this.up, cellHash(fx, fz, 15) * Math.PI * 2);
    this.s.set(sc, sc, sc);
    this.v.set(x, h - 0.02, z);
    this.m.compose(this.v, this.q, this.s);
    this.flowers.setMatrixAt(idx, this.m);
    const colIdx = Math.floor(cellHash(fx, fz, 16) * this.flowerPalette.length);
    this.flowers.setColorAt(idx, this.flowerPalette[colIdx]);
  }

  update(focus: THREE.Vector3) {
    const G = DynamicGrassField.GRID;
    const halfG = G >> 1;
    const cgx = Math.floor(focus.x / DynamicGrassField.STEP);
    const cgz = Math.floor(focus.z / DynamicGrassField.STEP);

    if (cgx !== this.lastGx || cgz !== this.lastGz) {
      const dx = cgx - this.lastGx;
      const dz = cgz - this.lastGz;
      if (Math.abs(dx) >= G || Math.abs(dz) >= G) {
        for (let z = cgz - halfG; z < cgz - halfG + G; z++) {
          for (let x = cgx - halfG; x < cgx - halfG + G; x++) this.fillGrassCell(x, z);
        }
      } else {
        const minX = cgx - halfG, maxX = minX + G;
        const minZ = cgz - halfG, maxZ = minZ + G;
        if (dx !== 0) {
          const xStart = dx > 0 ? maxX - dx : minX;
          const xEnd = dx > 0 ? maxX : minX - dx;
          for (let z = minZ; z < maxZ; z++) {
            for (let x = xStart; x < xEnd; x++) this.fillGrassCell(x, z);
          }
        }
        if (dz !== 0) {
          const zStart = dz > 0 ? maxZ - dz : minZ;
          const zEnd = dz > 0 ? maxZ : minZ - dz;
          for (let z = zStart; z < zEnd; z++) {
            for (let x = minX; x < maxX; x++) this.fillGrassCell(x, z);
          }
        }
      }
      this.lastGx = cgx;
      this.lastGz = cgz;
      this.grass.instanceMatrix.needsUpdate = true;
      if (this.grass.instanceColor) this.grass.instanceColor.needsUpdate = true;
    }

    const F = DynamicGrassField.FGRID;
    const halfF = F >> 1;
    const cfx = Math.floor(focus.x / DynamicGrassField.FSTEP);
    const cfz = Math.floor(focus.z / DynamicGrassField.FSTEP);

    if (cfx !== this.lastFx || cfz !== this.lastFz) {
      for (let z = cfz - halfF; z < cfz - halfF + F; z++) {
        for (let x = cfx - halfF; x < cfx - halfF + F; x++) this.fillFlowerCell(x, z);
      }
      this.lastFx = cfx;
      this.lastFz = cfz;
      this.flowers.instanceMatrix.needsUpdate = true;
      if (this.flowers.instanceColor) this.flowers.instanceColor.needsUpdate = true;
    }
  }
}

// ---------------------------------------------------------------- Clouds
export function createClouds(): THREE.Group {
  const g = new THREE.Group();
  const rand = mulberry32(29);
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const mat = createCloudMaterial();
  for (let i = 0; i < 22; i++) {
    const cloud = new THREE.Group();
    const puffs = 4 + Math.floor(rand() * 4);
    for (let k = 0; k < puffs; k++) {
      const p = new THREE.Mesh(geo, mat);
      const t = puffs > 1 ? k / (puffs - 1) : 0.5;
      const arch = Math.sin(t * Math.PI); // fuller middle, tapered ends
      const sc = (5.5 + rand() * 7.5) * (0.65 + 0.55 * arch);
      p.scale.set(sc * 1.45, sc * (0.58 + 0.22 * arch), sc * 1.05);
      p.position.set((k - (puffs - 1) / 2) * 8.5 + (rand() - 0.5) * 3.5, arch * 3.2 + rand() * 1.8, (rand() - 0.5) * 6);
      cloud.add(p);
    }
    cloud.position.set((rand() - 0.5) * 940, 118 + rand() * 55, (rand() - 0.5) * 940);
    cloud.userData.speed = 1.6 + rand() * 2.4;
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
  private shadowCasters: THREE.Mesh[] = [];
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

    this.stoneMat = createCelMaterial({
      color: '#918e81',
      flatShading: true,
      shadowTint: '#6c82a8',
      rimStrength: 0.32,
      mossTop: 0.28,
      cacheKey: 'cel_shrine_stone_v1',
    });
    this.darkMat = createCelMaterial({
      color: '#6b6a60',
      flatShading: true,
      shadowTint: '#5e7396',
      rimStrength: 0.28,
      mossTop: 0.18,
      cacheKey: 'cel_shrine_dark_v1',
    });
    this.mossMat = createCelMaterial({
      color: '#7b8c60',
      flatShading: true,
      shadowTint: '#62809e',
      rimStrength: 0.22,
      mossTop: 0.35,
      cacheKey: 'cel_shrine_moss_v1',
    });
    this.runeMat = new THREE.MeshBasicMaterial({
      color: COLORS.inactive.clone(), transparent: true, opacity: 0.85, side: THREE.DoubleSide, fog: false,
    });

    // Two-tier walkable stepped stone circle
    const outerTerrace = new THREE.Mesh(new THREE.CylinderGeometry(5.5, 6.4, 0.42, 9), this.mossMat);
    outerTerrace.position.y = 0.21;
    outerTerrace.receiveShadow = true;
    const innerDais = new THREE.Mesh(new THREE.CylinderGeometry(3.65, 4.3, 0.42, 9), this.stoneMat);
    innerDais.position.y = 0.62;
    innerDais.receiveShadow = true;
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
      slab.castShadow = true;
      slab.receiveShadow = true;
      this.shadowCasters.push(slab);
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
    plinth.castShadow = true;
    plinth.receiveShadow = true;
    this.shadowCasters.push(plinth);
    this.group.add(plinth);
    this.pillars.push({ x: def.x, z: def.z, r: 1.15 });

    // Floating triangular crystal core
    this.crystalMat = new THREE.MeshBasicMaterial({
      color: COLORS.inactive.clone(), transparent: true, opacity: 1, fog: false,
    });
    this.crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.76, 0), this.crystalMat);
    this.crystal.position.y = 3.55;
    this.crystal.scale.set(0.95, 1.65, 0.95);
    this.group.add(this.crystal);

    // Interlocking resonance rings around the crystal
    this.haloMat = new THREE.MeshBasicMaterial({
      color: COLORS.inactive.clone(), transparent: true, opacity: 0.72, fog: false,
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
      depthWrite: false, transparent: true, opacity: 0.85, fog: false,
    }));
    this.glow.scale.setScalar(7.5);
    this.glow.position.y = 3.55;
    this.group.add(this.glow);

    // Gentle low spirit wisp (only ~13m high, never a sky-piercing beacon)
    const wispGeo = new THREE.CylinderGeometry(0.18, 1.05, 13, 12, 1, true);
    wispGeo.translate(0, 6.5, 0);
    this.wispMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
      uniforms: {
        color: { value: COLORS.inactive.clone() },
        time: { value: 0 },
        fade: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv; varying vec3 vN; varying vec3 vV;
        ${CEL_SAFE_MATH_GLSL}
        void main() {
          vUv = uv;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vN = safeNormalize(normalMatrix * normal);
          vV = safeNormalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 color; uniform float time; uniform float fade;
        varying vec2 vUv; varying vec3 vN; varying vec3 vV;
        ${CEL_SAFE_MATH_GLSL}
        void main() {
          float f = safePow(clamp(abs(dot(safeNormalize(vN), safeNormalize(vV))), 0.0, 1.0), 1.6);
          float wave = 0.72 + 0.28 * sin(time * 1.8 - vUv.y * 6.0);
          float vTop = clamp(1.0 - vUv.y, 0.0, 1.0);
          float a = safePow(vTop, 1.9) * smoothstep(0.0, 0.15, vUv.y) * f * wave * 0.42 * fade;
          gl_FragColor = vec4(color, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.wisp = new THREE.Mesh(wispGeo, this.wispMat);
    this.wisp.position.y = 2.6;
    this.group.add(this.wisp);

    // Drifting firefly-like light motes rising around the altar
    this.moteMat = new THREE.MeshBasicMaterial({
      color: COLORS.inactive.clone(), transparent: true, opacity: 0.85, fog: false,
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
    this.setActivated(false);
  }

  setActivated(v: boolean) {
    this.activated = v;
    const col = v ? COLORS.active : COLORS.inactive;
    // Clean HDR boost (>1.0) lets Selective Soft Bloom wrap shrines in a soft painterly halo
    this.crystalMat.color.copy(col).multiplyScalar(1.85);
    this.runeMat.color.copy(col).multiplyScalar(1.48);
    this.haloMat.color.copy(col).multiplyScalar(1.45);
    this.moteMat.color.copy(col).multiplyScalar(1.75);
    this.glow.material.color.copy(col);
    (this.wispMat.uniforms.color.value as THREE.Color).copy(col).multiplyScalar(1.35);
    (this.ring.material as THREE.MeshBasicMaterial).color.copy(COLORS.active).multiplyScalar(1.65);
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
    const cast = stoneFade > 0.5;
    for (const sc of this.shadowCasters) sc.castShadow = cast;

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
