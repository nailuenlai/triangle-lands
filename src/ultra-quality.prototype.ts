/**
 * THROWAWAY VISUAL PROTOTYPE — iPhone 17+ High-Quality ("Ultra Showcase") Mode
 *
 * Plan: Baseline + 3 radically different Ultra Showcase rendering directions on the
 * live Triangle Lands world, switchable via `?variant=baseline|A|B|D` and a
 * floating bottom pill bar (plus ← / → arrow keys and one-click scenic showcase views).
 *
 * Variants:
 *   baseline — Standard production renderer (reference)
 *   A        — 新海誠光影 (Cinematic Light-Field: Planar Water Reflections, Depth-Occluded Volumetric God-Rays, Anamorphic Glare, 4× MSAA, 2048 Soft Shadows, Ultra Extended Grass)
 *   B        — 吉卜力水彩 (Living Watercolor: G-Buffer Depth+Normal Ink Contours & Pigment Pooling, Kuwahara Painterly Brush, Cold-Press Paper Grain, Soft 1/3 God-Rays, Painted Reflections)
 *   D        — 極致夢幻大氣 (Ethereal Living World: 3D Volumetric Sunlit Height-Fog, God-Rays, Mirror Reflections + Nocturnal Bio-Shore, 2,600 GPU Biome Swarm, Ultra Grass + Wind Ribbons)
 */
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
  DAY_PRESETS,
  getBiomeTextures,
} from './cel';
import { BIOMES, BIOME_COUNT, sampleDominantBiome } from './biomes';
import { Simplex2, mulberry32 } from './noise';
import { TOWER_DEFS, WONDER_DEFS } from './world-layout';
import type { DevGame, GameState } from './dev-harness';
import type { DynamicGrassField } from './world';
import type { AmbientMotes } from './fx';

export type UltraVariantId = 'baseline' | 'A' | 'B' | 'D';

export interface UltraVariantSpec {
  id: UltraVariantId;
  code: string;
  name: string;
  subtitle: string;
  accent: string;
  dprCap: number;
  msaa: number;
  shadowSize: number;
  shadowRange: number;
  shadowSoft: boolean;
  useGBuffer: boolean;
  useReflection: boolean;
  reflStrength: number;
  causticsStrength: number;
  painterlyWater: number;
  bioShoreStrength: number;
  bloomScale: number;
  bloomRadius: number;
  bloomThreshold: number;
  exposure: number;
  // Post-process feature weights
  godRayStrength: number;
  anamorphicStrength: number;
  shinkaiGrade: number;
  watercolorInk: number;
  kuwaharaStrength: number;
  paperGrain: number;
  ssaoStrength: number;
  dofStrength: number;
  volFogStrength: number;
  dreamyGlow: number;
  // 3D world density layers
  ultraGrass: boolean;
  windRibbons: boolean;
  swarmCount: number;
  highlights: string[];
}

export const ULTRA_VARIANTS: UltraVariantSpec[] = [
  {
    id: 'baseline',
    code: '0',
    name: '目前標準畫質',
    subtitle: 'Baseline · 現行輕量渲染基準（對照組）',
    accent: '#9fb4c8',
    dprCap: 1.75,
    msaa: 0,
    shadowSize: 1024,
    shadowRange: 62,
    shadowSoft: false,
    useGBuffer: false,
    useReflection: false,
    reflStrength: 0,
    causticsStrength: 0,
    painterlyWater: 0,
    bioShoreStrength: 0,
    bloomScale: 1.0,
    bloomRadius: 0.56,
    bloomThreshold: 0.98,
    exposure: 1.08,
    godRayStrength: 0,
    anamorphicStrength: 0,
    shinkaiGrade: 0,
    watercolorInk: 0,
    kuwaharaStrength: 0,
    paperGrain: 0,
    ssaoStrength: 0,
    dofStrength: 0,
    volFogStrength: 0,
    dreamyGlow: 0,
    ultraGrass: false,
    windRibbons: false,
    swarmCount: 0,
    highlights: ['DPR ≤ 1.75', 'Shadow 1024', 'No MSAA', 'Standard Water & Grass'],
  },
  {
    id: 'A',
    code: 'A',
    name: '新海誠光影史詩',
    subtitle: 'Cinematic Light-Field · 即時鏡面水面倒影 × 體積耶穌光 × 變形寬銀幕光斑',
    accent: '#5ce1ff',
    dprCap: 3.0,
    msaa: 4,
    shadowSize: 2048,
    shadowRange: 115,
    shadowSoft: true,
    useGBuffer: true,
    useReflection: true,
    reflStrength: 0.88,
    causticsStrength: 0.72,
    painterlyWater: 0,
    bioShoreStrength: 0.15,
    bloomScale: 1.24,
    bloomRadius: 0.72,
    bloomThreshold: 0.88,
    exposure: 1.14,
    godRayStrength: 1.18,
    anamorphicStrength: 0.95,
    shinkaiGrade: 1.15,
    watercolorInk: 0,
    kuwaharaStrength: 0,
    paperGrain: 0,
    ssaoStrength: 0.30,
    dofStrength: 0,
    volFogStrength: 0.22,
    dreamyGlow: 0.14,
    ultraGrass: true,
    windRibbons: false,
    swarmCount: 1200,
    highlights: ['4× MSAA · 3x DPR', '即時鏡面水倒影', '體積丁達爾耶穌光', '寬銀幕光斑', '2048 柔影', '逆光草海'],
  },
  {
    id: 'B',
    code: 'B',
    name: '吉卜力手繪水彩',
    subtitle: 'Living Watercolor · 深度法線水彩勾邊 × 筆觸塗抹 × 300g 棉紙肌理 × 柔和耶穌光（A 的 1/3）',
    accent: '#ffd073',
    dprCap: 3.0,
    msaa: 4,
    shadowSize: 2048,
    shadowRange: 105,
    shadowSoft: true,
    useGBuffer: true,
    useReflection: true,
    reflStrength: 0.68,
    causticsStrength: 0.35,
    painterlyWater: 1.0,
    bioShoreStrength: 0,
    bloomScale: 0.94,
    bloomRadius: 0.62,
    bloomThreshold: 0.98,
    exposure: 1.11,
    godRayStrength: 1.18 / 3,
    anamorphicStrength: 0,
    shinkaiGrade: 0.22,
    watercolorInk: 1.22,
    kuwaharaStrength: 1.0,
    paperGrain: 1.15,
    ssaoStrength: 0.36,
    dofStrength: 0,
    volFogStrength: 0.10,
    dreamyGlow: 0,
    ultraGrass: true,
    windRibbons: false,
    swarmCount: 900,
    highlights: ['4× MSAA · 3x DPR', '深度+法線水彩勾邊', 'Kuwahara 筆觸濾鏡', '300g 水彩紙紋', '柔和耶穌光 (1/3)', '水彩倒影'],
  },
  {
    id: 'D',
    code: 'D',
    name: '極致夢幻大氣',
    subtitle: 'Ethereal Living World · 3D 體積陽光霧海 × 2600 生態粒子群 × 藍眼淚夜光岸線',
    accent: '#63f5b8',
    dprCap: 3.0,
    msaa: 4,
    shadowSize: 2048,
    shadowRange: 120,
    shadowSoft: true,
    useGBuffer: true,
    useReflection: true,
    reflStrength: 0.90,
    causticsStrength: 0.95,
    painterlyWater: 0,
    bioShoreStrength: 1.25,
    bloomScale: 1.48,
    bloomRadius: 0.82,
    bloomThreshold: 0.82,
    exposure: 1.14,
    godRayStrength: 0.95,
    anamorphicStrength: 0.52,
    shinkaiGrade: 0.72,
    watercolorInk: 0,
    kuwaharaStrength: 0,
    paperGrain: 0,
    ssaoStrength: 0.50,
    dofStrength: 0.20,
    volFogStrength: 1.22,
    dreamyGlow: 1.12,
    ultraGrass: true,
    windRibbons: true,
    swarmCount: 2600,
    highlights: ['4× MSAA · 3x DPR', '3D 體積陽光霧海', '鏡面倒影+藍眼淚', '2600 生態微粒/螢火蟲', '3D 流風絲帶', '極致逆光花草海'],
  },
];

