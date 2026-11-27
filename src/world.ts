import * as THREE from 'three';
import { Terrain, SEG, HALF, WATER_LEVEL, WORLD_SIZE, smoothstep } from './terrain';
import { mulberry32, Simplex2 } from './noise';
import { BIOMES, sampleBiomeWeights, sampleDominantBiome } from './biomes';
import {
  CEL_PALETTE,
  CEL_SAFE_MATH_GLSL,
  celUniforms,
  createAuroraMaterial,
  createCelMaterial,
  createCloudMaterial,
  createCloudSeaMaterial,
  createGlowMushroomMaterial,
  createGrassMaterial,
  createTerrainMaterial,
  createWaterMaterial,
} from './cel';

import { START_POS, TOWER_DEFS, type TowerDef } from './world-layout';
export { START_POS, TOWER_DEFS, type TowerDef };

export const EXPLORE_RADIUS = 28;
export const REVEAL_RADIUS = 150;

export const COLORS = {
  skyTop: CEL_PALETTE.skyZenith,
  horizon: CEL_PALETTE.skyHorizon,
  inactive: CEL_PALETTE.inactive,
  active: CEL_PALETTE.active,
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
 * with gentle upward lift — gives stylized canopies a soft painted volume.
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

/** Towering wide umbrella canopy for Mistwood's ancient giant trees. */
function buildAncientCanopyGeo(): THREE.BufferGeometry {
  const puffs: THREE.BufferGeometry[] = [];
  const specs: [number, number, number, number, number][] = [
    [0, 6.2, 0, 2.75, 1.35],
    [1.85, 5.45, 0.85, 1.75, 1.05],
    [-1.75, 5.55, 0.72, 1.82, 1.08],
    [0.25, 5.4, -1.85, 1.78, 1.02],
    [-0.95, 6.75, -0.55, 1.55, 1.0],
    [0.95, 6.65, 0.45, 1.5, 0.95],
  ];
  for (const [x, y, z, rx, ry] of specs) {
    const g = new THREE.SphereGeometry(1, 7, 5);
    g.scale(rx, ry, rx);
    g.translate(x, y, z);
    puffs.push(g);
  }
  const geo = mergeGeometries(puffs);
  applyRadialFoliageNormals(geo, 5.7, 0.72, 0.85);
  return geo;
}

/** Flared buttress trunk for Mistwood giant trees. */
function buildAncientTrunkGeo(): THREE.BufferGeometry {
  const main = new THREE.CylinderGeometry(0.45, 0.92, 5.8, 7);
  main.translate(0, 2.9, 0);
  const rootA = new THREE.CylinderGeometry(0.18, 0.42, 2.1, 5);
  rootA.rotateZ(0.45);
  rootA.translate(0.68, 0.75, 0.25);
  const rootB = new THREE.CylinderGeometry(0.18, 0.40, 2.0, 5);
  rootB.rotateZ(-0.42);
  rootB.rotateY(2.1);
  rootB.translate(-0.52, 0.72, -0.45);
  const rootC = new THREE.CylinderGeometry(0.16, 0.38, 1.9, 5);
  rootC.rotateX(0.42);
  rootC.translate(0.1, 0.68, 0.65);
  return mergeGeometries([main, rootA, rootB, rootC]);
}

/** Cluster of 3 stylized glowing mushrooms for Mistwood forest floor. */
function buildMushroomClusterGeo(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const specs: [number, number, number, number][] = [
    // [ox, oz, height, capRadius]
    [0.0, 0.0, 0.92, 0.44],
    [0.42, 0.24, 0.62, 0.30],
    [-0.36, 0.22, 0.50, 0.24],
  ];
  for (const [ox, oz, h, r] of specs) {
    const stem = new THREE.CylinderGeometry(r * 0.22, r * 0.32, h * 0.62, 6);
    stem.translate(ox, h * 0.31, oz);
    const cap = new THREE.ConeGeometry(r, h * 0.45, 7);
    cap.translate(ox, h * 0.78, oz);
    parts.push(stem, cap);
  }
  return mergeGeometries(parts);
}

/** Stylized floating lily pad cluster with a tiny central blossom for South Maple Lake. */
function buildWaterLilyGeo(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const pads: [number, number, number, number][] = [
    [0, 0, 0.68, 0.2],
    [0.82, 0.42, 0.50, 1.8],
    [-0.68, 0.52, 0.46, 3.6],
  ];
  for (const [ox, oz, r, rot] of pads) {
    const pad = new THREE.CylinderGeometry(r, r * 0.95, 0.05, 8, 1, false, 0, Math.PI * 1.82);
    pad.rotateY(rot);
    pad.translate(ox, 0.03, oz);
    parts.push(pad);
  }
  return mergeGeometries(parts);
}

/** Lakeside reed / cattail tuft for South Maple Lake & Karst shallows. */
function buildReedGeo(): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const stalks: [number, number, number, number, number][] = [
    [0.0, 0.0, 0.0, 0.07, 1.65],
    [0.24, 0.14, 1.1, 0.065, 1.45],
    [-0.22, 0.18, 2.4, 0.065, 1.55],
    [0.10, -0.24, 3.9, 0.06, 1.32],
    [-0.18, -0.15, 5.1, 0.065, 1.48],
  ];
  for (const [ox, oz, yaw, w, h] of stalks) {
    const cx = Math.cos(yaw), sz = Math.sin(yaw);
    const rx = cx * w, rz = sz * w;
    const fx = -sz * 0.22, fz = cx * 0.22;
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

        // Three-band painterly sky gradient (adapts smoothly across dawn, day, sunset & night)
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

  const mesh = new THREE.Mesh(geo, createTerrainMaterial(terrain));
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

// ---------------------------------------------------------------- Biome-Aware Vegetation
export function createVegetation(terrain: Terrain, avoid: { x: number; z: number; r: number }[]): THREE.Group {
  const group = new THREE.Group();
  const rand = mulberry32(11);
  const forest = new Simplex2(5);

  const pineGeo = buildPineCanopyGeo();
  const roundGeo = buildBroadleafCanopyGeo();
  const trunkGeo = new THREE.CylinderGeometry(0.18, 0.34, 2.0, 7);
  trunkGeo.translate(0, 1.0, 0);
  const ancientCanopyGeo = buildAncientCanopyGeo();
  const ancientTrunkGeo = buildAncientTrunkGeo();
  const rockGeo = new THREE.DodecahedronGeometry(1, 0);
  const mushroomGeo = buildMushroomClusterGeo();
  const lilyGeo = buildWaterLilyGeo();
  const reedGeo = buildReedGeo();

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
  const ancientCanopyMat = createCelMaterial({
    shadowTint: '#244d5c',
    rimStrength: 0.36,
    rimPower: 2.5,
    stepLow: -0.05,
    stepHigh: 0.18,
    highlight: 0.14,
    wind: { amp: 0.14, freq: 1.1, heightOffset: 3.5 },
    cacheKey: 'cel_ancient_canopy_v1',
  });
  const trunkMat = createCelMaterial({
    color: '#73533a',
    shadowTint: '#4e5d85',
    rimStrength: 0.18,
    cacheKey: 'cel_trunk_v2',
  });
  const ancientTrunkMat = createCelMaterial({
    color: '#4b4036',
    shadowTint: '#2b4752',
    rimStrength: 0.22,
    mossTop: 0.42,
    cacheKey: 'cel_ancient_trunk_v1',
  });
  // White base so per-instance biome colors render accurately
  const rockMat = createCelMaterial({
    color: '#ffffff',
    flatShading: true,
    shadowTint: '#526b96',
    rimStrength: 0.28,
    mossTop: 0.28,
    cacheKey: 'cel_rock_biome_v3',
  });
  const mushroomMat = createGlowMushroomMaterial();
  const lilyMat = createCelMaterial({
    color: '#ffffff',
    shadowTint: '#325d6b',
    rimStrength: 0.24,
    cacheKey: 'cel_lily_v1',
  });
  const reedMat = createGrassMaterial(false);

  const MAX_PINE = 1100;
  const MAX_ROUND = 1200;
  const MAX_ANCIENT = 240;
  const MAX_ROCK = 340;
  const MAX_MUSHROOM = 260;
  const MAX_LILY = 220;
  const MAX_REED = 360;

  const pines = new THREE.InstancedMesh(pineGeo, pineMat, MAX_PINE);
  const rounds = new THREE.InstancedMesh(roundGeo, roundMat, MAX_ROUND);
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, MAX_PINE + MAX_ROUND);
  const ancientCanopies = new THREE.InstancedMesh(ancientCanopyGeo, ancientCanopyMat, MAX_ANCIENT);
  const ancientTrunks = new THREE.InstancedMesh(ancientTrunkGeo, ancientTrunkMat, MAX_ANCIENT);
  const rocks = new THREE.InstancedMesh(rockGeo, rockMat, MAX_ROCK);
  const mushrooms = new THREE.InstancedMesh(mushroomGeo, mushroomMat, MAX_MUSHROOM);
  const lilies = new THREE.InstancedMesh(lilyGeo, lilyMat, MAX_LILY);
  const reeds = new THREE.InstancedMesh(reedGeo, reedMat, MAX_REED);

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  const v = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const c = new THREE.Color();
  const bw = new Float32Array(6);

  let np = 0, nr = 0, nt = 0, na = 0, nk = 0, nm = 0, nl = 0, nrd = 0;

  const blocked = (x: number, z: number) => avoid.some((a) => Math.hypot(x - a.x, z - a.z) < a.r);

  // 1. Trees (biome-tailored species, density, scale, and palette)
  for (let k = 0; k < 12500 && (np < MAX_PINE || nr < MAX_ROUND || na < MAX_ANCIENT); k++) {
    const x = (rand() - 0.5) * WORLD_SIZE * 0.92;
    const z = (rand() - 0.5) * WORLD_SIZE * 0.92;
    const h = terrain.height(x, z);
    if (h < WATER_LEVEL + 1.4 || h > 64) continue;
    const flat = terrain.flatness(x, z);
    if (flat < 0.83) continue;
    if (blocked(x, z)) continue;

    const { index: bio } = sampleDominantBiome(x, z);
    const fn = forest.noise(x * 0.012, z * 0.012);

    // 4: 霧林 — Dense colossal ancient trees
    if (bio === 4) {
      if (fn < -0.22 + rand() * 0.25) continue;
      if (na < MAX_ANCIENT && rand() < 0.68) {
        const sc = 1.45 + rand() * 1.15;
        q.setFromAxisAngle(up, rand() * Math.PI * 2);
        s.set(sc, sc * (0.95 + rand() * 0.35), sc);
        v.set(x, h - 0.35, z);
        m.compose(v, q, s);
        ancientCanopies.setMatrixAt(na, m);
        ancientTrunks.setMatrixAt(na, m);
        // Deep emerald-teal & misty blue-green giant canopy
        c.setHSL(0.41 + rand() * 0.08, 0.44 + rand() * 0.14, 0.16 + rand() * 0.08);
        ancientCanopies.setColorAt(na++, c);
        continue;
      }
      // Understory deep-teal pines
      if (np < MAX_PINE && rand() < 0.45) {
        const sc = 0.85 + rand() * 0.65;
        q.setFromAxisAngle(up, rand() * Math.PI * 2);
        s.set(sc, sc * (0.9 + rand() * 0.35), sc);
        v.set(x, h - 0.22, z);
        m.compose(v, q, s);
        pines.setMatrixAt(np, m);
        c.setHSL(0.43 + rand() * 0.07, 0.46, 0.17 + rand() * 0.07);
        pines.setColorAt(np++, c);
        trunks.setMatrixAt(nt++, m);
      }
      continue;
    }

    // 2: 東崖赤谷 — Very sparse dry desert scrub / stunted warm-ochre trees
    if (bio === 2) {
      if (rand() > 0.14 || fn < 0.18 || h > 44) continue;
      if (nr < MAX_ROUND) {
        const sc = 0.48 + rand() * 0.42;
        q.setFromAxisAngle(up, rand() * Math.PI * 2);
        s.set(sc * 1.2, sc * 0.68, sc * 1.2);
        v.set(x, h - 0.3, z);
        m.compose(v, q, s);
        rounds.setMatrixAt(nr, m);
        c.setHSL(0.14 + rand() * 0.07, 0.38, 0.28 + rand() * 0.08); // dry sage-ochre scrub
        rounds.setColorAt(nr++, c);
        trunks.setMatrixAt(nt++, m);
      }
      continue;
    }

    // 5: 北境雪原 — Frosted alpine pines on lower/mid slopes
    if (bio === 5) {
      if (h > 54 || fn < -0.05 + rand() * 0.32) continue;
      if (np < MAX_PINE) {
        const sc = 0.78 + rand() * 0.72;
        q.setFromAxisAngle(up, rand() * Math.PI * 2);
        s.set(sc, sc * (0.95 + rand() * 0.38), sc);
        v.set(x, h - 0.22, z);
        m.compose(v, q, s);
        pines.setMatrixAt(np, m);
        // Frosted silver-blue & snowy pine needles
        if (rand() < 0.42) {
          c.setHSL(0.54 + rand() * 0.04, 0.28, 0.56 + rand() * 0.14); // snow-laden boughs
        } else {
          c.setHSL(0.50 + rand() * 0.06, 0.38, 0.24 + rand() * 0.09); // deep frost spruce
        }
        pines.setColorAt(np++, c);
        trunks.setMatrixAt(nt++, m);
      }
      continue;
    }

    // 3: 南湖楓渚 — Vivid crimson, scarlet, vermilion, and golden-amber autumn maples!
    if (bio === 3) {
      if (fn < -0.22 + rand() * 0.24 || h > 42) continue;
      if (nr < MAX_ROUND) {
        const sc = 0.82 + rand() * 0.70;
        q.setFromAxisAngle(up, rand() * Math.PI * 2);
        s.set(sc * 1.08, sc * (0.88 + rand() * 0.32), sc * 1.08);
        v.set(x, h - 0.22, z);
        m.compose(v, q, s);
        rounds.setMatrixAt(nr, m);
        const pal = rand();
        if (pal < 0.48) {
          c.setHSL(0.005 + rand() * 0.03, 0.84, 0.34 + rand() * 0.08); // vivid crimson maple
        } else if (pal < 0.80) {
          c.setHSL(0.05 + rand() * 0.03, 0.86, 0.42 + rand() * 0.08); // glowing vermilion maple
        } else if (pal < 0.94) {
          c.setHSL(0.11 + rand() * 0.03, 0.82, 0.48 + rand() * 0.07); // golden ginkgo/maple
        } else {
          c.setHSL(0.24 + rand() * 0.05, 0.48, 0.28 + rand() * 0.06); // olive contrast
        }
        rounds.setColorAt(nr++, c);
        trunks.setMatrixAt(nt++, m);
      }
      continue;
    }

    // 1: 西嶺石林 — Jade-green karst pines & graceful emerald tufts along banks & pillar crowns
    if (bio === 1) {
      if (fn < -0.04 + rand() * 0.28) continue;
      const sc = 0.66 + rand() * 0.58;
      q.setFromAxisAngle(up, rand() * Math.PI * 2);
      s.set(sc, sc * (0.9 + rand() * 0.34), sc);
      v.set(x, h - 0.22, z);
      m.compose(v, q, s);
      if ((h > 20 || rand() < 0.55) && np < MAX_PINE) {
        pines.setMatrixAt(np, m);
        c.setHSL(0.39 + rand() * 0.06, 0.50, 0.21 + rand() * 0.08); // jade mountain pine
        pines.setColorAt(np++, c);
        trunks.setMatrixAt(nt++, m);
      } else if (nr < MAX_ROUND) {
        rounds.setMatrixAt(nr, m);
        c.setHSL(0.35 + rand() * 0.07, 0.52, 0.28 + rand() * 0.09); // jade broadleaf
        rounds.setColorAt(nr++, c);
        trunks.setMatrixAt(nt++, m);
      }
      continue;
    }

    // 0: 翠野 — Classic sunlit meadow trees
    if (fn < 0.04 + rand() * 0.25 || h > 54) continue;
    const sc = 0.72 + rand() * 0.68;
    q.setFromAxisAngle(up, rand() * Math.PI * 2);
    s.set(sc, sc * (0.86 + rand() * 0.36), sc);
    v.set(x, h - 0.22, z);
    m.compose(v, q, s);
    const usePine = h > 26 || rand() < 0.34;
    if (usePine && np < MAX_PINE) {
      pines.setMatrixAt(np, m);
      c.setHSL(0.34 + rand() * 0.06, 0.52, 0.22 + rand() * 0.08);
      pines.setColorAt(np++, c);
    } else if (!usePine && nr < MAX_ROUND) {
      rounds.setMatrixAt(nr, m);
      const accent = rand();
      if (accent < 0.09) {
        c.setHSL(0.11 + rand() * 0.04, 0.68, 0.44 + rand() * 0.06);
      } else if (accent < 0.14) {
        c.setHSL(0.95 + rand() * 0.04, 0.52, 0.68 + rand() * 0.05);
      } else {
        c.setHSL(0.24 + rand() * 0.08, 0.60, 0.30 + rand() * 0.10);
      }
      rounds.setColorAt(nr++, c);
    } else continue;
    trunks.setMatrixAt(nt++, m);
  }

  // 2. Biome-tinted Boulders & Outcrops
  for (let k = 0; k < 5500 && nk < MAX_ROCK; k++) {
    const x = (rand() - 0.5) * WORLD_SIZE * 0.9;
    const z = (rand() - 0.5) * WORLD_SIZE * 0.9;
    const h = terrain.height(x, z);
    if (h < WATER_LEVEL || blocked(x, z)) continue;
    const { index: bio } = sampleDominantBiome(x, z);
    const f = terrain.flatness(x, z);
    if (bio !== 2 && f > 0.9 && rand() < 0.78) continue;
    if (bio === 2 && f > 0.94 && rand() < 0.45) continue;

    const sc = (bio === 2 ? 0.8 : 0.6) + rand() * (bio === 2 ? 2.6 : 2.1);
    q.setFromEuler(new THREE.Euler(rand() * 3, rand() * 3, rand() * 3));
    s.set(sc * (0.8 + rand() * 0.6), sc * (0.5 + rand() * 0.55), sc * (0.8 + rand() * 0.6));
    v.set(x, h - 0.15, z);
    m.compose(v, q, s);
    rocks.setMatrixAt(nk, m);
    if (bio === 1) c.setHSL(0.45, 0.12, 0.58 + rand() * 0.14);      // pale jade limestone
    else if (bio === 2) c.setHSL(0.045 + rand() * 0.03, 0.56, 0.38 + rand() * 0.12); // red sandstone
    else if (bio === 3) c.setHSL(0.08, 0.22, 0.44 + rand() * 0.10); // warm mossy autumn stone
    else if (bio === 4) c.setHSL(0.48, 0.18, 0.28 + rand() * 0.08); // damp slate
    else if (bio === 5) c.setHSL(0.58, 0.20, 0.50 + rand() * 0.14); // glacial granite
    else c.setHSL(0.10, 0.12, 0.52 + rand() * 0.10);                // meadow stone
    rocks.setColorAt(nk++, c);
  }

  // 3. Mistwood Bioluminescent Glowing Mushrooms
  for (let k = 0; k < 4200 && nm < MAX_MUSHROOM; k++) {
    const x = -128 + (rand() - 0.5) * 210;
    const z = 155 + (rand() - 0.5) * 210;
    if (Math.hypot(x, z) > HALF - 26) continue;
    sampleBiomeWeights(x, z, bw);
    if (bw[4] < 0.42) continue;
    const h = terrain.height(x, z);
    if (h < WATER_LEVEL + 1.8 || terrain.flatness(x, z) < 0.80 || blocked(x, z)) continue;

    const sc = 0.65 + rand() * 0.95;
    q.setFromAxisAngle(up, rand() * Math.PI * 2);
    s.set(sc, sc * (0.85 + rand() * 0.45), sc);
    v.set(x, h - 0.06, z);
    m.compose(v, q, s);
    mushrooms.setMatrixAt(nm, m);
    if (rand() < 0.68) {
      c.setRGB(0.24 + rand() * 0.14, 0.90 + rand() * 0.10, 0.82 + rand() * 0.12); // cyan-jade glow
    } else {
      c.setRGB(0.62 + rand() * 0.16, 0.52 + rand() * 0.14, 0.96); // soft lavender-violet glow
    }
    mushrooms.setColorAt(nm++, c);
  }

  // 4. South Maple Lake Water Lilies (floating on calm lake shallows)
  for (let k = 0; k < 3500 && nl < MAX_LILY; k++) {
    const x = 98 + (rand() - 0.5) * 165;
    const z = 138 + (rand() - 0.5) * 165;
    if (Math.hypot(x, z) > HALF - 34) continue;
    sampleBiomeWeights(x, z, bw);
    if (bw[3] < 0.35) continue;
    const h = terrain.height(x, z);
    // Shallow-to-mid calm lake water
    if (h > WATER_LEVEL - 0.25 || h < WATER_LEVEL - 4.2) continue;

    const sc = 0.72 + rand() * 0.68;
    q.setFromAxisAngle(up, rand() * Math.PI * 2);
    s.set(sc, 1, sc);
    v.set(x, WATER_LEVEL + 0.03, z);
    m.compose(v, q, s);
    lilies.setMatrixAt(nl, m);
    if (rand() < 0.18) {
      c.setHSL(0.95 + rand() * 0.04, 0.65, 0.76); // occasional pale pink lotus pad accent
    } else {
      c.setHSL(0.32 + rand() * 0.07, 0.50, 0.24 + rand() * 0.08);
    }
    lilies.setColorAt(nl++, c);
  }

  // 5. Lakeside Reeds (South Maple Lake & West Karst lagoon shallows)
  for (let k = 0; k < 7000 && nrd < MAX_REED; k++) {
    const pickMaple = rand() < 0.68;
    const x = pickMaple ? 98 + (rand() - 0.5) * 185 : -172 + (rand() - 0.5) * 175;
    const z = pickMaple ? 138 + (rand() - 0.5) * 185 : -48 + (rand() - 0.5) * 175;
    if (Math.hypot(x, z) > HALF - 26) continue;
    sampleBiomeWeights(x, z, bw);
    if (bw[3] < 0.3 && bw[1] < 0.3) continue;
    const h = terrain.height(x, z);
    if (h < WATER_LEVEL - 0.35 || h > WATER_LEVEL + 0.95 || blocked(x, z)) continue;

    const sc = 0.8 + rand() * 0.7;
    q.setFromAxisAngle(up, rand() * Math.PI * 2);
    s.set(sc, sc * (0.85 + rand() * 0.45), sc);
    v.set(x, h - 0.08, z);
    m.compose(v, q, s);
    reeds.setMatrixAt(nrd, m);
    if (bw[3] >= bw[1]) {
      c.setHSL(0.14 + rand() * 0.07, 0.50, 0.36 + rand() * 0.09); // golden autumn reeds
    } else {
      c.setHSL(0.35 + rand() * 0.06, 0.48, 0.28 + rand() * 0.08); // jade lagoon reeds
    }
    reeds.setColorAt(nrd++, c);
  }

  pines.count = np;
  rounds.count = nr;
  trunks.count = nt;
  ancientCanopies.count = na;
  ancientTrunks.count = na;
  rocks.count = nk;
  mushrooms.count = nm;
  lilies.count = nl;
  reeds.count = nrd;

  [pines, rounds, ancientCanopies].forEach((im) => {
    im.castShadow = true;
    im.receiveShadow = false;
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.computeBoundingSphere();
    group.add(im);
  });

  [trunks, ancientTrunks, rocks].forEach((im) => {
    im.castShadow = true;
    im.receiveShadow = true;
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.computeBoundingSphere();
    group.add(im);
  });

  [mushrooms, lilies, reeds].forEach((im) => {
    im.castShadow = false;
    im.receiveShadow = true;
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.computeBoundingSphere();
    group.add(im);
  });

  return group;
}

// ---------------------------------------------------------------- Dynamic Biome Grass & Wildflowers
function cellHash(ix: number, iz: number, salt: number): number {
  let h = Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(salt, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * World-anchored toroidal meadow patch following the viewer (~72m x 72m dense grass
 * carpet + clustered watercolor wildflowers). Adapts density, height, and color per biome.
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

  private readonly flowerPalettes: THREE.Color[][] = [
    // 0: 翠野
    [new THREE.Color('#fffdf0'), new THREE.Color('#ffe054'), new THREE.Color('#86d2ff'), new THREE.Color('#ffaa90')],
    // 1: 西嶺石林
    [new THREE.Color('#f2fffb'), new THREE.Color('#9ff2da'), new THREE.Color('#fff2b2')],
    // 2: 東崖赤谷
    [new THREE.Color('#ffaa4a'), new THREE.Color('#e85f3a'), new THREE.Color('#ffd478')],
    // 3: 南湖楓渚
    [new THREE.Color('#e8462c'), new THREE.Color('#f79633'), new THREE.Color('#ffd35c'), new THREE.Color('#fff4d6')],
    // 4: 霧林
    [new THREE.Color('#5ef2df'), new THREE.Color('#a48cff'), new THREE.Color('#c8fff4')],
    // 5: 北境雪原
    [new THREE.Color('#e2f3ff'), new THREE.Color('#a4d4ff')],
  ];

  constructor(
    private readonly terrain: Terrain,
    private readonly extraAvoid: { x: number; z: number; r: number }[] = [],
  ) {
    const gMat = createGrassMaterial(false);
    const fMat = createGrassMaterial(true);
    this.grass = new THREE.InstancedMesh(buildGrassTuftGeo(), gMat, DynamicGrassField.GRID ** 2);
    this.flowers = new THREE.InstancedMesh(buildWildflowerGeo(), fMat, DynamicGrassField.FGRID ** 2);
    this.grass.frustumCulled = false;
    this.flowers.frustumCulled = false;
    this.group.add(this.grass, this.flowers);
  }

  private keepOut(x: number, z: number): boolean {
    for (let i = 0; i < TOWER_DEFS.length; i++) {
      const t = TOWER_DEFS[i];
      const dx = x - t.x, dz = z - t.z;
      if (dx * dx + dz * dz < 6.5 * 6.5) return true;
    }
    for (let i = 0; i < this.extraAvoid.length; i++) {
      const a = this.extraAvoid[i];
      const dx = x - a.x, dz = z - a.z;
      if (dx * dx + dz * dz < a.r * a.r) return true;
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
    const { index: bio } = rOk ? sampleDominantBiome(x, z) : { index: 0 };

    const maxH = bio === 5 ? 21 : bio === 2 ? 42 : 46;
    const flat = rOk && h > WATER_LEVEL + 1.8 && h < maxH ? this.terrain.flatness(x, z) : 0;
    const patch = flat > 0.78 ? this.meadow.noise(x * 0.022, z * 0.022) * 0.5 + 0.5 : 0;
    const r3 = cellHash(gx, gz, 3);

    let keep = flat > 0.78 && !this.keepOut(x, z);
    if (keep) {
      if (bio === 2) keep = r3 < 0.22 && patch > 0.35;           // sparse desert tussocks
      else if (bio === 5) keep = r3 < 0.25 && h < 19;            // sparse frosty grass below snowline
      else if (bio === 4) keep = patch > 0.16 || r3 < 0.55;      // lush deep mistwood ferns
      else keep = patch > 0.22 || r3 < 0.35;
    }

    if (!keep) {
      this.m.makeScale(0, 0, 0);
      this.grass.setMatrixAt(idx, this.m);
      return;
    }

    const sc = (bio === 4 ? 0.95 : bio === 2 ? 0.65 : 0.78) + cellHash(gx, gz, 4) * 0.65;
    const sy = sc * ((bio === 4 ? 0.95 : 0.72) + patch * 0.45 + cellHash(gx, gz, 5) * 0.28);
    this.q.setFromAxisAngle(this.up, cellHash(gx, gz, 6) * Math.PI * 2);
    this.s.set(sc, sy, sc);
    this.v.set(x, h - 0.05, z);
    this.m.compose(this.v, this.q, this.s);
    this.grass.setMatrixAt(idx, this.m);

    const h7 = cellHash(gx, gz, 7);
    const h8 = cellHash(gx, gz, 8);
    const h9 = cellHash(gx, gz, 9);
    if (bio === 1) {
      // Jade karst grass
      this.c.setHSL(0.36 + patch * 0.05 + (h7 - 0.5) * 0.025, 0.56 + h8 * 0.12, 0.28 + patch * 0.07 + h9 * 0.05);
    } else if (bio === 2) {
      // Dry golden-ochre canyon grass
      this.c.setHSL(0.11 + (h7 - 0.5) * 0.03, 0.52 + h8 * 0.14, 0.38 + patch * 0.08 + h9 * 0.05);
    } else if (bio === 3) {
      // Warm autumn olive-gold grass with occasional rust tint
      this.c.setHSL(0.16 + patch * 0.06 + (h7 - 0.5) * 0.04, 0.56 + h8 * 0.14, 0.32 + patch * 0.07 + h9 * 0.05);
    } else if (bio === 4) {
      // Deep emerald-teal mistwood ferns
      this.c.setHSL(0.41 + patch * 0.05 + (h7 - 0.5) * 0.03, 0.52 + h8 * 0.12, 0.20 + patch * 0.06 + h9 * 0.04);
    } else if (bio === 5) {
      // Frosted pale alpine tufts
      this.c.setHSL(0.50 + (h7 - 0.5) * 0.04, 0.24 + h8 * 0.10, 0.50 + h9 * 0.10);
    } else {
      // Classic sunlit meadow green
      this.c.setHSL(0.245 + patch * 0.045 + (h7 - 0.5) * 0.025, 0.64 + h8 * 0.12, 0.32 + patch * 0.08 + h9 * 0.05);
    }
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
    const { index: bio } = rOk ? sampleDominantBiome(x, z) : { index: 0 };

    const maxH = bio === 5 ? 18 : 42;
    const flat = rOk && h > WATER_LEVEL + 2.0 && h < maxH ? this.terrain.flatness(x, z) : 0;
    const patch = flat > 0.80 ? this.meadow.noise(x * 0.025, z * 0.025) * 0.5 + 0.5 : 0;
    const chance = bio === 2 ? 0.16 : bio === 5 ? 0.10 : bio === 3 ? 0.55 : 0.42;
    const keep = flat > 0.80 && patch > 0.42 && cellHash(fx, fz, 13) < chance && !this.keepOut(x, z);

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
    const pal = this.flowerPalettes[bio] ?? this.flowerPalettes[0];
    const colIdx = Math.floor(cellHash(fx, fz, 16) * pal.length);
    this.flowers.setColorAt(idx, pal[colIdx]);
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

// ---------------------------------------------------------------- Northern Night Aurora
export function createAurora(): THREE.Group {
  const group = new THREE.Group();
  const mat = createAuroraMaterial();

  const buildRibbon = (width: number, height: number, curveZ: number, y: number, z: number, rotY = 0) => {
    const geo = new THREE.PlaneGeometry(width, height, 42, 4);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const u = x / (width * 0.5); // -1..1
      // Graceful sweeping S-arc over the northern horizon
      const bend = Math.sin(u * Math.PI * 0.9) * curveZ + (1 - u * u) * 38;
      pos.setZ(i, bend);
    }
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(-12, y, z);
    mesh.rotation.y = rotY;
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    return mesh;
  };

  group.add(
    buildRibbon(620, 95, 42, 165, -370, 0.08),
    buildRibbon(500, 75, -36, 198, -325, -0.14),
  );
  return group;
}

// ---------------------------------------------------------------- West Karst Cloud Sea
export function createKarstCloudSea(): THREE.Group {
  const group = new THREE.Group();
  const mat = createCloudSeaMaterial();

  const layers = [
    { x: -170, y: 12.5, z: -48, r: 235 },
    { x: -162, y: 20.5, z: -42, r: 195 },
  ];
  for (const l of layers) {
    const geo = new THREE.PlaneGeometry(l.r, l.r, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(l.x, l.y, l.z);
    mesh.renderOrder = 3;
    group.add(mesh);
  }
  return group;
}

// ---------------------------------------------------------------- Soaring Bird Flocks (1 draw call)
interface FlockBird {
  cx: number;
  cz: number;
  radius: number;
  baseY: number;
  speed: number;
  phase: number;
  offsetX: number;
  offsetY: number;
  offsetZ: number;
  scale: number;
}

export class BirdFlocks {
  readonly mesh: THREE.InstancedMesh;
  private readonly birds: FlockBird[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();
  private readonly p = new THREE.Vector3();
  private readonly euler = new THREE.Euler();

  constructor() {
    const rand = mulberry32(733);
    // Stylized low-poly V-wing silhouette (2 triangular wings + slender body)
    const positions = new Float32Array([
      // Left wing
      0, 0, 0.25,  -1.0, 0.08, -0.12,  0, 0, -0.32,
      // Right wing
      0, 0, 0.25,  0, 0, -0.32,  1.0, 0.08, -0.12,
    ]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.computeVertexNormals();

    const mat = new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      fog: false,
      uniforms: {
        uTime: celUniforms.uTime,
        uLitTint: celUniforms.uLitTint,
        uNightFactor: celUniforms.uNightFactor,
      },
      vertexShader: /* glsl */ `
        uniform float uTime;
        varying vec3 vColor;
        void main() {
          #ifdef USE_INSTANCING_COLOR
            vColor = instanceColor;
          #else
            vColor = vec3(0.95, 0.94, 0.90);
          #endif
          vec3 pos = position;
          float phase = instanceMatrix[3].x * 0.17 + instanceMatrix[3].z * 0.13;
          float wing = abs(pos.x);
          pos.y += sin(uTime * 7.2 + phase) * 0.42 * wing;
          vec4 wp = modelMatrix * instanceMatrix * vec4(pos, 1.0);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uLitTint;
        uniform float uNightFactor;
        varying vec3 vColor;
        void main() {
          vec3 col = vColor * mix(uLitTint * 0.95, vec3(0.45, 0.58, 0.78), uNightFactor * 0.75);
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });

    const flockSpecs = [
      { bio: 0, count: 6, r: 62, y: 56, col: '#f7f4ea' }, // Meadow swallows/doves
      { bio: 1, count: 6, r: 58, y: 66, col: '#f2fcf8' }, // Karst white cranes
      { bio: 2, count: 5, r: 68, y: 68, col: '#6e4934' }, // Canyon hawks
      { bio: 3, count: 6, r: 54, y: 42, col: '#fff7ee' }, // Maple lake herons
      { bio: 4, count: 5, r: 52, y: 60, col: '#a8d8cf' }, // Mistwood birds
      { bio: 5, count: 4, r: 66, y: 88, col: '#dceeff' }, // Alpine snow eagles
    ];

    const total = flockSpecs.reduce((a, b) => a + b.count, 0);
    this.mesh = new THREE.InstancedMesh(geo, mat, total);
    this.mesh.frustumCulled = false;

    const c = new THREE.Color();
    let idx = 0;
    for (const f of flockSpecs) {
      const b = BIOMES[f.bio];
      const flockPhase = rand() * Math.PI * 2;
      const dir = rand() < 0.5 ? 1 : -1;
      const spd = (0.12 + rand() * 0.05) * dir;
      c.set(f.col);
      for (let i = 0; i < f.count; i++) {
        this.birds.push({
          cx: b.cx,
          cz: b.cz,
          radius: f.r + (rand() - 0.5) * 14,
          baseY: f.y + (rand() - 0.5) * 8,
          speed: spd,
          phase: flockPhase + i * 0.09,
          offsetX: (rand() - 0.5) * 7,
          offsetY: (rand() - 0.5) * 3,
          offsetZ: (rand() - 0.5) * 7,
          scale: 0.95 + rand() * 0.45,
        });
        this.mesh.setColorAt(idx++, c);
      }
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  update(t: number) {
    for (let i = 0; i < this.birds.length; i++) {
      const b = this.birds[i];
      const ang = b.phase + t * b.speed;
      const x = b.cx + Math.cos(ang) * b.radius + b.offsetX;
      const z = b.cz + Math.sin(ang) * b.radius + b.offsetZ;
      const y = b.baseY + b.offsetY + Math.sin(t * 0.7 + b.phase) * 2.2;
      // Tangent heading along orbit
      const vx = -Math.sin(ang) * b.speed;
      const vz = Math.cos(ang) * b.speed;
      const yaw = Math.atan2(vx, vz);
      this.p.set(x, y, z);
      this.euler.set(0, yaw, b.speed > 0 ? 0.16 : -0.16);
      this.q.setFromEuler(this.euler);
      this.s.setScalar(b.scale);
      this.m.compose(this.p, this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
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
let smokeOuterGeo: THREE.CylinderGeometry | null = null;
let smokeInnerGeo: THREE.CylinderGeometry | null = null;

/** Organic wind-swaying spirit smoke rising from unactivated shrines so ridges hide the altar while revealing a subtle distant cue. */
function createSpiritSmokeMaterial(seed: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
    uniforms: {
      uTime: celUniforms.uTime,
      uNightFactor: celUniforms.uNightFactor,
      uSunsetFactor: celUniforms.uSunsetFactor,
      uSeed: { value: seed },
      uFade: { value: 1.0 },
      uBaseColor: { value: new THREE.Color('#fff2d4') },
      uWarmColor: { value: new THREE.Color('#ffaa52') },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uSeed;
      varying vec2 vUv;
      varying vec3 vN;
      varying vec3 vV;
      ${CEL_SAFE_MATH_GLSL}
      void main() {
        vUv = uv;
        vec3 pos = position;
        float h = clamp(uv.y, 0.0, 1.0);
        float swayX = sin(uTime * 0.72 - h * 4.4 + uSeed) * 2.1 + sin(uTime * 1.25 - h * 7.8 + uSeed * 1.7) * 0.65;
        float swayZ = cos(uTime * 0.58 - h * 3.9 + uSeed * 1.3) * 1.65;
        float spread = h * h;
        pos.x += swayX * spread;
        pos.z += swayZ * spread;
        float puff = 1.0 + 0.24 * sin(h * 11.0 - uTime * 1.4 + uSeed);
        pos.xz *= puff;

        vec4 mv = modelViewMatrix * vec4(pos, 1.0);
        vN = safeNormalize(normalMatrix * normal);
        vV = safeNormalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uNightFactor;
      uniform float uSunsetFactor;
      uniform float uSeed;
      uniform float uFade;
      uniform vec3 uBaseColor;
      uniform vec3 uWarmColor;
      varying vec2 vUv;
      varying vec3 vN;
      varying vec3 vV;
      ${CEL_SAFE_MATH_GLSL}
      void main() {
        float h = clamp(vUv.y, 0.0, 1.0);
        float facing = clamp(abs(dot(safeNormalize(vN), safeNormalize(vV))), 0.0, 1.0);
        float softEdge = safePow(facing, 1.35);

        float a1 = sin(vUv.x * 12.566 + h * 7.0 - uTime * 0.95 + uSeed) * 0.5 + 0.5;
        float a2 = sin(vUv.x * 18.849 - h * 11.0 - uTime * 1.35 + uSeed * 2.1) * 0.5 + 0.5;
        float wisp = 0.45 + 0.55 * (a1 * 0.62 + a2 * 0.38);

        float vEnv = smoothstep(0.0, 0.14, h) * safePow(clamp(1.0 - h, 0.0, 1.0), 1.35);
        vec3 col = mix(uWarmColor, uBaseColor, smoothstep(0.05, 0.62, h));
        col *= 1.0 + uNightFactor * 0.48 + uSunsetFactor * 0.24;

        float alpha = vEnv * softEdge * wisp * (0.44 + 0.14 * uNightFactor) * uFade;
        gl_FragColor = vec4(col, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

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
  private smokeGroup: THREE.Group;
  private smokeMat: THREE.ShaderMaterial;
  private smokeSeed: number;
  private embers: { sprite: THREE.Sprite; phase: number; radius: number; speed: number }[] = [];
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

    // Tall organic swaying spirit-smoke plume for unactivated shrines (peeks naturally above triangular slopes)
    smokeOuterGeo ??= (() => {
      const g = new THREE.CylinderGeometry(3.2, 0.95, 38, 16, 20, true);
      g.translate(0, 19, 0);
      return g;
    })();
    smokeInnerGeo ??= (() => {
      const g = new THREE.CylinderGeometry(1.5, 0.48, 30, 12, 16, true);
      g.translate(0, 15, 0);
      return g;
    })();
    this.smokeSeed = index * 1.9 + 0.7;
    this.smokeMat = createSpiritSmokeMaterial(this.smokeSeed);
    this.smokeGroup = new THREE.Group();
    const smokeOuter = new THREE.Mesh(smokeOuterGeo, this.smokeMat);
    smokeOuter.position.y = 2.8;
    smokeOuter.renderOrder = 4;
    const smokeInner = new THREE.Mesh(smokeInnerGeo, this.smokeMat);
    smokeInner.position.y = 2.6;
    smokeInner.rotation.y = 1.6;
    smokeInner.renderOrder = 4;
    this.smokeGroup.add(smokeOuter, smokeInner);

    for (let i = 0; i < 8; i++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTex,
        color: new THREE.Color('#ffd380').multiplyScalar(1.35),
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
        opacity: 0.7,
        fog: false,
      }));
      sprite.scale.setScalar(1.4);
      this.smokeGroup.add(sprite);
      this.embers.push({
        sprite,
        phase: (i / 8) * Math.PI * 2 + index * 0.7,
        radius: 0.9 + (i % 3) * 0.75,
        speed: 0.14 + (i % 4) * 0.03,
      });
    }
    this.group.add(this.smokeGroup);

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

    // Let terrain slopes and regional atmospheric fog hide/reveal shrines naturally (no hard distance pop-in)
    const stoneFade = inTitle && !this.activated ? 0 : 1;
    const glowFade = inTitle && !this.activated
      ? 0
      : this.activated
        ? 0.35 + 0.65 * smoothstep(220, 80, dist)
        : 0.28 + 0.72 * smoothstep(220, 65, dist);

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
    this.wisp.visible = lumVisible && this.activated;

    this.crystalMat.opacity = glowFade * 0.95;
    this.haloMat.opacity = glowFade * (0.55 + nearBoost * 0.3);
    this.runeMat.opacity = stoneFade * (0.25 + glowFade * 0.7);
    this.glow.material.opacity = glowFade * (0.65 + nearBoost * 0.25);
    this.moteMat.opacity = glowFade * 0.85;

    this.wispMat.uniforms.time.value = t;
    this.wispMat.uniforms.fade.value = glowFade * 0.75;

    // Unactivated shrines breathe a tall swaying spirit-smoke plume that peeks over distant ridges
    const showSmoke = !inTitle && !this.activated;
    this.smokeGroup.visible = showSmoke;
    if (showSmoke) {
      const farFade = smoothstep(460, 240, dist);
      const nearSoft = 0.62 + 0.38 * smoothstep(18, 65, dist);
      this.smokeMat.uniforms.uFade.value = farFade * nearSoft;
      for (let i = 0; i < this.embers.length; i++) {
        const em = this.embers[i];
        const p = ((t * em.speed + em.phase) % 1 + 1) % 1;
        const ang = em.phase + t * 0.45 + p * 3.0;
        const swayX = Math.sin(t * 0.72 - p * 4.4 + this.smokeSeed) * 1.9 * p * p;
        const swayZ = Math.cos(t * 0.58 - p * 3.9 + this.smokeSeed) * 1.4 * p * p;
        const r = em.radius * (0.7 + p * 1.4);
        em.sprite.position.set(Math.cos(ang) * r + swayX, 3.2 + p * 26, Math.sin(ang) * r + swayZ);
        const env = Math.sin(p * Math.PI);
        em.sprite.scale.setScalar((0.9 + env * 1.35) * (0.8 + smoothstep(60, 220, dist) * 0.7));
        em.sprite.material.opacity = env * 0.65 * farFade;
      }
    }

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
