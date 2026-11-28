import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { HALF, SEG, WATER_LEVEL, WORLD_SIZE, type Terrain } from './terrain';
import {
  CEL_ATMOS_PARS_GLSL,
  CEL_NOISE_GLSL,
  CEL_SAFE_MATH_GLSL,
  celUniforms,
  getBiomeTextures,
} from './cel';
import { BIOMES, BIOME_COUNT, sampleDominantBiome } from './biomes';
import { Simplex2, mulberry32 } from './noise';
import { TOWER_DEFS, WONDER_DEFS } from './world-layout';
import type { DynamicGrassField } from './world';
import type { AmbientMotes } from './fx';

export type QualityMode = 'standard' | 'ultra';

/**
 * Validated iPhone 17+ High-Quality ("Living Watercolor") pipeline constants.
 * Derived from prototype Variant B (refined with 1/3 soft volumetric god-rays and no wind ribbons).
 */
const ULTRA_CONFIG = {
  dprCap: 3.0,
  standardDprCap: 1.75,
  shadowSize: 2048,
  shadowRange: 105,
  standardShadowSize: 1024,
  standardShadowRange: 62,
  exposure: 1.11,
  bloomScale: 0.94,
  bloomRadius: 0.62,
  bloomThreshold: 0.98,
  reflStrength: 0.68,
  causticsStrength: 0.35,
  godRayStrength: 1.18 / 3, // Soft volumetric sun/moon shafts (1/3 of full cinematic intensity)
  watercolorInk: 1.22,
  kuwaharaStrength: 1.0,
  paperGrain: 1.15,
  ssaoStrength: 0.36,
  volFogStrength: 0.10,
  gouacheGrade: 0.22,
  swarmCount: 900,
} as const;

export interface UltraQualityHost {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  composer: EffectComposer;
  bloomPass: UnrealBloomPass;
  terrain: Terrain;
  waterMesh: THREE.Mesh;
  grassField: DynamicGrassField;
  ambientMotes: AmbientMotes;
  sky: THREE.Mesh;
  clouds: THREE.Group;
  aurora: THREE.Group;
  karstCloudSea: THREE.Group;
  setShadowConfig: (size: number, range: number, soft: boolean) => void;
  isTitleState: () => boolean;
  getBiomeWeights: () => Float32Array;
}

// ------------------------------------------------------------ Shared Geometry & Texture Helpers

function buildShoreDepthTex(terrain: Terrain): THREE.DataTexture {
  const N = SEG + 1;
  const data = new Uint8Array(N * N * 4);
  const minH = WATER_LEVEL - 14.0;
  const span = 18.0;
  for (let i = 0; i < N * N; i++) {
    const norm = Math.max(0, Math.min(1, (terrain.heights[i] - minH) / span));
    const v = Math.round(norm * 255);
    data[i * 4] = v;
    data[i * 4 + 1] = v;
    data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

function createGBufferMaterial(): THREE.ShaderMaterial {
  // Raw view-space normal + linear depth HalfFloat G-buffer (no tone mapping or sRGB encoding).
  const vert = `
    varying vec3 vViewN;
    varying float vLinDepth;
    void main() {
      vec4 pos = vec4(position, 1.0);
      vec3 n = normal;
      #ifdef USE_INSTANCING
        pos = instanceMatrix * pos;
        n = mat3(instanceMatrix) * n;
      #endif
      vec4 mv = modelViewMatrix * pos;
      vec3 vn = normalMatrix * n;
      float lsq = dot(vn, vn);
      vViewN = lsq > 1e-10 ? vn * inversesqrt(lsq) : vec3(0.0, 0.0, 1.0);
      vLinDepth = clamp(-mv.z / 600.0, 0.0, 1.0);
      gl_Position = projectionMatrix * mv;
    }
  `;
  const frag = `
    varying vec3 vViewN;
    varying float vLinDepth;
    void main() {
      float lsq = dot(vViewN, vViewN);
      vec3 n = lsq > 1e-10 ? vViewN * inversesqrt(lsq) : vec3(0.0, 0.0, 1.0);
      gl_FragColor = vec4(n * 0.5 + 0.5, vLinDepth);
    }
  `;
  return new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    side: THREE.FrontSide,
    fog: false,
  });
}

// ------------------------------------------------------------ Painterly Planar-Reflection Water