export interface UltraPrototypeHost {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  composer: EffectComposer;
  bloomPass: UnrealBloomPass;
  sun: THREE.DirectionalLight;
  terrain: Terrain;
  waterMesh: THREE.Mesh;
  grassField: DynamicGrassField;
  ambientMotes: AmbientMotes;
  sky: THREE.Mesh;
  clouds: THREE.Group;
  aurora: THREE.Group;
  karstCloudSea: THREE.Group;
  devGame: DevGame;
  setShadowConfig: (size: number, range: number, soft: boolean) => void;
  getState: () => GameState;
  startGame: () => void;
  getViewerPos: () => THREE.Vector3;
  getBiomeWeights: () => Float32Array;
  triggerResize: () => void;
}

export interface UltraPrototypeHandle {
  render: (dt: number, elapsed: number, focusPos: THREE.Vector3) => void;
  resize: (w: number, h: number) => void;
  setVariant: (id: UltraVariantId) => void;
  getVariant: () => UltraVariantId;
}

// ------------------------------------------------------------ Scenic Showcase Camera Presets

interface ShowcaseSpot {
  id: string;
  label: string;
  tod: number;
  camPos: [number, number, number];
  camLook: [number, number, number];
}

const SHOWCASE_SPOTS: ShowcaseSpot[] = [
  {
    id: 'maple_mirror',
    label: '南湖楓鏡',
    tod: 0.725, // Golden sunset directly behind the Sunken Gate across open mirror lake!
    camPos: [122, 9.2, 118],
    camLook: [90, 7.2, 137],
  },
  {
    id: 'karst_arch',
    label: '西嶺雲海',
    tod: 0.36, // Elevated cleared vantage overlooking Karst spires, cloud sea, lagoon & Natural Arch
    camPos: [-194, 60.0, -34],
    camLook: [-148, 12.0, -58],
  },
  {
    id: 'sakura_hill',
    label: '古櫻青丘',
    tod: 0.275, // Open hillside clearing looking at Ancient Cherry Blossom & backlit meadow
    camPos: [-56, 51.0, 44],
    camLook: [-36, 48.0, 22],
  },
  {
    id: 'aurora_night',
    label: '北境極光',
    tod: 0.02, // Starry night looking North over the Ice Spire & glowing Northern Aurora!
    camPos: [4, 52.0, -158],
    camLook: [20, 49.0, -210],
  },
];

// ------------------------------------------------------------ Helper: Shore Depth Texture

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

// ------------------------------------------------------------ G-Buffer Override Material (View Normal + Linear Depth)