function createWatercolorWaterMaterial(terrain: Terrain, reflectionTex: THREE.Texture): THREE.ShaderMaterial {
  const depthTex = buildShoreDepthTex(terrain);
  const { texA, texB } = getBiomeTextures(terrain);
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    fog: false,
    uniforms: {
      uTime: celUniforms.uTime,
      uSunDir: celUniforms.uSunDir,
      uMoonDir: celUniforms.uMoonDir,
      uNightFactor: celUniforms.uNightFactor,
      uSunsetFactor: celUniforms.uSunsetFactor,
      uSkyHorizon: celUniforms.uSkyHorizon,
      uSunHaze: celUniforms.uSunHaze,
      uAerialBlue: celUniforms.uAerialBlue,
      uValleyMist: celUniforms.uValleyMist,
      uValleyMistBoost: celUniforms.uValleyMistBoost,
      uLitTint: celUniforms.uLitTint,
      uFogNear: celUniforms.uFogNear,
      uFogFar: celUniforms.uFogFar,
      uDepthMap: { value: depthTex },
      uBiomeA: { value: texA },
      uBiomeB: { value: texB },
      uWaterLevel: { value: WATER_LEVEL },
      uWorldHalf: { value: HALF },
      uWorldSize: { value: WORLD_SIZE },
      uReflectionMap: { value: reflectionTex },
      uReflMatrix: { value: new THREE.Matrix4() },
      uReflStrength: { value: ULTRA_CONFIG.reflStrength },
      uCausticsStrength: { value: ULTRA_CONFIG.causticsStrength },
    },
    vertexShader: /* glsl */ `
      uniform mat4 uReflMatrix;
      varying vec3 vWorldPos;
      varying vec4 vReflClip;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        vReflClip = uReflMatrix * wp;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uSunsetFactor;
      uniform vec3 uLitTint;
      uniform sampler2D uDepthMap;
      uniform sampler2D uBiomeA;
      uniform sampler2D uBiomeB;
      uniform float uWaterLevel;
      uniform float uWorldHalf;
      uniform float uWorldSize;
      uniform sampler2D uReflectionMap;
      uniform float uReflStrength;
      uniform float uCausticsStrength;
      varying vec3 vWorldPos;
      varying vec4 vReflClip;
      ${CEL_NOISE_GLSL}
      ${CEL_SAFE_MATH_GLSL}
      ${CEL_ATMOS_PARS_GLSL}

      float causticPattern(vec2 p, float t) {
        vec2 a = p * 0.42 + vec2(t * 0.24, -t * 0.19);
        vec2 b = p * 0.58 - vec2(t * 0.17, t * 0.26);
        float n1 = celNoise(a + vec2(sin(b.y * 1.4), cos(b.x * 1.4)) * 0.5);
        float n2 = celNoise(b + vec2(cos(a.x * 1.3), sin(a.y * 1.3)) * 0.5);
        float ridge = 1.0 - abs(n1 - n2) * 2.2;
        return safePow(clamp(ridge, 0.0, 1.0), 3.6);
      }

      void main() {
        vec2 uv = (vWorldPos.xz + uWorldHalf) / uWorldSize;
        float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
        vec2 cuv = clamp(uv, 0.0, 1.0);
        float texVal = texture2D(uDepthMap, cuv).r;
        float groundH = mix(uWaterLevel - 14.0, (uWaterLevel - 14.0) + texVal * 18.0, inside);
        float depth = max(0.0, uWaterLevel - groundH);

        vec4 wA = texture2D(uBiomeA, cuv) * inside;
        vec4 wB = texture2D(uBiomeB, cuv) * inside;
        float coastFade = smoothstep(320.0, 210.0, length(vWorldPos.xz));
        float wKarst = wA.g * coastFade;
        float wCanyon = wA.b * coastFade;
        float wMaple = wA.a * coastFade;
        float wMist = wB.r * coastFade;
        float wSnow = wB.g * coastFade;

        vec3 toFrag = vWorldPos - cameraPosition;
        float dist = length(toFrag);
        vec3 viewDir = toFrag / max(dist, 0.0001);

        vec3 colShallow = vec3(0.18, 0.76, 0.68);
        vec3 colMid     = vec3(0.05, 0.41, 0.67);
        vec3 colDeep    = vec3(0.025, 0.16, 0.42);

        colShallow = mix(colShallow, vec3(0.14, 0.84, 0.60), wKarst * 0.90);
        colMid     = mix(colMid,     vec3(0.04, 0.50, 0.46), wKarst * 0.85);
        colShallow = mix(colShallow, vec3(0.30, 0.66, 0.58), wCanyon * 0.75);
        colShallow = mix(colShallow, vec3(0.16, 0.58, 0.52), wMaple * 0.82);
        colMid     = mix(colMid,     vec3(0.05, 0.27, 0.39), wMaple * 0.82);
        colShallow = mix(colShallow, vec3(0.07, 0.38, 0.38), wMist * 0.85);
        colMid     = mix(colMid,     vec3(0.025, 0.18, 0.26), wMist * 0.85);
        colShallow = mix(colShallow, vec3(0.38, 0.78, 0.90), wSnow * 0.85);
        colMid     = mix(colMid,     vec3(0.10, 0.32, 0.62), wSnow * 0.75);

        float shallowT = smoothstep(0.12, 2.6, depth);
        float deepT    = smoothstep(2.1, 10.0, depth);
        vec3 waterCol  = mix(colShallow, colMid, shallowT);
        waterCol       = mix(waterCol, colDeep, deepT);

        vec2 wUv1 = vWorldPos.xz * 0.26 + vec2(uTime * 0.26, uTime * 0.14);
        vec2 wUv2 = vWorldPos.xz * 0.17 - vec2(uTime * 0.18, uTime * 0.22);
        vec2 wUv3 = vWorldPos.xz * 0.68 + vec2(-uTime * 0.34, uTime * 0.28);
        float r1 = celNoise(wUv1);
        float r2 = celNoise(wUv2 + r1 * 0.75);
        float r3 = celNoise(wUv3);

        float calmMask = clamp(wMaple * 0.65 + smoothstep(3.0, 0.3, depth) * 0.35, 0.0, 0.82);
        float waveAmp = mix(0.24, 0.075, calmMask);
        vec3 waveN = safeNormalize(vec3(
          (r1 - 0.5) * waveAmp + (r3 - 0.5) * waveAmp * 0.45,
          1.0,
          (r2 - 0.5) * waveAmp + (r3 - 0.5) * waveAmp * 0.45
        ));

        // Delicate sunlit underwater caustics in shallows
        float caustMask = smoothstep(6.2, 0.4, depth) * smoothstep(0.03, 0.25, depth) * inside * smoothstep(220.0, 35.0, dist);
        float caust = causticPattern(vWorldPos.xz + waveN.xz * 1.4, uTime) * caustMask * uCausticsStrength;
        vec3 caustCol = mix(vec3(0.68, 1.05, 0.96), vec3(1.15, 0.88, 0.56), uSunsetFactor * 0.65);
        caustCol = mix(caustCol, vec3(0.32, 0.65, 0.98), uNightFactor * 0.82);
        waterCol += caustCol * caust * (0.48 - 0.20 * uNightFactor);

        waterCol *= mix(vec3(1.0), vec3(1.12, 0.86, 0.74), uSunsetFactor * 0.52);
        waterCol *= mix(vec3(1.0), vec3(0.24, 0.35, 0.56), uNightFactor);

        float cSh = mix(0.84, 1.0, celCloudShadow(vWorldPos.xz, uTime));
        waterCol *= mix(cSh, 1.0, uNightFactor * 0.6);

        // Real-time planar reflection with soft painterly horizontal brush wash
        float ndotv = clamp(-dot(viewDir, waveN), 0.0, 1.0);
        float fresnel = 0.06 + 0.94 * safePow(1.0 - ndotv, 3.2);
        vec3 skyFallback = mix(uAerialBlue, uSkyHorizon, 0.55);

        vec2 reflUv = (vReflClip.xy / max(vReflClip.w, 0.0001)) * 0.5 + 0.5;
        float distortScale = mix(0.032, 0.012, calmMask) * smoothstep(320.0, 12.0, dist);
        vec2 distUv = reflUv + vec2(waveN.x, waveN.z * 0.7) * distortScale;
        vec2 clampedUv = clamp(distUv, vec2(0.003), vec2(0.997));
        vec3 reflC = texture2D(uReflectionMap, clampedUv).rgb;
        vec3 reflL = texture2D(uReflectionMap, clamp(clampedUv + vec2(-0.006, 0.0), vec2(0.003), vec2(0.997))).rgb;
        vec3 reflR = texture2D(uReflectionMap, clamp(clampedUv + vec2( 0.006, 0.0), vec2(0.003), vec2(0.997))).rgb;
        vec3 reflCol = reflC * 0.5 + reflL * 0.25 + reflR * 0.25;

        float edgeOk = smoothstep(0.0, 0.06, distUv.x) * smoothstep(1.0, 0.94, distUv.x)
                     * smoothstep(0.0, 0.06, distUv.y) * smoothstep(1.0, 0.94, distUv.y);
        reflCol = mix(skyFallback, reflCol, edgeOk);

        float reflFactor = clamp(fresnel * (0.72 + wMaple * 0.36 + wKarst * 0.14) * uReflStrength, 0.0, 0.90);
        reflFactor *= smoothstep(0.08, 1.35, depth);
        waterCol = mix(waterCol, reflCol, reflFactor);

        // Gouache wave ribbons
        float ripple = smoothstep(0.66, 0.76, r2) * smoothstep(240.0, 30.0, dist);
        vec3 rippleCol = mix(vec3(0.62, 0.94, 0.96), vec3(0.42, 0.66, 0.94), uNightFactor);
        rippleCol = mix(rippleCol, vec3(1.0, 0.82, 0.58), uSunsetFactor * 0.55);
        waterCol = mix(waterCol, rippleCol, ripple * 0.32 * mix(1.0, 0.45, calmMask));

        // Animated shoreline foam
        float shoreNoise = celNoise(vWorldPos.xz * 0.28 + vec2(uTime * 0.18, -uTime * 0.12));
        float waveLap = sin(depth * 5.4 - uTime * 2.2 + shoreNoise * 3.8);
        float innerFoam = smoothstep(0.54, 0.04, depth + (shoreNoise - 0.5) * 0.32);
        float outerRing = smoothstep(0.58, 0.84, waveLap) * smoothstep(2.1, 0.42, depth) * smoothstep(0.05, 0.34, depth);
        float foam = clamp(innerFoam * 0.95 + outerRing * 0.65, 0.0, 1.0) * inside * smoothstep(340.0, 90.0, dist);

        vec3 foamCol = mix(vec3(0.94, 0.97, 0.99), vec3(1.0, 0.86, 0.72), uSunsetFactor * 0.6);
        foamCol = mix(foamCol, vec3(0.58, 0.75, 0.94), uNightFactor);
        waterCol = mix(waterCol, foamCol, foam);

        // Crisp HDR sun/moon specular sparkles
        vec3 glintDir = safeNormalize(mix(uSunDir, uMoonDir, step(0.5, uNightFactor)));
        vec3 halfV = safeNormalize(glintDir - viewDir);
        float specPow = mix(140.0, 56.0, wMaple * uNightFactor);
        float spec = safePow(clamp(dot(waveN, halfV), 0.0, 1.0), specPow);
        float broadSpec = safePow(clamp(dot(waveN, halfV), 0.0, 1.0), 22.0) * 0.22;
        vec3 glintCol = mix(uSunHaze * 1.65, vec3(0.90, 1.22, 1.68) * (1.0 + wMaple * 0.45), uNightFactor);
        waterCol += glintCol * (smoothstep(0.22, 0.62, spec) * 1.12 + broadSpec) * cSh;

        float alpha = mix(0.46, 1.0, smoothstep(0.0, 3.8, depth));
        alpha = max(alpha, foam * 0.97);
        alpha = mix(alpha, 1.0, smoothstep(85.0, 210.0, dist));

        waterCol = applyCelAtmosphere(waterCol, vWorldPos);
        gl_FragColor = vec4(waterCol, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}

// ------------------------------------------------------------ Extended Backlit Grass & Wildflowers

function cellHash(ix: number, iz: number, salt: number): number {
  let h = Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(salt, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function buildUltraGrassGeo(): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const blades: [number, number, number, number, number, number][] = [
    [0.0, 0.0, 0.0, 0.11, 0.68, 0.20],
    [0.22, 0.08, 0.92, 0.10, 0.58, 0.22],
    [-0.20, 0.15, 1.85, 0.10, 0.62, 0.21],
    [0.10, -0.22, 2.75, 0.095, 0.54, 0.19],
    [-0.18, -0.14, 3.68, 0.10, 0.60, 0.20],
    [0.28, -0.12, 4.62, 0.09, 0.48, 0.18],
    [-0.06, 0.26, 5.55, 0.095, 0.55, 0.22],
  ];
  for (const [ox, oz, yaw, w, h, lean] of blades) {
    const cx = Math.cos(yaw), sz = Math.sin(yaw);
    const rx = cx * w, rz = sz * w;
    const fx = -sz * lean, fz = cx * lean;
    const midY = h * 0.52;
    const midFx = fx * 0.35, midFz = fz * 0.35;
    positions.push(
      ox - rx, 0, oz - rz,
      ox + rx, 0, oz + rz,
      ox + midFx + rx * 0.55, midY, oz + midFz + rz * 0.55,
      ox - rx, 0, oz - rz,
      ox + midFx + rx * 0.55, midY, oz + midFz + rz * 0.55,
      ox + midFx - rx * 0.55, midY, oz + midFz - rz * 0.55,
    );
    uvs.push(0, 0, 1, 0, 0.8, 0.52, 0, 0, 0.8, 0.52, 0.2, 0.52);
    positions.push(
      ox + midFx - rx * 0.55, midY, oz + midFz - rz * 0.55,
      ox + midFx + rx * 0.55, midY, oz + midFz + rz * 0.55,
      ox + fx, h, oz + fz,
    );
    uvs.push(0.2, 0.52, 0.8, 0.52, 0.5, 1.0);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.computeVertexNormals();
  return geo;
}

function buildUltraFlowerGeo(): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const spots: [number, number, number, number][] = [
    [0.0, 0.0, 0.13, 0.52],
    [0.26, 0.18, 0.105, 0.44],
    [-0.22, 0.20, 0.11, 0.46],
    [0.14, -0.24, 0.10, 0.42],
  ];
  for (const [ox, oz, r, y] of spots) {
    for (let k = 0; k < 2; k++) {
      const a = (k * Math.PI) / 2 + ox * 5.0;
      const dx = Math.cos(a) * r, dz = Math.sin(a) * r;
      positions.push(
        ox - dx, y - 0.12, oz - dz,
        ox + dx, y - 0.12, oz + dz,
        ox, y + 0.08, oz,
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

function createUltraGrassMaterial(isFlower: boolean): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    fog: false,
    uniforms: {
      uTime: celUniforms.uTime,
      uSunDir: celUniforms.uSunDir,
      uMoonDir: celUniforms.uMoonDir,
      uNightFactor: celUniforms.uNightFactor,
      uSunsetFactor: celUniforms.uSunsetFactor,
      uSkyHorizon: celUniforms.uSkyHorizon,
      uSunHaze: celUniforms.uSunHaze,
      uAerialBlue: celUniforms.uAerialBlue,
      uValleyMist: celUniforms.uValleyMist,
      uValleyMistBoost: celUniforms.uValleyMistBoost,
      uShadowTint: celUniforms.uShadowTint,
      uLitTint: celUniforms.uLitTint,
      uFogNear: celUniforms.uFogNear,
      uFogFar: celUniforms.uFogFar,
      uIsFlower: { value: isFlower ? 1.0 : 0.0 },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      varying vec3 vWorldPos;
      varying vec3 vInstColor;
      varying float vTip;
      varying float vGust;
      ${CEL_NOISE_GLSL}

      void main() {
        vTip = uv.y;
        #ifdef USE_INSTANCING_COLOR
          vInstColor = instanceColor;
        #else
          vInstColor = vec3(0.20, 0.50, 0.08);
        #endif

        vec4 baseWp = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float dist = length(baseWp.xyz - cameraPosition);
        float distScale = smoothstep(74.0, 48.0, dist);
        vec3 p = position * distScale;

        float waveA = celNoise(baseWp.xz * 0.036 - vec2(uTime * 0.72, uTime * 0.38));
        float waveB = celNoise(baseWp.xz * 0.085 - vec2(uTime * 1.05, -uTime * 0.45));
        float gust = waveA * 0.72 + waveB * 0.28;
        float flutter = sin(uTime * 3.4 + baseWp.x * 0.62 + baseWp.z * 0.47) * 0.5 + 0.5;
        float bend = (gust * 0.46 + flutter * 0.14) * vTip * vTip * distScale;
        vGust = gust;

        vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
        wp.x += bend * 0.92;
        wp.z += bend * 0.52;
        wp.y -= bend * 0.18;

        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uSunsetFactor;
      uniform vec3 uShadowTint;
      uniform vec3 uLitTint;
      uniform float uIsFlower;
      varying vec3 vWorldPos;
      varying vec3 vInstColor;
      varying float vTip;
      varying float vGust;
      ${CEL_NOISE_GLSL}
      ${CEL_SAFE_MATH_GLSL}
      ${CEL_ATMOS_PARS_GLSL}

      void main() {
        vec3 viewDir = safeNormalize(vWorldPos - cameraPosition);
        vec3 lDir = safeNormalize(mix(uSunDir, uMoonDir, uNightFactor));
        float backlit = safePow(clamp(dot(viewDir, lDir), 0.0, 1.0), 3.2) * vTip * (1.0 - 0.65 * uNightFactor);

        vec3 col;
        if (uIsFlower > 0.5) {
          col = vInstColor * mix(0.86, 1.14, vTip);
          col += uSunHaze * backlit * 0.35;
        } else {
          vec3 rootCol = vInstColor * 0.56;
          vec3 tipCol  = vInstColor * 1.32 + vec3(0.05, 0.08, 0.008);
          col = mix(rootCol, tipCol, smoothstep(0.0, 0.90, vTip));
          float shimmer = smoothstep(0.46, 0.80, vGust) * vTip * (1.0 - 0.65 * uNightFactor);
          col += vec3(0.11, 0.15, 0.02) * shimmer;
          vec3 sssTint = mix(vec3(0.55, 0.78, 0.16), vec3(1.0, 0.68, 0.25), uSunsetFactor);
          col += sssTint * backlit * 0.42;
        }

        float cloudVal = mix(0.54, 1.0, celCloudShadow(vWorldPos.xz, uTime));
        vec3 shade = mix(uShadowTint * 1.06, uLitTint * 1.04, mix(cloudVal, 0.85, uNightFactor));
        col *= shade;

        col = applyCelAtmosphere(col, vWorldPos);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}

class UltraGrassField {
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

  private static readonly GRID = 88;
  private static readonly STEP = 1.32;
  private static readonly FGRID = 36;
  private static readonly FSTEP = 2.8;

  private lastGx = 1e9;
  private lastGz = 1e9;
  private lastFx = 1e9;
  private lastFz = 1e9;

  private readonly flowerPalettes: THREE.Color[][] = [
    [new THREE.Color('#fffdf0'), new THREE.Color('#ffe054'), new THREE.Color('#86d2ff'), new THREE.Color('#ffaa90')],
    [new THREE.Color('#f2fffb'), new THREE.Color('#9ff2da'), new THREE.Color('#fff2b2')],
    [new THREE.Color('#ffaa4a'), new THREE.Color('#e85f3a'), new THREE.Color('#ffd478')],
    [new THREE.Color('#e8462c'), new THREE.Color('#f79633'), new THREE.Color('#ffd35c'), new THREE.Color('#fff4d6')],
    [new THREE.Color('#5ef2df'), new THREE.Color('#a48cff'), new THREE.Color('#c8fff4')],
    [new THREE.Color('#e2f3ff'), new THREE.Color('#a4d4ff')],
  ];

  private readonly extraAvoid = WONDER_DEFS.map((w) => ({ x: w.x, z: w.z, r: w.avoidR * 0.55 }));

  constructor(private readonly terrain: Terrain) {
    this.grass = new THREE.InstancedMesh(buildUltraGrassGeo(), createUltraGrassMaterial(false), UltraGrassField.GRID ** 2);
    this.flowers = new THREE.InstancedMesh(buildUltraFlowerGeo(), createUltraGrassMaterial(true), UltraGrassField.FGRID ** 2);
    this.grass.frustumCulled = false;
    this.flowers.frustumCulled = false;
    this.group.add(this.grass, this.flowers);
    this.group.visible = false;
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
    const G = UltraGrassField.GRID;
    const sx = ((gx % G) + G) % G;
    const sz = ((gz % G) + G) % G;
    const idx = sz * G + sx;

    const jx = (cellHash(gx, gz, 1) - 0.5) * 0.92;
    const jz = (cellHash(gx, gz, 2) - 0.5) * 0.92;
    const x = (gx + 0.5 + jx) * UltraGrassField.STEP;
    const z = (gz + 0.5 + jz) * UltraGrassField.STEP;

    const rOk = Math.abs(x) < HALF - 8 && Math.abs(z) < HALF - 8;
    const h = rOk ? this.terrain.height(x, z) : -99;
    const { index: bio } = rOk ? sampleDominantBiome(x, z) : { index: 0 };

    const maxH = bio === 5 ? 21 : bio === 2 ? 42 : 48;
    const flat = rOk && h > WATER_LEVEL + 1.6 && h < maxH ? this.terrain.flatness(x, z) : 0;
    const patch = flat > 0.76 ? this.meadow.noise(x * 0.022, z * 0.022) * 0.5 + 0.5 : 0;
    const r3 = cellHash(gx, gz, 3);

    let keep = flat > 0.76 && !this.keepOut(x, z);
    if (keep) {
      if (bio === 2) keep = r3 < 0.28 && patch > 0.32;
      else if (bio === 5) keep = r3 < 0.28 && h < 19.5;
      else if (bio === 4) keep = patch > 0.14 || r3 < 0.65;
      else keep = patch > 0.18 || r3 < 0.48;
    }

    if (!keep) {
      this.m.makeScale(0, 0, 0);
      this.grass.setMatrixAt(idx, this.m);
      return;
    }

    const sc = (bio === 4 ? 1.05 : bio === 2 ? 0.72 : 0.88) + cellHash(gx, gz, 4) * 0.72;
    const sy = sc * ((bio === 4 ? 1.0 : 0.80) + patch * 0.48 + cellHash(gx, gz, 5) * 0.30);
    this.q.setFromAxisAngle(this.up, cellHash(gx, gz, 6) * Math.PI * 2);
    this.s.set(sc, sy, sc);
    this.v.set(x, h - 0.05, z);
    this.m.compose(this.v, this.q, this.s);
    this.grass.setMatrixAt(idx, this.m);

    const h7 = cellHash(gx, gz, 7);
    const h8 = cellHash(gx, gz, 8);
    const h9 = cellHash(gx, gz, 9);
    if (bio === 1) this.c.setHSL(0.36 + patch * 0.05 + (h7 - 0.5) * 0.025, 0.58 + h8 * 0.12, 0.28 + patch * 0.08 + h9 * 0.05);
    else if (bio === 2) this.c.setHSL(0.11 + (h7 - 0.5) * 0.03, 0.54 + h8 * 0.14, 0.38 + patch * 0.08 + h9 * 0.05);
    else if (bio === 3) this.c.setHSL(0.15 + patch * 0.06 + (h7 - 0.5) * 0.05, 0.58 + h8 * 0.14, 0.32 + patch * 0.07 + h9 * 0.05);
    else if (bio === 4) this.c.setHSL(0.41 + patch * 0.05 + (h7 - 0.5) * 0.03, 0.54 + h8 * 0.12, 0.20 + patch * 0.06 + h9 * 0.04);
    else if (bio === 5) this.c.setHSL(0.50 + (h7 - 0.5) * 0.04, 0.24 + h8 * 0.10, 0.50 + h9 * 0.10);
    else this.c.setHSL(0.245 + patch * 0.045 + (h7 - 0.5) * 0.025, 0.66 + h8 * 0.12, 0.32 + patch * 0.08 + h9 * 0.05);
    this.grass.setColorAt(idx, this.c);
  }

  private fillFlowerCell(fx: number, fz: number) {
    const F = UltraGrassField.FGRID;
    const sx = ((fx % F) + F) % F;
    const sz = ((fz % F) + F) % F;
    const idx = sz * F + sx;

    const jx = (cellHash(fx, fz, 11) - 0.5) * 0.85;
    const jz = (cellHash(fx, fz, 12) - 0.5) * 0.85;
    const x = (fx + 0.5 + jx) * UltraGrassField.FSTEP;
    const z = (fz + 0.5 + jz) * UltraGrassField.FSTEP;

    const rOk = Math.abs(x) < HALF - 10 && Math.abs(z) < HALF - 10;
    const h = rOk ? this.terrain.height(x, z) : -99;
    const { index: bio } = rOk ? sampleDominantBiome(x, z) : { index: 0 };

    const maxH = bio === 5 ? 18 : 44;
    const flat = rOk && h > WATER_LEVEL + 1.8 && h < maxH ? this.terrain.flatness(x, z) : 0;
    const patch = flat > 0.78 ? this.meadow.noise(x * 0.025, z * 0.025) * 0.5 + 0.5 : 0;
    const chance = bio === 2 ? 0.18 : bio === 5 ? 0.12 : bio === 3 ? 0.62 : 0.52;
    const keep = flat > 0.78 && patch > 0.38 && cellHash(fx, fz, 13) < chance && !this.keepOut(x, z);

    if (!keep) {
      this.m.makeScale(0, 0, 0);
      this.flowers.setMatrixAt(idx, this.m);
      return;
    }

    const sc = 0.90 + cellHash(fx, fz, 14) * 0.60;
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
    if (!this.group.visible) return;
    const G = UltraGrassField.GRID;
    const halfG = G >> 1;
    const cgx = Math.floor(focus.x / UltraGrassField.STEP);
    const cgz = Math.floor(focus.z / UltraGrassField.STEP);
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
          for (let z = minZ; z < maxZ; z++) for (let x = xStart; x < xEnd; x++) this.fillGrassCell(x, z);
        }
        if (dz !== 0) {
          const zStart = dz > 0 ? maxZ - dz : minZ;
          const zEnd = dz > 0 ? maxZ : minZ - dz;
          for (let z = zStart; z < zEnd; z++) for (let x = minX; x < maxX; x++) this.fillGrassCell(x, z);
        }
      }
      this.lastGx = cgx;
      this.lastGz = cgz;
      this.grass.instanceMatrix.needsUpdate = true;
      if (this.grass.instanceColor) this.grass.instanceColor.needsUpdate = true;
    }

    const F = UltraGrassField.FGRID;
    const halfF = F >> 1;
    const cfx = Math.floor(focus.x / UltraGrassField.FSTEP);
    const cfz = Math.floor(focus.z / UltraGrassField.FSTEP);
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

// ------------------------------------------------------------ GPU Biome Atmosphere Swarm (900 motes)

class UltraAtmosphereSwarm {
  readonly points: THREE.Points;
  private readonly mat: THREE.ShaderMaterial;
  private readonly colA = new THREE.Color();
  private readonly colB = new THREE.Color();
  private readonly drift = new THREE.Vector3();

  constructor(count: number) {
    const rand = mulberry32(9021);
    const seeds = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const phases = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      seeds[i * 3] = (rand() - 0.5) * 110;
      seeds[i * 3 + 1] = rand() * 34 - 4;
      seeds[i * 3 + 2] = (rand() - 0.5) * 110;
      sizes[i] = 0.55 + rand() * 1.15;
      phases[i] = rand() * Math.PI * 2;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(seeds, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));

    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      uniforms: {
        uTime: celUniforms.uTime,
        uNightFactor: celUniforms.uNightFactor,
        uSunsetFactor: celUniforms.uSunsetFactor,
        uCenter: { value: new THREE.Vector3() },
        uColA: { value: new THREE.Color(1.2, 1.12, 0.88) },
        uColB: { value: new THREE.Color(1.15, 0.96, 0.65) },
        uDrift: { value: new THREE.Vector3(1.1, 0.15, 0.45) },
        uAlpha: { value: 0.65 },
        uScale: { value: 420 },
      },
      vertexShader: /* glsl */ `
        attribute float aSize;
        attribute float aPhase;
        uniform float uTime;
        uniform vec3 uCenter;
        uniform vec3 uDrift;
        uniform float uScale;
        varying float vPhase;
        varying float vFade;
        varying float vMix;

        void main() {
          vPhase = aPhase;
          vMix = fract(aPhase * 1.618);

          vec3 span = vec3(110.0, 34.0, 110.0);
          vec3 p = position + uDrift * uTime;
          p.x += sin(uTime * 0.9 + aPhase * 2.1) * 1.8;
          p.y += cos(uTime * 0.75 + aPhase * 3.3) * 1.1;
          p.z += cos(uTime * 0.82 + aPhase * 1.7) * 1.8;

          vec3 rel = mod(p - uCenter + span * 0.5, span) - span * 0.5;
          vec3 wp = uCenter + rel;
          wp.y = max(wp.y, ${WATER_LEVEL.toFixed(2)} + 0.6);

          vFade = smoothstep(55.0, 32.0, length(rel.xz)) * smoothstep(2.0, 6.0, length(wp - cameraPosition));

          vec4 mv = modelViewMatrix * vec4(wp, 1.0);
          gl_PointSize = clamp(aSize * 0.36 * uScale / max(1.0, -mv.z), 1.5, 22.0);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uNightFactor;
        uniform float uSunsetFactor;
        uniform vec3 uColA;
        uniform vec3 uColB;
        uniform float uAlpha;
        varying float vPhase;
        varying float vFade;
        varying float vMix;

        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          float core = smoothstep(1.0, 0.0, d);
          core = core * core;
          float twinkle = 0.58 + 0.42 * sin(uTime * (2.2 + vMix * 2.4) + vPhase * 5.0);
          vec3 col = mix(uColA, uColB, vMix);
          col *= mix(1.0, 1.32, uSunsetFactor * 0.5 + uNightFactor * 0.85);
          float a = core * twinkle * vFade * uAlpha;
          if (a < 0.004) discard;
          gl_FragColor = vec4(col * a, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });

    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
    this.points.visible = false;
  }

  setViewport(heightPx: number, fovDeg: number) {
    this.mat.uniforms.uScale.value = (heightPx * 0.5) / Math.tan((fovDeg * Math.PI) / 360);
  }

  update(focus: THREE.Vector3, weights: Float32Array) {
    if (!this.points.visible) return;
    this.mat.uniforms.uCenter.value.copy(focus);
    const night = celUniforms.uNightFactor.value;
    this.colA.setRGB(0, 0, 0);
    this.colB.setRGB(0, 0, 0);
    this.drift.set(0, 0, 0);
    let alpha = 0;

    for (let i = 0; i < BIOME_COUNT; i++) {
      const w = weights[i];
      if (w <= 0.001) continue;
      const m = BIOMES[i].motes;
      this.colA.r += (m.dayColA.r + (m.nightColA.r - m.dayColA.r) * night) * w;
      this.colA.g += (m.dayColA.g + (m.nightColA.g - m.dayColA.g) * night) * w;
      this.colA.b += (m.dayColA.b + (m.nightColA.b - m.dayColA.b) * night) * w;
      this.colB.r += (m.dayColB.r + (m.nightColB.r - m.dayColB.r) * night) * w;
      this.colB.g += (m.dayColB.g + (m.nightColB.g - m.dayColB.g) * night) * w;
      this.colB.b += (m.dayColB.b + (m.nightColB.b - m.dayColB.b) * night) * w;
      this.drift.addScaledVector(m.drift, w * 1.35);
      alpha += (m.dayAlpha + (m.nightAlpha - m.dayAlpha) * night) * w;
    }

    this.mat.uniforms.uColA.value.copy(this.colA);
    this.mat.uniforms.uColB.value.copy(this.colB);
    this.mat.uniforms.uDrift.value.copy(this.drift);
    this.mat.uniforms.uAlpha.value = Math.min(1.0, alpha * 0.92);
  }
}

// ------------------------------------------------------------ Living Watercolor Master Composite Pass

function createWatercolorCompositeShader(gbufTex: THREE.Texture): {
  uniforms: Record<string, THREE.IUniform>;
  vertexShader: string;
  fragmentShader: string;
} {
  return {
    uniforms: {
      tDiffuse: { value: null },
      tGBuf: { value: gbufTex },
      uResolution: { value: new THREE.Vector2(1280, 720) },
      uTime: celUniforms.uTime,
      uSunDir: celUniforms.uSunDir,
      uMoonDir: celUniforms.uMoonDir,
      uNightFactor: celUniforms.uNightFactor,
      uSunsetFactor: celUniforms.uSunsetFactor,
      uSunHaze: celUniforms.uSunHaze,
      uShadowTint: celUniforms.uShadowTint,
      uValleyMist: celUniforms.uValleyMist,
      uSunScreenUv: { value: new THREE.Vector2(0.5, 0.7) },
      uSunFacing: { value: 0.0 },
      uLightElev: { value: 0.4 },
      uCamPos: { value: new THREE.Vector3() },
      uInvProjView: { value: new THREE.Matrix4() },
      uProjScale: { value: new THREE.Vector2(1.0, 1.0) },
      uGodRayStrength: { value: ULTRA_CONFIG.godRayStrength },
      uWatercolorInk: { value: ULTRA_CONFIG.watercolorInk },
      uKuwaharaStrength: { value: ULTRA_CONFIG.kuwaharaStrength },
      uPaperGrain: { value: ULTRA_CONFIG.paperGrain },
      uSsaoStrength: { value: ULTRA_CONFIG.ssaoStrength },
      uVolFogStrength: { value: ULTRA_CONFIG.volFogStrength },
      uGouacheGrade: { value: ULTRA_CONFIG.gouacheGrade },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse;
      uniform sampler2D tGBuf;
      uniform vec2 uResolution;
      uniform float uTime;
      uniform vec3 uSunDir;
      uniform vec3 uMoonDir;
      uniform float uNightFactor;
      uniform float uSunsetFactor;
      uniform vec3 uSunHaze;
      uniform vec3 uShadowTint;
      uniform vec3 uValleyMist;
      uniform vec2 uSunScreenUv;
      uniform float uSunFacing;
      uniform float uLightElev;
      uniform vec3 uCamPos;
      uniform mat4 uInvProjView;
      uniform vec2 uProjScale;

      uniform float uGodRayStrength;
      uniform float uWatercolorInk;
      uniform float uKuwaharaStrength;
      uniform float uPaperGrain;
      uniform float uSsaoStrength;
      uniform float uVolFogStrength;
      uniform float uGouacheGrade;

      varying vec2 vUv;
      ${CEL_NOISE_GLSL}
      ${CEL_SAFE_MATH_GLSL}

      vec3 sanitizeRgb(vec3 c) {
        return vec3(
          (c.r >= 0.0 && c.r <= 65000.0) ? c.r : 0.0,
          (c.g >= 0.0 && c.g <= 65000.0) ? c.g : 0.0,
          (c.b >= 0.0 && c.b <= 65000.0) ? c.b : 0.0
        );
      }

      float ign(vec2 fragPx) {
        vec3 magic = vec3(0.06711056, 0.00583715, 52.9829189);
        return fract(magic.z * fract(dot(fragPx, magic.xy)));
      }

      vec3 reconstructViewPos(vec2 uv, float linDepth01) {
        float z = linDepth01 * 600.0;
        vec2 ndc = uv * 2.0 - 1.0;
        return vec3(ndc.x * z * uProjScale.x, ndc.y * z * uProjScale.y, -z);
      }

      void main() {
        vec2 px = 1.0 / max(uResolution, vec2(1.0));
        vec4 gCenter = texture2D(tGBuf, vUv);
        float dCenter = gCenter.a;
        vec3 nCenter = safeNormalize(gCenter.rgb * 2.0 - 1.0);
        float isSky = step(0.992, dCenter);
        float zMeters = dCenter * 600.0;

        vec3 col = sanitizeRgb(texture2D(tDiffuse, vUv).rgb);

        // 1. Anisotropic Kuwahara painterly brush smoothing on mid-ground surfaces
        if (isSky < 0.5) {
          float brushMask = smoothstep(0.012, 0.06, dCenter) * smoothstep(0.65, 0.14, dCenter);
          if (brushMask > 0.02) {
            vec2 stepPx = px * 1.45;
            vec3 m0 = vec3(0.0), m1 = vec3(0.0), m2 = vec3(0.0), m3 = vec3(0.0);
            vec3 s0 = vec3(0.0), s1 = vec3(0.0), s2 = vec3(0.0), s3 = vec3(0.0);
            for (int j = -1; j <= 0; j++) {
              for (int i = -1; i <= 0; i++) {
                vec3 c0 = sanitizeRgb(texture2D(tDiffuse, vUv + vec2(float(i),     float(j))     * stepPx).rgb);
                vec3 c1 = sanitizeRgb(texture2D(tDiffuse, vUv + vec2(float(i + 1), float(j))     * stepPx).rgb);
                vec3 c2 = sanitizeRgb(texture2D(tDiffuse, vUv + vec2(float(i),     float(j + 1)) * stepPx).rgb);
                vec3 c3 = sanitizeRgb(texture2D(tDiffuse, vUv + vec2(float(i + 1), float(j + 1)) * stepPx).rgb);
                m0 += c0; s0 += c0 * c0;
                m1 += c1; s1 += c1 * c1;
                m2 += c2; s2 += c2 * c2;
                m3 += c3; s3 += c3 * c3;
              }
            }
            m0 *= 0.25; m1 *= 0.25; m2 *= 0.25; m3 *= 0.25;
            float v0 = dot(abs(s0 * 0.25 - m0 * m0), vec3(1.0));
            float v1 = dot(abs(s1 * 0.25 - m1 * m1), vec3(1.0));
            float v2 = dot(abs(s2 * 0.25 - m2 * m2), vec3(1.0));
            float v3 = dot(abs(s3 * 0.25 - m3 * m3), vec3(1.0));
            vec3 best = m0; float minV = v0;
            if (v1 < minV) { minV = v1; best = m1; }
            if (v2 < minV) { minV = v2; best = m2; }
            if (v3 < minV) { best = m3; }
            col = mix(col, best, uKuwaharaStrength * brushMask * 0.68);
          }
        }

        // 2. Subtle 12-tap biome-tinted Horizon SSAO for grounded watercolor contact shadows
        if (isSky < 0.5 && zMeters < 240.0) {
          vec3 vp = reconstructViewPos(vUv, dCenter);
          float worldRad = mix(2.2, 5.2, smoothstep(10.0, 95.0, zMeters));
          float screenRad = clamp(worldRad / max(zMeters * uProjScale.y, 0.35), 0.004, 0.048);
          float rot = ign(vUv * uResolution) * 6.283185;
          float occ = 0.0;
          const int SAMPLES = 12;
          for (int i = 0; i < SAMPLES; i++) {
            float fi = float(i);
            float ang = rot + fi * 2.3999632;
            float r = sqrt((fi + 0.5) / float(SAMPLES)) * screenRad;
            vec2 suv = clamp(vUv + vec2(cos(ang) * (uResolution.y / uResolution.x), sin(ang)) * r, vec2(0.002), vec2(0.998));
            float sd = texture2D(tGBuf, suv).a;
            if (sd < 0.992) {
              vec3 svp = reconstructViewPos(suv, sd);
              vec3 diff = svp - vp;
              float distSq = dot(diff, diff);
              if (distSq > 1e-4) {
                float invD = inversesqrt(distSq);
                float nd = max(0.0, dot(nCenter, diff * invD) - 0.10);
                float rangeW = smoothstep(worldRad * 2.2, worldRad * 0.35, distSq * invD);
                occ += nd * rangeW / (1.0 + distSq * 0.08);
              }
            }
          }
          occ = clamp((occ / float(SAMPLES)) * 2.55, 0.0, 0.82);
          float aoAmt = occ * uSsaoStrength * smoothstep(240.0, 145.0, zMeters);
          vec3 aoTint = mix(uShadowTint * 0.52, vec3(0.16, 0.22, 0.36), uNightFactor * 0.6);
          col = mix(col, col * aoTint, aoAmt * 0.85);
        }

        // 3. Depth + View-Normal watercolor ink contours & wet-edge pigment pooling
        if (isSky < 0.5) {
          vec4 gL = texture2D(tGBuf, vUv - vec2(px.x, 0.0));
          vec4 gR = texture2D(tGBuf, vUv + vec2(px.x, 0.0));
          vec4 gD = texture2D(tGBuf, vUv - vec2(0.0, px.y));
          vec4 gU = texture2D(tGBuf, vUv + vec2(0.0, px.y));

          float dJump = (abs(gL.a - gR.a) + abs(gD.a - gU.a)) / max(dCenter, 0.012);
          float depthEdge = smoothstep(0.045, 0.18, dJump);

          vec3 nL = safeNormalize(gL.rgb * 2.0 - 1.0);
          vec3 nR = safeNormalize(gR.rgb * 2.0 - 1.0);
          vec3 nD = safeNormalize(gD.rgb * 2.0 - 1.0);
          vec3 nU = safeNormalize(gU.rgb * 2.0 - 1.0);
          float nDiff = (1.0 - dot(nL, nR)) + (1.0 - dot(nD, nU));
          float normEdge = smoothstep(0.14, 0.52, nDiff);

          float edge = clamp(max(depthEdge, normEdge * 0.85), 0.0, 1.0);
          float distFade = smoothstep(0.42, 0.025, dCenter);
          vec3 inkCol = mix(vec3(0.14, 0.18, 0.28), vec3(0.24, 0.14, 0.14), uSunsetFactor * 0.65);
          inkCol = mix(inkCol, vec3(0.08, 0.14, 0.26), uNightFactor * 0.6);
          col = mix(col, mix(col * 0.42, inkCol, 0.48), edge * distFade * uWatercolorInk * 0.72);
        }

        // 4. Delicate valley height-mist veil
        {
          vec4 clipFar = vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
          vec4 worldFar = uInvProjView * clipFar;
          vec3 rayDir = safeNormalize(worldFar.xyz / max(abs(worldFar.w), 0.0001) - uCamPos);
          float rayLen = isSky > 0.5 ? 240.0 : min(zMeters, 240.0);

          vec3 lDir = safeNormalize(mix(uSunDir, uMoonDir, uNightFactor));
          float hg = safePow(clamp(dot(rayDir, lDir), 0.0, 1.0), 4.0);

          float mistAcc = 0.0;
          float jitter = ign(vUv * uResolution);
          for (int i = 0; i < 4; i++) {
            float t = (float(i) + 0.25 + jitter * 0.5) / 4.0;
            float distS = mix(22.0, rayLen, t);
            vec3 wp = uCamPos + rayDir * distS;
            float hMask = smoothstep(34.0, 2.0, wp.y);
            float n = celFbm(wp.xz * 0.014 + vec2(uTime * 0.024, -uTime * 0.014));
            mistAcc += hMask * smoothstep(0.28, 0.78, n) * smoothstep(18.0, 75.0, distS);
          }
          float fogAmt = clamp((mistAcc * 0.25) * uVolFogStrength * 0.48, 0.0, 0.48);
          vec3 fogCol = mix(uValleyMist, uSunHaze * 1.18, hg * (0.62 - 0.18 * uNightFactor) + uSunsetFactor * 0.35);
          fogCol = mix(fogCol, vec3(0.22, 0.48, 0.62), uNightFactor * 0.58);
          col = mix(col, fogCol, fogAmt);
        }

        // 5. Soft depth-occluded volumetric sun/moon god-rays (1/3 strength)
        {
          float sunVis = smoothstep(0.02, 0.52, uSunFacing) * smoothstep(-0.14, 0.10, uLightElev);
          if (sunVis > 0.005) {
            vec2 deltaUv = (vUv - uSunScreenUv);
            float sunDist = length(deltaUv * vec2(uResolution.x / uResolution.y, 1.0));
            float radialMask = smoothstep(1.35, 0.04, sunDist);
            if (radialMask > 0.005) {
              vec2 stepUv = deltaUv * (0.82 / 24.0);
              vec2 suv = vUv - stepUv * ign(vUv * uResolution);
              float decay = 1.0;
              float rays = 0.0;
              for (int i = 0; i < 24; i++) {
                suv -= stepUv;
                if (suv.x >= 0.0 && suv.x <= 1.0 && suv.y >= 0.0 && suv.y <= 1.0) {
                  float sd = texture2D(tGBuf, suv).a;
                  rays += smoothstep(0.96, 0.995, sd) * decay;
                }
                decay *= 0.945;
              }
              rays = (rays / 24.0) * radialMask * sunVis * uGodRayStrength;
              vec3 rayCol = mix(uSunHaze * 1.05, vec3(1.18, 0.68, 0.34), uSunsetFactor * 0.85);
              rayCol = mix(rayCol, vec3(0.55, 0.78, 1.15), uNightFactor * 0.85);
              col += rayCol * rays * 0.58;
            }
          }
        }

        // 6. Subtle warm/cool gouache split-tone harmony
        {
          float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
          vec3 coolShadow = mix(vec3(0.90, 0.96, 1.12), vec3(0.96, 0.92, 1.10), uSunsetFactor);
          vec3 warmHigh = mix(vec3(1.06, 1.03, 0.96), vec3(1.12, 0.98, 0.88), uSunsetFactor);
          vec3 graded = col * mix(coolShadow, warmHigh, smoothstep(0.12, 0.78, lum));
          float midSat = 1.0 + 0.14 * uGouacheGrade * smoothstep(0.04, 0.35, lum) * smoothstep(1.6, 0.5, lum);
          graded = mix(vec3(lum), graded, midSat);
          col = mix(col, graded, uGouacheGrade * 0.85);
        }

        // 7. 300gsm cold-press cotton watercolor paper tooth
        {
          vec2 pUv = vUv * uResolution * 0.18;
          float fiber = (celNoise(pUv) * 0.65 + celNoise(pUv * 2.7 + vec2(11.3, 7.1)) * 0.35) - 0.5;
          float lum = dot(col, vec3(0.299, 0.587, 0.114));
          col *= 1.0 + fiber * uPaperGrain * (0.045 + 0.040 * smoothstep(0.2, 0.9, lum));
        }

        // Delicate optical framing vignette
        vec2 vigUv = vUv * 2.0 - 1.0;
        col *= clamp(1.0 - dot(vigUv, vigUv) * (0.065 + 0.055 * uGouacheGrade), 0.78, 1.0);

        gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  };
}

// ------------------------------------------------------------ Production UltraQualityPipeline

interface UltraResources {
  gbufRT: THREE.WebGLRenderTarget;
  gbufMat: THREE.ShaderMaterial;
  reflRT: THREE.WebGLRenderTarget;
  reflCam: THREE.PerspectiveCamera;
  waterClipPlane: THREE.Plane;
  ultraWaterMat: THREE.ShaderMaterial;
  ultraComposer: EffectComposer;
  ultraBloomPass: UnrealBloomPass;
  ultraCompositePass: ShaderPass;
  ultraGrass: UltraGrassField;
  ultraSwarm: UltraAtmosphereSwarm;
}

/**
 * Lazy-allocated iPhone 17+ High-Quality ("Living Watercolor") rendering pipeline.
 * Consumes zero VRAM and zero extra draw calls while in `standard` mode.
 */
export class UltraQualityPipeline {
  private mode: QualityMode = 'standard';
  private res: UltraResources | null = null;
  private readonly baselineWaterMat: THREE.Material | THREE.Material[];
  private readonly baselineExposure: number;

  // Scratch math objects (zero per-frame GC)
  private readonly tmpDir = new THREE.Vector3();
  private readonly tmpTarget = new THREE.Vector3();
  private readonly tmpLightWorld = new THREE.Vector3();
  private readonly tmpReflProjView = new THREE.Matrix4();
  private readonly tmpInvProjView = new THREE.Matrix4();
  private readonly tmpClearCol = new THREE.Color();
  private readonly gbufClearCol = new THREE.Color(0.5, 0.5, 1.0);

  constructor(private readonly host: UltraQualityHost) {
    this.baselineWaterMat = host.waterMesh.material;
    this.baselineExposure = host.renderer.toneMappingExposure;
  }

  getMode(): QualityMode {
    return this.mode;
  }

  isUltra(): boolean {
    return this.mode === 'ultra';
  }

  getDprCap(): number {
    return this.mode === 'ultra' ? ULTRA_CONFIG.dprCap : ULTRA_CONFIG.standardDprCap;
  }

  private ensureResources(): UltraResources {
    if (this.res) return this.res;
    const { renderer, scene, camera, terrain } = this.host;
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);

    const gbufRT = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
    });
    const gbufMat = createGBufferMaterial();

    const reflRT = new THREE.WebGLRenderTarget(Math.max(1, Math.floor(w * 0.5)), Math.max(1, Math.floor(h * 0.5)), {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
    });
    const reflCam = new THREE.PerspectiveCamera();
    const waterClipPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(WATER_LEVEL - 0.18));
    const ultraWaterMat = createWatercolorWaterMaterial(terrain, reflRT.texture);

    const msaaSamples = renderer.capabilities.isWebGL2 ? 4 : 0;
    const ultraRT = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      samples: msaaSamples,
    });
    const ultraComposer = new EffectComposer(renderer, ultraRT);
    const ultraRenderPass = new RenderPass(scene, camera);
    const ultraBloomPass = new UnrealBloomPass(
      new THREE.Vector2(Math.max(1, Math.floor(w * 0.5)), Math.max(1, Math.floor(h * 0.5))),
      0.30,
      ULTRA_CONFIG.bloomRadius,
      ULTRA_CONFIG.bloomThreshold,
    );
    ultraBloomPass.materialHighPassFilter.fragmentShader = ultraBloomPass.materialHighPassFilter.fragmentShader.replace(
      'vec4 texel = texture2D( tDiffuse, vUv );',
      /* glsl */ `
      vec4 texel = texture2D( tDiffuse, vUv );
      texel.rgb = vec3(
        ( texel.r >= 0.0 && texel.r <= 65000.0 ) ? min( texel.r, 12.0 ) : 0.0,
        ( texel.g >= 0.0 && texel.g <= 65000.0 ) ? min( texel.g, 12.0 ) : 0.0,
        ( texel.b >= 0.0 && texel.b <= 65000.0 ) ? min( texel.b, 12.0 ) : 0.0
      );
      `,
    );
    ultraBloomPass.materialHighPassFilter.needsUpdate = true;

    const ultraCompositePass = new ShaderPass(createWatercolorCompositeShader(gbufRT.texture));
    ultraComposer.addPass(ultraRenderPass);
    ultraComposer.addPass(ultraBloomPass);
    ultraComposer.addPass(ultraCompositePass);

    const ultraGrass = new UltraGrassField(terrain);
    const ultraSwarm = new UltraAtmosphereSwarm(ULTRA_CONFIG.swarmCount);
    scene.add(ultraGrass.group, ultraSwarm.points);

    this.res = {
      gbufRT,
      gbufMat,
      reflRT,
      reflCam,
      waterClipPlane,
      ultraWaterMat,
      ultraComposer,
      ultraBloomPass,
      ultraCompositePass,
      ultraGrass,
      ultraSwarm,
    };
    return this.res;
  }

  setMode(next: QualityMode) {
    if (next === this.mode && (next === 'standard' || this.res !== null)) return;
    this.mode = next;
    const { renderer, waterMesh } = this.host;

    if (next === 'ultra') {
      const r = this.ensureResources();
      this.host.setShadowConfig(ULTRA_CONFIG.shadowSize, ULTRA_CONFIG.shadowRange, true);
      renderer.toneMappingExposure = ULTRA_CONFIG.exposure;
      waterMesh.material = r.ultraWaterMat;
      r.ultraSwarm.points.visible = true;
    } else {
      this.host.setShadowConfig(ULTRA_CONFIG.standardShadowSize, ULTRA_CONFIG.standardShadowRange, false);
      renderer.toneMappingExposure = this.baselineExposure;
      waterMesh.material = this.baselineWaterMat;
      if (this.res) {
        this.res.ultraGrass.group.visible = false;
        this.res.ultraSwarm.points.visible = false;
      }
    }
  }

  resize(w: number, h: number, pr: number, fovDeg: number) {
    if (!this.res || this.mode !== 'ultra') return;
    const rw = Math.max(1, Math.floor(w * pr));
    const rh = Math.max(1, Math.floor(h * pr));
    this.res.ultraComposer.setPixelRatio(pr);
    this.res.ultraComposer.setSize(w, h);
    this.res.ultraBloomPass.resolution.set(Math.max(1, Math.floor(w * 0.5)), Math.max(1, Math.floor(h * 0.5)));
    // Keep G-Buffer super crisp (~1.5x CSS px on 3x Retina OLED, 0.75x on 1x desktop) while cutting mobile bandwidth >55%
    const gScale = pr > 1.5 ? 0.5 : 0.75;
    this.res.gbufRT.setSize(Math.max(1, Math.floor(rw * gScale)), Math.max(1, Math.floor(rh * gScale)));
    this.res.reflRT.setSize(Math.max(1, Math.floor(rw * 0.5)), Math.max(1, Math.floor(rh * 0.5)));
    this.res.ultraCompositePass.uniforms.uResolution.value.set(rw, rh);
    this.res.ultraSwarm.setViewport(rh, fovDeg);
  }

  private renderGBuffer(r: UltraResources) {
    const { renderer, scene, camera, sky, waterMesh, clouds, aurora, karstCloudSea, ambientMotes, grassField } = this.host;
    const prevSky = sky.visible;
    const prevWater = waterMesh.visible;
    const prevClouds = clouds.visible;
    const prevAurora = aurora.visible;
    const prevCloudSea = karstCloudSea.visible;
    const prevMotes = ambientMotes.points.visible;
    const prevSwarm = r.ultraSwarm.points.visible;
    const prevGrass = grassField.group.visible;
    const prevUltraGrass = r.ultraGrass.group.visible;

    sky.visible = false;
    waterMesh.visible = false;
    clouds.visible = false;
    aurora.visible = false;
    karstCloudSea.visible = false;
    ambientMotes.points.visible = false;
    r.ultraSwarm.points.visible = false;
    grassField.group.visible = false;
    r.ultraGrass.group.visible = false;

    renderer.getClearColor(this.tmpClearCol);
    const prevClearAlpha = renderer.getClearAlpha();
    const prevOverride = scene.overrideMaterial;

    scene.overrideMaterial = r.gbufMat;
    renderer.setRenderTarget(r.gbufRT);
    renderer.setClearColor(this.gbufClearCol, 1.0);
    renderer.clear(true, true, false);
    renderer.render(scene, camera);

    scene.overrideMaterial = prevOverride;
    renderer.setClearColor(this.tmpClearCol, prevClearAlpha);
    renderer.setRenderTarget(null);

    sky.visible = prevSky;
    waterMesh.visible = prevWater;
    clouds.visible = prevClouds;
    aurora.visible = prevAurora;
    karstCloudSea.visible = prevCloudSea;
    ambientMotes.points.visible = prevMotes;
    r.ultraSwarm.points.visible = prevSwarm;
    grassField.group.visible = prevGrass;
    r.ultraGrass.group.visible = prevUltraGrass;
  }

  private renderPlanarReflection(r: UltraResources) {
    const { renderer, scene, camera, sky, waterMesh, grassField } = this.host;
    if (camera.position.y <= WATER_LEVEL + 0.15) return;

    camera.getWorldDirection(this.tmpDir);
    r.reflCam.position.set(camera.position.x, 2 * WATER_LEVEL - camera.position.y, camera.position.z);
    this.tmpTarget.set(
      r.reflCam.position.x + this.tmpDir.x,
      r.reflCam.position.y - this.tmpDir.y,
      r.reflCam.position.z + this.tmpDir.z,
    );
    r.reflCam.up.set(0, 1, 0);
    r.reflCam.fov = camera.fov;
    r.reflCam.aspect = camera.aspect;
    r.reflCam.near = camera.near;
    r.reflCam.far = camera.far;
    r.reflCam.lookAt(this.tmpTarget);
    r.reflCam.updateProjectionMatrix();
    r.reflCam.updateMatrixWorld();

    this.tmpReflProjView.multiplyMatrices(r.reflCam.projectionMatrix, r.reflCam.matrixWorldInverse);
    r.ultraWaterMat.uniforms.uReflMatrix.value.copy(this.tmpReflProjView);

    const prevWater = waterMesh.visible;
    const prevGrass = grassField.group.visible;
    const prevUltraGrass = r.ultraGrass.group.visible;
    const prevShadowAuto = renderer.shadowMap.autoUpdate;

    waterMesh.visible = false;
    grassField.group.visible = false;
    r.ultraGrass.group.visible = false;
    sky.position.copy(r.reflCam.position);

    renderer.clippingPlanes = [r.waterClipPlane];
    renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(r.reflRT);
    renderer.clear(true, true, false);
    renderer.render(scene, r.reflCam);

    renderer.setRenderTarget(null);
    renderer.clippingPlanes = [];
    renderer.shadowMap.autoUpdate = prevShadowAuto;

    sky.position.copy(camera.position);
    waterMesh.visible = prevWater;
    grassField.group.visible = prevGrass;
    r.ultraGrass.group.visible = prevUltraGrass;
  }

  private updateCompositeUniforms(r: UltraResources) {
    const { camera } = this.host;
    const u = r.ultraCompositePass.uniforms;
    const isNight = celUniforms.uNightFactor.value > 0.55;
    const lightDir = isNight ? celUniforms.uMoonDir.value : celUniforms.uSunDir.value;

    camera.getWorldDirection(this.tmpDir);
    u.uSunFacing.value = lightDir.dot(this.tmpDir);
    u.uLightElev.value = lightDir.y;

    this.tmpLightWorld.copy(camera.position).addScaledVector(lightDir, 800);
    this.tmpLightWorld.project(camera);
    u.uSunScreenUv.value.set(this.tmpLightWorld.x * 0.5 + 0.5, this.tmpLightWorld.y * 0.5 + 0.5);

    u.uCamPos.value.copy(camera.position);
    this.tmpInvProjView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).invert();
    u.uInvProjView.value.copy(this.tmpInvProjView);

    const tanHalfFov = Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5));
    u.uProjScale.value.set(tanHalfFov * camera.aspect, tanHalfFov);
  }

  render(focusPos: THREE.Vector3) {
    if (this.mode !== 'ultra' || !this.res) {
      this.host.composer.render();
      return;
    }

    const r = this.res;
    const isTitle = this.host.isTitleState();
    if (!isTitle) {
      this.host.grassField.group.visible = false;
      r.ultraGrass.group.visible = true;
      r.ultraGrass.update(focusPos);
    } else {
      r.ultraGrass.group.visible = false;
    }

    r.ultraSwarm.points.visible = !isTitle;
    if (!isTitle) {
      r.ultraSwarm.update(focusPos, this.host.getBiomeWeights());
    }

    r.ultraBloomPass.strength = this.host.bloomPass.strength * ULTRA_CONFIG.bloomScale;

    this.renderPlanarReflection(r);
    this.renderGBuffer(r);
    this.updateCompositeUniforms(r);
    r.ultraComposer.render();
  }
}