function createGBufferMaterial(): THREE.ShaderMaterial {
  // Defined via const strings because this outputs raw view-space normals + linear depth
  // into a HalfFloat G-Buffer (must NOT apply color tone mapping or sRGB encoding).
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

// ------------------------------------------------------------ Ultra Water Material (Planar Reflections + Caustics + Bio-Shore)

function createUltraWaterMaterial(terrain: Terrain, reflectionTex: THREE.Texture): THREE.ShaderMaterial {
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
      uReflStrength: { value: 0.8 },
      uCausticsStrength: { value: 0.7 },
      uPainterlyMode: { value: 0.0 },
      uBioShoreStrength: { value: 0.0 },
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
      uniform float uPainterlyMode;
      uniform float uBioShoreStrength;
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

        // Rich multi-tier water absorption palette
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

        // Multi-layer high-frequency + swell ripples for organic surface normals
        vec2 wUv1 = vWorldPos.xz * 0.26 + vec2(uTime * 0.26, uTime * 0.14);
        vec2 wUv2 = vWorldPos.xz * 0.17 - vec2(uTime * 0.18, uTime * 0.22);
        vec2 wUv3 = vWorldPos.xz * 0.68 + vec2(-uTime * 0.34, uTime * 0.28);
        float r1 = celNoise(wUv1);
        float r2 = celNoise(wUv2 + r1 * 0.75);
        float r3 = celNoise(wUv3);

        // Calm mirror lake attenuation in South Maple Lake & near shore
        float calmMask = clamp(wMaple * 0.65 + smoothstep(3.0, 0.3, depth) * 0.35, 0.0, 0.82);
        float waveAmp = mix(0.24, 0.075, calmMask);
        vec3 waveN = safeNormalize(vec3(
          (r1 - 0.5) * waveAmp + (r3 - 0.5) * waveAmp * 0.45,
          1.0,
          (r2 - 0.5) * waveAmp + (r3 - 0.5) * waveAmp * 0.45
        ));

        // Sunlit underwater caustics shimmering across shallow seabeds
        float caustMask = smoothstep(6.2, 0.4, depth) * smoothstep(0.03, 0.25, depth) * inside * smoothstep(220.0, 35.0, dist);
        float caust = causticPattern(vWorldPos.xz + waveN.xz * 1.4, uTime) * caustMask * uCausticsStrength;
        vec3 caustCol = mix(vec3(0.68, 1.05, 0.96), vec3(1.15, 0.88, 0.56), uSunsetFactor * 0.65);
        caustCol = mix(caustCol, vec3(0.32, 0.65, 0.98), uNightFactor * 0.82);
        waterCol += caustCol * caust * (0.48 - 0.20 * uNightFactor);

        // Adapt water absorption to sunset warmth & moonlit night
        waterCol *= mix(vec3(1.0), vec3(1.12, 0.86, 0.74), uSunsetFactor * 0.52);
        waterCol *= mix(vec3(1.0), vec3(0.24, 0.35, 0.56), uNightFactor);

        // Cloud shadows drifting on water
        float cSh = mix(0.84, 1.0, celCloudShadow(vWorldPos.xz, uTime));
        waterCol *= mix(cSh, 1.0, uNightFactor * 0.6);

        // Real-Time Planar Reflection with physical Fresnel & ripple distortion
        float ndotv = clamp(-dot(viewDir, waveN), 0.0, 1.0);
        float fresnel = 0.06 + 0.94 * safePow(1.0 - ndotv, 3.2);
        vec3 skyFallback = mix(uAerialBlue, uSkyHorizon, 0.55);

        if (uReflStrength > 0.01) {
          vec2 reflUv = (vReflClip.xy / max(vReflClip.w, 0.0001)) * 0.5 + 0.5;
          float distortScale = mix(0.032, 0.012, calmMask) * smoothstep(320.0, 12.0, dist);
          vec2 distUv = reflUv + vec2(waveN.x, waveN.z * 0.7) * distortScale;
          vec2 clampedUv = clamp(distUv, vec2(0.003), vec2(0.997));
          vec3 reflCol = texture2D(uReflectionMap, clampedUv).rgb;

          // Painterly gouache horizontal brush smear in Variant B
          if (uPainterlyMode > 0.5) {
            vec3 reflL = texture2D(uReflectionMap, clamp(clampedUv + vec2(-0.006, 0.0), vec2(0.003), vec2(0.997))).rgb;
            vec3 reflR = texture2D(uReflectionMap, clamp(clampedUv + vec2( 0.006, 0.0), vec2(0.003), vec2(0.997))).rgb;
            reflCol = (reflCol * 0.5 + reflL * 0.25 + reflR * 0.25);
          }

          // Edge fade if distorted UV leaves viewport
          float edgeOk = smoothstep(0.0, 0.06, distUv.x) * smoothstep(1.0, 0.94, distUv.x)
                       * smoothstep(0.0, 0.06, distUv.y) * smoothstep(1.0, 0.94, distUv.y);
          reflCol = mix(skyFallback, reflCol, edgeOk);

          // Maple Lake & calm lagoons act like enchanted mirrors; shallow edge keeps crystal transparency
          float reflFactor = clamp(fresnel * (0.72 + wMaple * 0.36 + wKarst * 0.14) * uReflStrength, 0.0, 0.92);
          reflFactor *= smoothstep(0.08, 1.35, depth);
          waterCol = mix(waterCol, reflCol, reflFactor);
        } else {
          waterCol = mix(waterCol, skyFallback, fresnel * (0.48 + wMaple * 0.22));
        }

        // Stylized gouache wave ribbons (stronger in painterly mode, delicate elsewhere)
        float ripple = smoothstep(0.66, 0.76, r2) * smoothstep(240.0, 30.0, dist);
        vec3 rippleCol = mix(vec3(0.62, 0.94, 0.96), vec3(0.42, 0.66, 0.94), uNightFactor);
        rippleCol = mix(rippleCol, vec3(1.0, 0.82, 0.58), uSunsetFactor * 0.55);
        waterCol = mix(waterCol, rippleCol, ripple * mix(0.14, 0.32, uPainterlyMode) * mix(1.0, 0.45, calmMask));

        // Animated shoreline foam + delicate nocturnal bioluminescent surf (Variant D)
        float shoreNoise = celNoise(vWorldPos.xz * 0.28 + vec2(uTime * 0.18, -uTime * 0.12));
        float waveLap = sin(depth * 5.4 - uTime * 2.2 + shoreNoise * 3.8);
        float innerFoam = smoothstep(0.54, 0.04, depth + (shoreNoise - 0.5) * 0.32);
        float outerRing = smoothstep(0.58, 0.84, waveLap) * smoothstep(2.1, 0.42, depth) * smoothstep(0.05, 0.34, depth);
        float foam = clamp(innerFoam * 0.95 + outerRing * 0.65, 0.0, 1.0) * inside * smoothstep(340.0, 90.0, dist);

        vec3 foamCol = mix(vec3(0.94, 0.97, 0.99), vec3(1.0, 0.86, 0.72), uSunsetFactor * 0.6);
        foamCol = mix(foamCol, vec3(0.58, 0.75, 0.94), uNightFactor);
        waterCol = mix(waterCol, foamCol, foam);

        if (uBioShoreStrength > 0.01 && uNightFactor > 0.15) {
          float bioWave = clamp(innerFoam * 0.7 + outerRing * 1.1, 0.0, 1.0) * inside * smoothstep(240.0, 40.0, dist);
          float shimmer = 0.65 + 0.35 * sin(uTime * 3.2 + vWorldPos.x * 0.55 + vWorldPos.z * 0.48);
          vec3 bioCol = vec3(0.28, 1.38, 1.78);
          waterCol += bioCol * bioWave * shimmer * smoothstep(0.18, 0.85, uNightFactor) * uBioShoreStrength * 0.85;
        }

        // Crisp HDR sun/moon specular sparkles
        vec3 glintDir = safeNormalize(mix(uSunDir, uMoonDir, step(0.5, uNightFactor)));
        vec3 halfV = safeNormalize(glintDir - viewDir);
        float specPow = mix(140.0, 56.0, wMaple * uNightFactor);
        float spec = safePow(clamp(dot(waveN, halfV), 0.0, 1.0), specPow);
        float broadSpec = safePow(clamp(dot(waveN, halfV), 0.0, 1.0), 22.0) * 0.22;
        vec3 glintCol = mix(uSunHaze * 1.75, vec3(0.90, 1.24, 1.72) * (1.0 + wMaple * 0.45), uNightFactor);
        waterCol += glintCol * (smoothstep(0.22, 0.62, spec) * 1.15 + broadSpec) * cSh;

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

// ------------------------------------------------------------ Ultra Extended Backlit Grass & Wildflowers

function cellHash(ix: number, iz: number, salt: number): number {
  let h = Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(salt, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function buildUltraGrassGeo(): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  // 7 curved two-segment blades per tuft for lush iPhone 17+ silhouette richness
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
    // Lower quad (2 tris)
    positions.push(
      ox - rx, 0, oz - rz,
      ox + rx, 0, oz + rz,
      ox + midFx + rx * 0.55, midY, oz + midFz + rz * 0.55,
      ox - rx, 0, oz - rz,
      ox + midFx + rx * 0.55, midY, oz + midFz + rz * 0.55,
      ox + midFx - rx * 0.55, midY, oz + midFz - rz * 0.55,
    );
    uvs.push(0, 0, 1, 0, 0.8, 0.52, 0, 0, 0.8, 0.52, 0.2, 0.52);
    // Upper tip tri
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
        // Extended ultra horizon fade: lush all the way out to 72m!
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
        // Backlit subsurface scattering glow when looking toward the sun!
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
          // Golden-emerald sunlit translucency on backlit grass blades
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

  // 88×88 = 7,744 rich 7-blade tufts covering ~115m × 115m around the viewer!
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

// ------------------------------------------------------------ 3D Calligraphic Wind Ribbons (Variant B & D)

class PainterlyWindRibbons {
  readonly group = new THREE.Group();
  private readonly ribbons: { mesh: THREE.Mesh; baseX: number; baseY: number; baseZ: number; speed: number; phase: number }[] = [];
  private readonly mat: THREE.ShaderMaterial;

  constructor() {
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
      uniforms: {
        uTime: celUniforms.uTime,
        uSunHaze: celUniforms.uSunHaze,
        uNightFactor: celUniforms.uNightFactor,
        uSunsetFactor: celUniforms.uSunsetFactor,
      },
      vertexShader: /* glsl */ `
        uniform float uTime;
        varying vec2 vUv;
        void main() {
          vUv = uv;
          vec3 p = position;
          float wave = sin(uv.x * 12.566 - uTime * 3.1) * 1.15;
          float lift = cos(uv.x * 9.42 - uTime * 2.2) * 0.72;
          p.y += wave;
          p.z += lift;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uSunHaze;
        uniform float uNightFactor;
        uniform float uSunsetFactor;
        varying vec2 vUv;
        void main() {
          float head = smoothstep(0.0, 0.25, vUv.x) * smoothstep(1.0, 0.35, vUv.x);
          float across = smoothstep(0.0, 0.35, vUv.y) * smoothstep(1.0, 0.65, vUv.y);
          float pulse = 0.65 + 0.35 * sin(vUv.x * 10.0 - uTime * 4.5);
          vec3 col = mix(vec3(0.95, 0.99, 1.0), uSunHaze * 1.05, 0.38 + uSunsetFactor * 0.42);
          col = mix(col, vec3(0.58, 0.88, 1.18), uNightFactor * 0.78);
          float alpha = head * across * pulse * 0.36;
          if (alpha < 0.004) discard;
          gl_FragColor = vec4(col, alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });

    const rand = mulberry32(417);
    const geo = new THREE.PlaneGeometry(24, 0.34, 28, 1);
    for (let i = 0; i < 16; i++) {
      const m = new THREE.Mesh(geo, this.mat);
      const bx = (rand() - 0.5) * 110;
      const by = 4.5 + rand() * 24;
      const bz = (rand() - 0.5) * 110;
      m.rotation.y = (rand() - 0.5) * 0.6;
      m.frustumCulled = false;
      m.renderOrder = 4;
      this.group.add(m);
      this.ribbons.push({
        mesh: m,
        baseX: bx,
        baseY: by,
        baseZ: bz,
        speed: 4.5 + rand() * 4.0,
        phase: rand() * 100,
      });
    }
    this.group.visible = false;
  }

  update(focus: THREE.Vector3, elapsed: number) {
    if (!this.group.visible) return;
    const span = 120;
    for (const r of this.ribbons) {
      const x = (((r.baseX + elapsed * r.speed - focus.x + span * 0.5) % span) + span) % span - span * 0.5 + focus.x;
      const z = (((r.baseZ + elapsed * r.speed * 0.35 - focus.z + span * 0.5) % span) + span) % span - span * 0.5 + focus.z;
      const y = Math.max(WATER_LEVEL + 3.5, focus.y - 4 + r.baseY + Math.sin(elapsed * 0.9 + r.phase) * 2.5);
      r.mesh.position.set(x, y, z);
    }
  }
}

// ------------------------------------------------------------ Ultra Living Atmosphere Swarm (up to 2,600 GPU particles)

class UltraAtmosphereSwarm {
  readonly points: THREE.Points;
  private readonly maxCount = 2600;
  private readonly mat: THREE.ShaderMaterial;
  private readonly geo: THREE.BufferGeometry;

  private readonly colA = new THREE.Color();
  private readonly colB = new THREE.Color();
  private readonly drift = new THREE.Vector3();

  constructor() {
    const rand = mulberry32(9021);
    const seeds = new Float32Array(this.maxCount * 3);
    const sizes = new Float32Array(this.maxCount);
    const phases = new Float32Array(this.maxCount);
    for (let i = 0; i < this.maxCount; i++) {
      seeds[i * 3] = (rand() - 0.5) * 110;
      seeds[i * 3 + 1] = rand() * 34 - 4;
      seeds[i * 3 + 2] = (rand() - 0.5) * 110;
      sizes[i] = 0.55 + rand() * 1.15;
      phases[i] = rand() * Math.PI * 2;
    }

    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(seeds, 3));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    this.geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
    this.geo.setDrawRange(0, 0);

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

          // Toroidal wrap around viewer completely on GPU (zero CPU loop!)
          vec3 rel = mod(p - uCenter + span * 0.5, span) - span * 0.5;
          vec3 wp = uCenter + rel;
          wp.y = max(wp.y, ${WATER_LEVEL.toFixed(2)} + 0.6);

          float edge = smoothstep(55.0, 32.0, length(rel.xz)) * smoothstep(2.0, 6.0, length(wp - cameraPosition));
          vFade = edge;

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
          // Warm sunset pollen & vivid HDR nocturnal firefly boost
          col *= mix(1.0, 1.32, uSunsetFactor * 0.5 + uNightFactor * 0.85);
          float a = core * twinkle * vFade * uAlpha;
          if (a < 0.004) discard;
          gl_FragColor = vec4(col * a, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });

    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
    this.points.visible = false;
  }

  setCount(count: number) {
    const c = Math.max(0, Math.min(this.maxCount, count));
    this.geo.setDrawRange(0, c);
    this.points.visible = c > 0;
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
      const rA = m.dayColA.r + (m.nightColA.r - m.dayColA.r) * night;
      const gA = m.dayColA.g + (m.nightColA.g - m.dayColA.g) * night;
      const bA = m.dayColA.b + (m.nightColA.b - m.dayColA.b) * night;
      const rB = m.dayColB.r + (m.nightColB.r - m.dayColB.r) * night;
      const gB = m.dayColB.g + (m.nightColB.g - m.dayColB.g) * night;
      const bB = m.dayColB.b + (m.nightColB.b - m.dayColB.b) * night;
      this.colA.r += rA * w;
      this.colA.g += gA * w;
      this.colA.b += bA * w;
      this.colB.r += rB * w;
      this.colB.g += gB * w;
      this.colB.b += bB * w;
      this.drift.addScaledVector(m.drift, w * 1.35);
      alpha += (m.dayAlpha + (m.nightAlpha - m.dayAlpha) * night) * w;
    }

    this.mat.uniforms.uColA.value.copy(this.colA);
    this.mat.uniforms.uColB.value.copy(this.colB);
    this.mat.uniforms.uDrift.value.copy(this.drift);
    this.mat.uniforms.uAlpha.value = Math.min(1.0, alpha * 0.92);
  }
}

// ------------------------------------------------------------ Ultra Master Composite Pass (replaces OutputPass)

function createUltraCompositeShader(gbufTex: THREE.Texture): {
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
      uAerialBlue: celUniforms.uAerialBlue,
      uSunScreenUv: { value: new THREE.Vector2(0.5, 0.7) },
      uSunFacing: { value: 0.0 },
      uLightElev: { value: 0.4 },
      uCamPos: { value: new THREE.Vector3() },
      uInvProjView: { value: new THREE.Matrix4() },
      uProjScale: { value: new THREE.Vector2(1.0, 1.0) },
      uFocusDist: { value: 26.0 },
      // Variant weights
      uGodRayStrength: { value: 0.0 },
      uAnamorphicStrength: { value: 0.0 },
      uShinkaiGrade: { value: 0.0 },
      uWatercolorInk: { value: 0.0 },
      uKuwaharaStrength: { value: 0.0 },
      uPaperGrain: { value: 0.0 },
      uSsaoStrength: { value: 0.0 },
      uDofStrength: { value: 0.0 },
      uVolFogStrength: { value: 0.0 },
      uDreamyGlow: { value: 0.0 },
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
      uniform vec3 uAerialBlue;
      uniform vec2 uSunScreenUv;
      uniform float uSunFacing;
      uniform float uLightElev;
      uniform vec3 uCamPos;
      uniform mat4 uInvProjView;
      uniform vec2 uProjScale;
      uniform float uFocusDist;

      uniform float uGodRayStrength;
      uniform float uAnamorphicStrength;
      uniform float uShinkaiGrade;
      uniform float uWatercolorInk;
      uniform float uKuwaharaStrength;
      uniform float uPaperGrain;
      uniform float uSsaoStrength;
      uniform float uDofStrength;
      uniform float uVolFogStrength;
      uniform float uDreamyGlow;

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

        // --------------------------------------------------------
        // 1. Variant B: Anisotropic Kuwahara Painterly Brush Filter
        // --------------------------------------------------------
        if (uKuwaharaStrength > 0.01 && isSky < 0.5) {
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

        // --------------------------------------------------------
        // 2. Variant C (and subtle A/B/D): 12-Tap Horizon SSAO + Biome GI Bounce
        // --------------------------------------------------------
        if (uSsaoStrength > 0.01 && isSky < 0.5 && zMeters < 240.0) {
          vec3 vp = reconstructViewPos(vUv, dCenter);
          float worldRad = mix(2.2, 5.2, smoothstep(10.0, 95.0, zMeters));
          float screenRad = clamp(worldRad / max(zMeters * uProjScale.y, 0.35), 0.004, 0.048);
          float rot = ign(vUv * uResolution) * 6.283185;
          float occ = 0.0;
          const int SAMPLES = 12;
          for (int i = 0; i < SAMPLES; i++) {
            float fi = float(i);
            float ang = rot + fi * 2.3999632; // golden angle
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
          float distAtten = smoothstep(240.0, 145.0, zMeters);
          float aoAmt = occ * uSsaoStrength * distAtten;
          // Stylized colored GI occlusion (deep biome shadow hue instead of muddy gray!)
          vec3 aoTint = mix(uShadowTint * 0.52, vec3(0.16, 0.22, 0.36), uNightFactor * 0.6);
          col = mix(col, col * aoTint, aoAmt * 0.85);
        }

        // --------------------------------------------------------
        // 3. Variant C: Optical f/2.0 Bokeh Depth of Field + Sculptural Focus Micro-Contrast
        // --------------------------------------------------------
        if (uDofStrength > 0.01) {
          float centerD = texture2D(tGBuf, vec2(0.5, 0.5)).a;
          float focusDist = centerD < 0.99 ? clamp(centerD * 600.0, 6.0, 95.0) : uFocusDist;
          float effDepth = isSky > 0.5 ? 260.0 : zMeters;
          float delta = effDepth - focusDist;
          // Tack-sharp focus band around center subject; creamy bokeh on foreground & distant peaks
          float coc = delta > 0.0
            ? smoothstep(focusDist * 0.28 + 4.0, focusDist * 2.1 + 42.0, delta)
            : smoothstep(focusDist * 0.30, focusDist * 0.85, -delta) * 0.72;
          coc = clamp(coc * uDofStrength, 0.0, 1.0);
          if (coc > 0.03) {
            float blurRad = coc * 5.6;
            float aspect = uResolution.y / uResolution.x;
            float rot = ign(vUv * uResolution) * 6.283185;
            vec3 acc = col * 1.1;
            float wSum = 1.1;
            for (int i = 0; i < 12; i++) {
              float fi = float(i);
              float ang = rot + fi * 2.3999632;
              float r = sqrt((fi + 0.5) / 12.0) * blurRad;
              vec2 off = vec2(cos(ang) * aspect, sin(ang)) * r * px;
              vec2 suv = clamp(vUv + off, vec2(0.002), vec2(0.998));
              float sd = texture2D(tGBuf, suv).a;
              float sz = sd > 0.992 ? 260.0 : sd * 600.0;
              // Prevent sharp in-focus subject from bleeding into far background
              float bleedGuard = delta > 0.0 ? smoothstep(focusDist * 0.88, focusDist * 1.15, sz) : 1.0;
              vec3 sc = sanitizeRgb(texture2D(tDiffuse, suv).rgb);
              float lumBoost = 1.0 + max(0.0, dot(sc, vec3(0.3, 0.55, 0.15)) - 0.72) * 1.45;
              float w = bleedGuard * lumBoost;
              acc += sc * w;
              wSum += w;
            }
            col = acc / max(wSum, 0.001);
          } else if (isSky < 0.5) {
            // Subtle tactile clarity / micro-contrast on the tack-sharp focal subject
            vec3 avg = (
              sanitizeRgb(texture2D(tDiffuse, vUv + vec2(px.x, 0.0)).rgb) +
              sanitizeRgb(texture2D(tDiffuse, vUv - vec2(px.x, 0.0)).rgb) +
              sanitizeRgb(texture2D(tDiffuse, vUv + vec2(0.0, px.y)).rgb) +
              sanitizeRgb(texture2D(tDiffuse, vUv - vec2(0.0, px.y)).rgb)
            ) * 0.25;
            col = max(col + (col - avg) * (0.28 * uDofStrength), vec3(0.0));
          }
        }

        // --------------------------------------------------------
        // 4. Variant B: Depth + View-Normal Watercolor Ink Contours & Pigment Pooling
        // --------------------------------------------------------
        if (uWatercolorInk > 0.01 && isSky < 0.5) {
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
          // Warm sepia-indigo watercolor ink line (soft pigment pooling, never harsh black)
          vec3 inkCol = mix(vec3(0.14, 0.18, 0.28), vec3(0.24, 0.14, 0.14), uSunsetFactor * 0.65);
          inkCol = mix(inkCol, vec3(0.08, 0.14, 0.26), uNightFactor * 0.6);
          col = mix(col, mix(col * 0.42, inkCol, 0.48), edge * distFade * uWatercolorInk * 0.72);
        }

        // --------------------------------------------------------
        // 5. Variant D (and subtle A/B): 3D World-Reconstructed Volumetric Sunlit Height-Fog
        // --------------------------------------------------------
        if (uVolFogStrength > 0.01) {
          vec4 clipFar = vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
          vec4 worldFar = uInvProjView * clipFar;
          vec3 rayDir = safeNormalize(worldFar.xyz / max(abs(worldFar.w), 0.0001) - uCamPos);
          float rayLen = isSky > 0.5 ? 240.0 : min(zMeters, 240.0);

          vec3 lDir = safeNormalize(mix(uSunDir, uMoonDir, uNightFactor));
          float hg = safePow(clamp(dot(rayDir, lDir), 0.0, 1.0), 4.0);

          // 4 stratified volumetric mist slices along the view ray
          float mistAcc = 0.0;
          float jitter = ign(vUv * uResolution);
          for (int i = 0; i < 4; i++) {
            float t = (float(i) + 0.25 + jitter * 0.5) / 4.0;
            float distS = mix(22.0, rayLen, t);
            vec3 wp = uCamPos + rayDir * distS;
            float hMask = smoothstep(34.0, 2.0, wp.y);
            float n = celFbm(wp.xz * 0.014 + vec2(uTime * 0.024, -uTime * 0.014));
            float wisp = smoothstep(0.28, 0.78, n);
            mistAcc += hMask * wisp * smoothstep(18.0, 75.0, distS);
          }
          float fogAmt = clamp((mistAcc * 0.25) * uVolFogStrength * 0.48, 0.0, 0.48);
          vec3 fogCol = mix(uValleyMist, uSunHaze * 1.18, hg * (0.62 - 0.18 * uNightFactor) + uSunsetFactor * 0.35);
          fogCol = mix(fogCol, vec3(0.22, 0.48, 0.62), uNightFactor * 0.58);
          col = mix(col, fogCol, fogAmt);
        }

        // --------------------------------------------------------
        // 6. Variant A & D: Screen-Space Depth-Occluded Volumetric God-Rays
        // --------------------------------------------------------
        if (uGodRayStrength > 0.01) {
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
                  // Sky pixels unoccluded by mountain/tree/shrine silhouettes transmit shafts!
                  float skyOpen = smoothstep(0.96, 0.995, sd);
                  rays += skyOpen * decay;
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

        // --------------------------------------------------------
        // 7. Variant A: Silky Optical Anamorphic Horizontal Lens Glare
        // --------------------------------------------------------
        if (uAnamorphicStrength > 0.01) {
          vec3 streak = vec3(0.0);
          float wTot = 0.0;
          for (int i = -6; i <= 6; i++) {
            if (i == 0) continue;
            float fi = float(i);
            vec2 suv = clamp(vUv + vec2(fi * px.x * 2.8, 0.0), vec2(0.002), vec2(0.998));
            vec3 s = sanitizeRgb(texture2D(tDiffuse, suv).rgb);
            float hi = smoothstep(1.05, 2.0, max(s.r, max(s.g, s.b)));
            float w = exp(-fi * fi * 0.08);
            streak += s * hi * w;
            wTot += w;
          }
          vec3 streakTint = mix(vec3(0.75, 0.92, 1.25), vec3(1.22, 0.86, 0.58), uSunsetFactor * 0.75);
          col += (streak / max(wTot, 1.0)) * streakTint * uAnamorphicStrength * 0.32;
        }

        // --------------------------------------------------------
        // 8. Variant D: Dreamy Soft Atmospheric Highlight Halo
        // --------------------------------------------------------
        if (uDreamyGlow > 0.01) {
          vec3 soft = vec3(0.0);
          soft += sanitizeRgb(texture2D(tDiffuse, clamp(vUv + vec2( px.x * 4.0,  px.y * 4.0), vec2(0.002), vec2(0.998))).rgb);
          soft += sanitizeRgb(texture2D(tDiffuse, clamp(vUv + vec2(-px.x * 4.0,  px.y * 4.0), vec2(0.002), vec2(0.998))).rgb);
          soft += sanitizeRgb(texture2D(tDiffuse, clamp(vUv + vec2( px.x * 4.0, -px.y * 4.0), vec2(0.002), vec2(0.998))).rgb);
          soft += sanitizeRgb(texture2D(tDiffuse, clamp(vUv + vec2(-px.x * 4.0, -px.y * 4.0), vec2(0.002), vec2(0.998))).rgb);
          soft *= 0.25;
          float hiMask = smoothstep(0.58, 1.35, dot(soft, vec3(0.3, 0.55, 0.15)));
          col += soft * hiMask * uDreamyGlow * 0.22;
        }

        // --------------------------------------------------------
        // 9. Variant A/C/D: Filmic Split-Tone & Luminance Vibrance
        // --------------------------------------------------------
        if (uShinkaiGrade > 0.01) {
          float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
          // Deepen cool sapphire shadows & warm luminous golden highlights (Shinkai film look)
          vec3 coolShadow = mix(vec3(0.90, 0.96, 1.12), vec3(0.96, 0.92, 1.10), uSunsetFactor);
          vec3 warmHigh = mix(vec3(1.06, 1.03, 0.96), vec3(1.12, 0.98, 0.88), uSunsetFactor);
          vec3 split = mix(coolShadow, warmHigh, smoothstep(0.12, 0.78, lum));
          vec3 graded = col * split;
          // Gentle saturation lift in midtones without clipping
          float midSat = 1.0 + 0.14 * uShinkaiGrade * smoothstep(0.04, 0.35, lum) * smoothstep(1.6, 0.5, lum);
          graded = mix(vec3(lum), graded, midSat);
          col = mix(col, graded, uShinkaiGrade * 0.85);
        }

        // --------------------------------------------------------
        // 10. Variant B: Cold-Press 300gsm Watercolor Cotton Paper Grain
        // --------------------------------------------------------
        if (uPaperGrain > 0.01) {
          vec2 pUv = vUv * uResolution * 0.18;
          float g1 = celNoise(pUv);
          float g2 = celNoise(pUv * 2.7 + vec2(11.3, 7.1));
          float fiber = (g1 * 0.65 + g2 * 0.35) - 0.5;
          float lum = dot(col, vec3(0.299, 0.587, 0.114));
          // Paper tooth shows most beautifully in sky washes and sunlit watercolor plains
          float tooth = fiber * uPaperGrain * (0.045 + 0.040 * smoothstep(0.2, 0.9, lum));
          col *= (1.0 + tooth);
        }

        // Subtle optical vignette for cinematic framing (very delicate)
        vec2 vigUv = vUv * 2.0 - 1.0;
        float vig = 1.0 - dot(vigUv, vigUv) * (0.065 + 0.055 * uShinkaiGrade + 0.04 * uDofStrength);
        col *= clamp(vig, 0.78, 1.0);

        gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  };
}

// ------------------------------------------------------------ Floating Dev Prototype Switcher UI

function injectPrototypeStyles() {
  if (document.getElementById('ultra-proto-styles')) return;
  const style = document.createElement('style');
  style.id = 'ultra-proto-styles';
  style.textContent = `
    .up-dock {
      position: fixed;
      left: 50%;
      bottom: max(12px, env(safe-area-inset-bottom, 12px));
      transform: translateX(-50%);
      z-index: 9999;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif;
      pointer-events: none;
      user-select: none;
      max-width: calc(100vw - 16px);
    }
    .up-card {
      pointer-events: auto;
      background: rgba(11, 16, 26, 0.84);
      backdrop-filter: blur(18px) saturate(160%);
      -webkit-backdrop-filter: blur(18px) saturate(160%);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 16px;
      padding: 10px 14px;
      color: #eef5ff;
      box-shadow: 0 12px 34px rgba(0, 0, 0, 0.45);
      width: min(560px, calc(100vw - 20px));
      display: flex;
      flex-direction: column;
      gap: 7px;
      transition: opacity 0.2s ease, transform 0.2s ease;
    }
    .up-card.collapsed {
      display: none;
    }
    .up-sub {
      font-size: 12px;
      color: rgba(226, 238, 255, 0.85);
      line-height: 1.35;
    }
    .up-tags {
      display: flex;
      flex-wrap: wrap;
      gap: 5px;
    }
    .up-tag {
      font-size: 10.5px;
      padding: 2px 7px;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.12);
      color: #d9ecff;
      letter-spacing: 0.01em;
    }
    .up-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      flex-wrap: wrap;
      padding-top: 4px;
      border-top: 1px solid rgba(255, 255, 255, 0.09);
    }
    .up-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }
    .up-chip {
      appearance: none;
      border: 1px solid rgba(255, 255, 255, 0.16);
      background: rgba(255, 255, 255, 0.06);
      color: #dceaff;
      font-size: 11px;
      padding: 3px 8px;
      border-radius: 999px;
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s, color 0.15s;
    }
    .up-chip:hover {
      background: rgba(255, 255, 255, 0.16);
      color: #fff;
    }
    .up-chip.active {
      background: rgba(92, 225, 255, 0.22);
      border-color: rgba(92, 225, 255, 0.65);
      color: #fff;
    }
    .up-stats {
      font-size: 10.5px;
      font-variant-numeric: tabular-nums;
      color: rgba(185, 212, 240, 0.8);
      white-space: nowrap;
    }
    .up-pill {
      pointer-events: auto;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 5px 8px;
      border-radius: 999px;
      background: rgba(10, 14, 24, 0.90);
      backdrop-filter: blur(18px) saturate(160%);
      -webkit-backdrop-filter: blur(18px) saturate(160%);
      border: 1px solid rgba(255, 255, 255, 0.22);
      box-shadow: 0 8px 28px rgba(0, 0, 0, 0.5);
      color: #fff;
    }
    .up-arrow {
      appearance: none;
      width: 28px;
      height: 28px;
      border-radius: 50%;
      border: 1px solid rgba(255, 255, 255, 0.16);
      background: rgba(255, 255, 255, 0.08);
      color: #fff;
      font-size: 14px;
      line-height: 1;
      display: grid;
      place-items: center;
      cursor: pointer;
      transition: background 0.15s, transform 0.1s;
    }
    .up-arrow:hover { background: rgba(255, 255, 255, 0.2); }
    .up-arrow:active { transform: scale(0.92); }
    .up-label {
      appearance: none;
      border: none;
      background: transparent;
      color: #fff;
      display: inline-flex;
      align-items: center;
      gap: 7px;
      padding: 2px 8px;
      cursor: pointer;
      font-size: 12.5px;
      font-weight: 600;
      letter-spacing: 0.02em;
      white-space: nowrap;
    }
    .up-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 20px;
      height: 20px;
      padding: 0 5px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 800;
      color: #09111c;
      background: var(--up-accent, #5ce1ff);
    }
    .up-proto-tag {
      font-size: 9.5px;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: rgba(255, 255, 255, 0.55);
      padding-left: 2px;
    }
  `;
  document.head.appendChild(style);
}

// ------------------------------------------------------------ Mount Entrypoint

export function mountUltraQualityPrototype(host: UltraPrototypeHost): UltraPrototypeHandle {
  injectPrototypeStyles();

  const { renderer, scene, camera, waterMesh, terrain, sky, clouds, aurora, karstCloudSea, grassField, ambientMotes } = host;
  const baselineWaterMat = waterMesh.material;
  const baselineExposure = renderer.toneMappingExposure;

  // 1. Offscreen targets: 4x MSAA HDR composer + Depth/Normal G-Buffer + Planar Water Reflection
  const initW = Math.max(1, window.innerWidth);
  const initH = Math.max(1, window.innerHeight);

  const gbufRT = new THREE.WebGLRenderTarget(initW, initH, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: true,
  });
  const gbufMat = createGBufferMaterial();

  const reflRT = new THREE.WebGLRenderTarget(Math.max(1, Math.floor(initW * 0.55)), Math.max(1, Math.floor(initH * 0.55)), {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: true,
  });
  const reflCam = new THREE.PerspectiveCamera();
  const waterClipPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(WATER_LEVEL - 0.18));

  const ultraWaterMat = createUltraWaterMaterial(terrain, reflRT.texture);

  const msaaSamples = renderer.capabilities.isWebGL2 ? 4 : 0;
  const ultraRT = new THREE.WebGLRenderTarget(initW, initH, {
    type: THREE.HalfFloatType,
    samples: msaaSamples,
  });
  const ultraComposer = new EffectComposer(renderer, ultraRT);
  const ultraRenderPass = new RenderPass(scene, camera);
  const ultraBloomPass = new UnrealBloomPass(new THREE.Vector2(initW * 0.5, initH * 0.5), 0.36, 0.65, 0.94);
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

  const ultraCompositePass = new ShaderPass(createUltraCompositeShader(gbufRT.texture));
  ultraComposer.addPass(ultraRenderPass);
  ultraComposer.addPass(ultraBloomPass);
  ultraComposer.addPass(ultraCompositePass);

  // 2. Extra 3D Showcase World Layers (disabled in baseline)
  const ultraGrass = new UltraGrassField(terrain);
  const windRibbons = new PainterlyWindRibbons();
  const ultraSwarm = new UltraAtmosphereSwarm();
  scene.add(ultraGrass.group, windRibbons.group, ultraSwarm.points);

  // 3. Variant State & URL Sync (?variant=baseline|A|B|C|D)
  const parseVariantFromUrl = (): UltraVariantId => {
    const raw = new URLSearchParams(window.location.search).get('variant');
    if (raw) {
      const hit = ULTRA_VARIANTS.find((v) => v.id.toLowerCase() === raw.toLowerCase() || v.code.toLowerCase() === raw.toLowerCase());
      if (hit) return hit.id;
    }
    return 'A';
  };

  let activeId: UltraVariantId = parseVariantFromUrl();
  let activeSpec: UltraVariantSpec = ULTRA_VARIANTS.find((v) => v.id === activeId) ?? ULTRA_VARIANTS[1];
  let activeSpotId: string | null = null;
  let cardCollapsed = false;

  // 4. Floating Switcher Bar DOM
  const dock = document.createElement('div');
  dock.className = 'up-dock';
  dock.id = 'ultra-proto-dock';

  const card = document.createElement('div');
  card.className = 'up-card';
  const subEl = document.createElement('div');
  subEl.className = 'up-sub';
  const tagsEl = document.createElement('div');
  tagsEl.className = 'up-tags';

  const rowEl = document.createElement('div');
  rowEl.className = 'up-row';
  const chipsEl = document.createElement('div');
  chipsEl.className = 'up-chips';
  const statsEl = document.createElement('div');
  statsEl.className = 'up-stats';
  statsEl.textContent = '-- fps';

  // Scenic spot quick teleports + Day/Sunset/Night toggles
  const spotButtons = new Map<string, HTMLButtonElement>();
  for (const spot of SHOWCASE_SPOTS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'up-chip';
    b.textContent = spot.label;
    b.addEventListener('click', () => {
      if (host.getState() === 'title') host.startGame();
      host.devGame.setTime(spot.tod);
      host.devGame.setCamOverride(spot.camPos, spot.camLook);
      activeSpotId = spot.id;
      syncSpotButtons();
    });
    chipsEl.appendChild(b);
    spotButtons.set(spot.id, b);
  }
  const freeBtn = document.createElement('button');
  freeBtn.type = 'button';
  freeBtn.className = 'up-chip';
  freeBtn.textContent = '自由探索';
  freeBtn.addEventListener('click', () => {
    if (host.getState() === 'title') host.startGame();
    host.devGame.setCamOverride(null);
    activeSpotId = null;
    syncSpotButtons();
  });
  chipsEl.appendChild(freeBtn);

  // Quick time-of-day chips
  const todChips: { label: string; tod: number }[] = [
    { label: '晴', tod: DAY_PRESETS[0].t },
    { label: '夕', tod: DAY_PRESETS[1].t },
    { label: '夜', tod: DAY_PRESETS[2].t },
  ];
  for (const tc of todChips) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'up-chip';
    b.textContent = tc.label;
    b.addEventListener('click', () => host.devGame.setTime(tc.tod));
    chipsEl.appendChild(b);
  }

  function syncSpotButtons() {
    for (const [id, btn] of spotButtons) {
      btn.classList.toggle('active', activeSpotId === id);
    }
    freeBtn.classList.toggle('active', activeSpotId === null);
  }
  syncSpotButtons();

  rowEl.append(chipsEl, statsEl);
  card.append(subEl, tagsEl, rowEl);

  const pill = document.createElement('div');
  pill.className = 'up-pill';

  const prevBtn = document.createElement('button');
  prevBtn.type = 'button';
  prevBtn.className = 'up-arrow';
  prevBtn.setAttribute('aria-label', 'Previous variant');
  prevBtn.textContent = '←';

  const labelBtn = document.createElement('button');
  labelBtn.type = 'button';
  labelBtn.className = 'up-label';
  const badgeEl = document.createElement('span');
  badgeEl.className = 'up-badge';
  const nameEl = document.createElement('span');
  const protoTagEl = document.createElement('span');
  protoTagEl.className = 'up-proto-tag';
  protoTagEl.textContent = 'ULTRA PROTO';
  labelBtn.append(badgeEl, nameEl, protoTagEl);

  const nextBtn = document.createElement('button');
  nextBtn.type = 'button';
  nextBtn.className = 'up-arrow';
  nextBtn.setAttribute('aria-label', 'Next variant');
  nextBtn.textContent = '→';

  pill.append(prevBtn, labelBtn, nextBtn);
  dock.append(card, pill);
  document.body.appendChild(dock);

  // Allow clicking the center pill label to toggle the detail inspector card
  labelBtn.addEventListener('click', () => {
    cardCollapsed = !cardCollapsed;
    card.classList.toggle('collapsed', cardCollapsed);
  });

  function syncUi() {
    pill.style.setProperty('--up-accent', activeSpec.accent);
    badgeEl.textContent = activeSpec.code;
    nameEl.textContent = `${activeSpec.name}`;
    subEl.textContent = activeSpec.subtitle;
    tagsEl.innerHTML = '';
    for (const h of activeSpec.highlights) {
      const span = document.createElement('span');
      span.className = 'up-tag';
      span.textContent = h;
      tagsEl.appendChild(span);
    }
  }

  function resizeAll(w: number, h: number) {
    const pr = Math.min(window.devicePixelRatio || 1, activeSpec.dprCap);
    renderer.setPixelRatio(pr);
    renderer.setSize(w, h, false);

    const rw = Math.max(1, Math.floor(w * pr));
    const rh = Math.max(1, Math.floor(h * pr));
    ultraComposer.setPixelRatio(pr);
    ultraComposer.setSize(w, h);
    ultraBloomPass.resolution.set(Math.max(1, Math.floor(w * 0.5)), Math.max(1, Math.floor(h * 0.5)));

    // Half-res G-buffer is super crisp on 3x Retina while keeping mobile fill-rate silky
    const gScale = activeSpec.id === 'B' ? 0.75 : 0.5;
    gbufRT.setSize(Math.max(1, Math.floor(rw * gScale)), Math.max(1, Math.floor(rh * gScale)));
    reflRT.setSize(Math.max(1, Math.floor(rw * 0.5)), Math.max(1, Math.floor(rh * 0.5)));

    ultraCompositePass.uniforms.uResolution.value.set(rw, rh);
    ultraSwarm.setViewport(rh, camera.fov);
  }

  function applyVariant(id: UltraVariantId, updateUrl = true) {
    const spec = ULTRA_VARIANTS.find((v) => v.id === id) ?? ULTRA_VARIANTS[0];
    activeId = spec.id;
    activeSpec = spec;

    if (updateUrl) {
      const url = new URL(window.location.href);
      url.searchParams.set('variant', spec.id);
      window.history.replaceState({}, '', url.toString());
    }

    // Shadow & exposure
    host.setShadowConfig(spec.shadowSize, spec.shadowRange, spec.shadowSoft);
    renderer.toneMappingExposure = spec.id === 'baseline' ? baselineExposure : spec.exposure;

    // Water material swap
    if (spec.id === 'baseline') {
      waterMesh.material = baselineWaterMat;
    } else {
      waterMesh.material = ultraWaterMat;
      ultraWaterMat.uniforms.uReflStrength.value = spec.useReflection ? spec.reflStrength : 0.0;
      ultraWaterMat.uniforms.uCausticsStrength.value = spec.causticsStrength;
      ultraWaterMat.uniforms.uPainterlyMode.value = spec.painterlyWater;
      ultraWaterMat.uniforms.uBioShoreStrength.value = spec.bioShoreStrength;
    }

    // Bloom & composite shader weights
    ultraBloomPass.radius = spec.bloomRadius;
    ultraBloomPass.threshold = spec.bloomThreshold;

    const u = ultraCompositePass.uniforms;
    u.uGodRayStrength.value = spec.godRayStrength;
    u.uAnamorphicStrength.value = spec.anamorphicStrength;
    u.uShinkaiGrade.value = spec.shinkaiGrade;
    u.uWatercolorInk.value = spec.watercolorInk;
    u.uKuwaharaStrength.value = spec.kuwaharaStrength;
    u.uPaperGrain.value = spec.paperGrain;
    u.uSsaoStrength.value = spec.ssaoStrength;
    u.uDofStrength.value = spec.dofStrength;
    u.uVolFogStrength.value = spec.volFogStrength;
    u.uDreamyGlow.value = spec.dreamyGlow;

    // 3D living-world layers
    windRibbons.group.visible = spec.windRibbons;
    ultraSwarm.setCount(spec.swarmCount);

    // Trigger clean resize so DPR & render targets update immediately
    host.triggerResize();
    resizeAll(window.innerWidth, window.innerHeight);
    syncUi();
  }

  function cycle(dir: -1 | 1) {
    const idx = ULTRA_VARIANTS.findIndex((v) => v.id === activeId);
    const nextIdx = (idx + dir + ULTRA_VARIANTS.length) % ULTRA_VARIANTS.length;
    applyVariant(ULTRA_VARIANTS[nextIdx].id, true);
  }

  prevBtn.addEventListener('click', () => cycle(-1));
  nextBtn.addEventListener('click', () => cycle(1));

  window.addEventListener('keydown', (e) => {
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement | null)?.isContentEditable) return;
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      cycle(-1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      cycle(1);
    }
  });

  // 5. Per-frame scratch objects (zero per-frame GC allocations)
  const tmpDir = new THREE.Vector3();
  const tmpTarget = new THREE.Vector3();
  const tmpLightWorld = new THREE.Vector3();
  const tmpReflProjView = new THREE.Matrix4();
  const tmpInvProjView = new THREE.Matrix4();
  const tmpClearCol = new THREE.Color();
  const gbufClearCol = new THREE.Color(0.5, 0.5, 1.0);

  let fpsFrames = 0;
  let fpsAccum = 0;
  let smoothFps = 60;

  function renderGBuffer() {
    const prevSkyVis = sky.visible;
    const prevWaterVis = waterMesh.visible;
    const prevCloudsVis = clouds.visible;
    const prevAuroraVis = aurora.visible;
    const prevCloudSeaVis = karstCloudSea.visible;
    const prevMotesVis = ambientMotes.points.visible;
    const prevSwarmVis = ultraSwarm.points.visible;
    const prevRibbonsVis = windRibbons.group.visible;
    const prevGrassVis = grassField.group.visible;
    const prevUltraGrassVis = ultraGrass.group.visible;

    // Exclude translucent sky/water/particles so G-buffer holds clean solid world depth + normals
    sky.visible = false;
    waterMesh.visible = false;
    clouds.visible = false;
    aurora.visible = false;
    karstCloudSea.visible = false;
    ambientMotes.points.visible = false;
    ultraSwarm.points.visible = false;
    windRibbons.group.visible = false;
    grassField.group.visible = false;
    ultraGrass.group.visible = false;

    renderer.getClearColor(tmpClearCol);
    const prevClearAlpha = renderer.getClearAlpha();
    const prevOverride = scene.overrideMaterial;

    scene.overrideMaterial = gbufMat;
    renderer.setRenderTarget(gbufRT);
    renderer.setClearColor(gbufClearCol, 1.0);
    renderer.clear(true, true, false);
    renderer.render(scene, camera);

    scene.overrideMaterial = prevOverride;
    renderer.setClearColor(tmpClearCol, prevClearAlpha);
    renderer.setRenderTarget(null);

    sky.visible = prevSkyVis;
    waterMesh.visible = prevWaterVis;
    clouds.visible = prevCloudsVis;
    aurora.visible = prevAuroraVis;
    karstCloudSea.visible = prevCloudSeaVis;
    ambientMotes.points.visible = prevMotesVis;
    ultraSwarm.points.visible = prevSwarmVis;
    windRibbons.group.visible = prevRibbonsVis;
    grassField.group.visible = prevGrassVis;
    ultraGrass.group.visible = prevUltraGrassVis;
  }

  function renderPlanarReflection() {
    // Only render mirror reflection when camera is above the water plane
    if (camera.position.y <= WATER_LEVEL + 0.15) return;

    camera.getWorldDirection(tmpDir);
    reflCam.position.set(camera.position.x, 2 * WATER_LEVEL - camera.position.y, camera.position.z);
    tmpTarget.set(
      reflCam.position.x + tmpDir.x,
      reflCam.position.y - tmpDir.y,
      reflCam.position.z + tmpDir.z,
    );
    reflCam.up.set(0, 1, 0);
    reflCam.fov = camera.fov;
    reflCam.aspect = camera.aspect;
    reflCam.near = camera.near;
    reflCam.far = camera.far;
    reflCam.lookAt(tmpTarget);
    reflCam.updateProjectionMatrix();
    reflCam.updateMatrixWorld();

    tmpReflProjView.multiplyMatrices(reflCam.projectionMatrix, reflCam.matrixWorldInverse);
    ultraWaterMat.uniforms.uReflMatrix.value.copy(tmpReflProjView);

    const prevWaterVis = waterMesh.visible;
    const prevGrassVis = grassField.group.visible;
    const prevUltraGrassVis = ultraGrass.group.visible;
    const prevShadowAuto = renderer.shadowMap.autoUpdate;

    waterMesh.visible = false;
    grassField.group.visible = false;
    ultraGrass.group.visible = false;
    sky.position.copy(reflCam.position);

    // Clip underwater seabed geometry cleanly so it never pokes into the mirror reflection
    renderer.clippingPlanes = [waterClipPlane];
    renderer.shadowMap.autoUpdate = false;
    renderer.setRenderTarget(reflRT);
    renderer.clear(true, true, false);
    renderer.render(scene, reflCam);

    renderer.setRenderTarget(null);
    renderer.clippingPlanes = [];
    renderer.shadowMap.autoUpdate = prevShadowAuto;

    sky.position.copy(camera.position);
    waterMesh.visible = prevWaterVis;
    grassField.group.visible = prevGrassVis;
    ultraGrass.group.visible = prevUltraGrassVis;
  }

  function updateCompositeUniforms() {
    const u = ultraCompositePass.uniforms;
    const isNight = celUniforms.uNightFactor.value > 0.55;
    const lightDir = isNight ? celUniforms.uMoonDir.value : celUniforms.uSunDir.value;

    camera.getWorldDirection(tmpDir);
    u.uSunFacing.value = lightDir.dot(tmpDir);
    u.uLightElev.value = lightDir.y;

    tmpLightWorld.copy(camera.position).addScaledVector(lightDir, 800);
    tmpLightWorld.project(camera);
    u.uSunScreenUv.value.set(tmpLightWorld.x * 0.5 + 0.5, tmpLightWorld.y * 0.5 + 0.5);

    u.uCamPos.value.copy(camera.position);
    tmpInvProjView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).invert();
    u.uInvProjView.value.copy(tmpInvProjView);

    const tanHalfFov = Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5));
    u.uProjScale.value.set(tanHalfFov * camera.aspect, tanHalfFov);

    // Smooth focal distance for Bokeh DoF (locks onto player in play mode or hero landmark ~36m away in scenic camera)
    const viewerDist = camera.position.distanceTo(host.getViewerPos());
    const targetFocus = viewerDist > 1.5 ? Math.max(10, Math.min(45, viewerDist * 1.15)) : 36;
    u.uFocusDist.value += (targetFocus - u.uFocusDist.value) * 0.25;
  }

  // Apply initial variant on mount
  applyVariant(activeId, false);

  renderer.info.autoReset = false;

  return {
    render(dt: number, elapsed: number, focusPos: THREE.Vector3) {
      renderer.info.reset();

      if (activeSpec.id === 'baseline') {
        ultraGrass.group.visible = false;
        host.composer.render();
      } else {
        // Swap baseline grass for extended backlit ultra grass during non-title play
        const isTitle = host.getState() === 'title';
        if (activeSpec.ultraGrass && !isTitle) {
          grassField.group.visible = false;
          ultraGrass.group.visible = true;
          ultraGrass.update(focusPos);
        } else {
          ultraGrass.group.visible = false;
        }

        windRibbons.update(focusPos, elapsed);
        ultraSwarm.update(focusPos, host.getBiomeWeights());

        // Sync bloom strength dynamically with day/night + variant scale
        ultraBloomPass.strength = host.bloomPass.strength * activeSpec.bloomScale;

        if (activeSpec.useReflection) {
          renderPlanarReflection();
        }
        if (activeSpec.useGBuffer) {
          renderGBuffer();
        }
        updateCompositeUniforms();
        ultraComposer.render();
      }

      fpsFrames++;
      fpsAccum += dt;
      if (fpsAccum >= 0.35) {
        smoothFps = Math.round(fpsFrames / fpsAccum);
        fpsFrames = 0;
        fpsAccum = 0;
        const info = renderer.info.render;
        const pr = renderer.getPixelRatio().toFixed(2);
        statsEl.textContent = `${smoothFps} fps · ${info.calls} calls · ${(info.triangles / 1000).toFixed(0)}k tris · ${pr}x`;
      }
    },

    resize(w: number, h: number) {
      resizeAll(w, h);
    },

    setVariant(id: UltraVariantId) {
      applyVariant(id, true);
    },

    getVariant() {
      return activeId;
    },
  };
}
