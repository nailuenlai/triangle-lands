import * as THREE from 'three';
import { HALF, SEG, WATER_LEVEL, WORLD_SIZE, type Terrain } from './terrain';

/**
 * Breath of the Wild–inspired watercolor / anime cel-shading palette & uniforms.
 * Supports a full smooth day/night cycle (Dawn -> Day -> Sunset -> Twilight -> Moonlit Night).
 */
export const BOTW_PALETTE = {
  skyZenith: new THREE.Color('#2d82d6'),
  skyMid: new THREE.Color('#74bdeb'),
  skyHorizon: new THREE.Color('#d7eeef'),
  sunHaze: new THREE.Color('#fff1cc'),
  aerialBlue: new THREE.Color('#8ec3e8'),
  valleyMist: new THREE.Color('#e2f2f1'),
  shadowTint: new THREE.Color('#4f6fa3'),
  litTint: new THREE.Color('#fff9eb'),
  rimColor: new THREE.Color('#fff9e6'),
  cloudTop: new THREE.Color('#fcfaf2'),
  cloudBottom: new THREE.Color('#779ec9'),
  inactive: new THREE.Color('#ff9d3b'),
  active: new THREE.Color('#4be5ff'),
};

const DAY_SHADOW_BASE = BOTW_PALETTE.shadowTint.clone();
const DAY_RIM_BASE = BOTW_PALETTE.rimColor.clone();

export const celUniforms = {
  uTime: { value: 0 },
  uSunDir: { value: new THREE.Vector3(0.48, 0.58, 0.36).normalize() },
  uMoonDir: { value: new THREE.Vector3(-0.48, -0.58, -0.36).normalize() },
  uNightFactor: { value: 0.0 },
  uSunsetFactor: { value: 0.0 },
  uSkyZenith: { value: BOTW_PALETTE.skyZenith.clone() },
  uSkyMid: { value: BOTW_PALETTE.skyMid.clone() },
  uSkyHorizon: { value: BOTW_PALETTE.skyHorizon.clone() },
  uSunHaze: { value: BOTW_PALETTE.sunHaze.clone() },
  uAerialBlue: { value: BOTW_PALETTE.aerialBlue.clone() },
  uValleyMist: { value: BOTW_PALETTE.valleyMist.clone() },
  uShadowTint: { value: BOTW_PALETTE.shadowTint.clone() },
  uShadowMod: { value: new THREE.Vector3(1, 1, 1) },
  uLitTint: { value: BOTW_PALETTE.litTint.clone() },
  uRimMod: { value: new THREE.Vector3(1, 1, 1) },
  uCloudTop: { value: BOTW_PALETTE.cloudTop.clone() },
  uCloudBottom: { value: BOTW_PALETTE.cloudBottom.clone() },
  uFogNear: { value: 105.0 },
  uFogFar: { value: 560.0 },
};

export function updateCelTime(t: number) {
  celUniforms.uTime.value = t;
}

// ------------------------------------------------------------ Day / Night Atmosphere Engine

interface SkyKeyframe {
  t: number; // 0..1 (0 = midnight, 0.25 = dawn, 0.5 = noon, 0.75 = sunset)
  skyZenith: THREE.Color;
  skyMid: THREE.Color;
  skyHorizon: THREE.Color;
  sunHaze: THREE.Color;
  aerialBlue: THREE.Color;
  valleyMist: THREE.Color;
  shadowTint: THREE.Color;
  litTint: THREE.Color;
  rimColor: THREE.Color;
  cloudTop: THREE.Color;
  cloudBottom: THREE.Color;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  hemiInt: number;
  night: number;
  sunset: number;
}

const mkKey = (
  t: number,
  skyZenith: string, skyMid: string, skyHorizon: string,
  sunHaze: string, aerialBlue: string, valleyMist: string,
  shadowTint: string, litTint: string, rimColor: string,
  cloudTop: string, cloudBottom: string,
  hemiSky: string, hemiGround: string, hemiInt: number,
  night: number, sunset: number,
): SkyKeyframe => ({
  t,
  skyZenith: new THREE.Color(skyZenith),
  skyMid: new THREE.Color(skyMid),
  skyHorizon: new THREE.Color(skyHorizon),
  sunHaze: new THREE.Color(sunHaze),
  aerialBlue: new THREE.Color(aerialBlue),
  valleyMist: new THREE.Color(valleyMist),
  shadowTint: new THREE.Color(shadowTint),
  litTint: new THREE.Color(litTint),
  rimColor: new THREE.Color(rimColor),
  cloudTop: new THREE.Color(cloudTop),
  cloudBottom: new THREE.Color(cloudBottom),
  hemiSky: new THREE.Color(hemiSky),
  hemiGround: new THREE.Color(hemiGround),
  hemiInt,
  night,
  sunset,
});

const SKY_KEYS: SkyKeyframe[] = [
  // 0.00 Midnight — serene starry moonlit night
  mkKey(0.00, '#07112a', '#11254d', '#24406b', '#4d73a6', '#1a3259', '#203a61',
    '#22345e', '#7da4db', '#99ccff', '#53739e', '#1c2b4a', '#355a96', '#141d33', 0.9, 1.0, 0.0),
  // 0.17 Late night before dawn
  mkKey(0.17, '#0c1a3d', '#1c3261', '#384c75', '#6e6b8f', '#253c66', '#2f456e',
    '#283966', '#89a8d9', '#a6ccff', '#627aa3', '#233357', '#44639c', '#1c243b', 0.95, 0.88, 0.15),
  // 0.25 Rosy watercolor dawn (朝霞)
  mkKey(0.25, '#3b6bc0', '#d496ad', '#ffdcb5', '#ffe1b3', '#b3a3cb', '#f2d3c4',
    '#4f639e', '#ffe4c2', '#ffebd0', '#ffe4c9', '#7771a1', '#ffd6c4', '#5c5358', 1.25, 0.12, 0.85),
  // 0.36 Bright Hyrule morning-day (晴晝 — primary BotW look)
  mkKey(0.36, '#2d82d6', '#74bdeb', '#d7eeef', '#fff1cc', '#8ec3e8', '#e2f2f1',
    '#4f6fa3', '#fff9eb', '#fff9e6', '#fcfaf2', '#779ec9', '#d6eeff', '#7b6d4a', 1.4, 0.0, 0.0),
  // 0.62 Warm sunny afternoon
  mkKey(0.62, '#2a7bd1', '#78bce8', '#dceee8', '#ffebc0', '#92c0e0', '#e8efe8',
    '#4c6b9e', '#fff4dc', '#fff3d6', '#fcf6e6', '#7898c4', '#d9ecff', '#806d48', 1.4, 0.0, 0.12),
  // 0.75 Golden-hour sunset (黃金夕陽)
  mkKey(0.75, '#264d8f', '#d9784e', '#ffc67a', '#ffb85c', '#c78374', '#f2b382',
    '#4a518f', '#ffca82', '#ffd899', '#ffc98c', '#685285', '#ffbe8a', '#594246', 1.25, 0.08, 1.0),
  // 0.84 Blue-hour twilight (湛藍暮色)
  mkKey(0.84, '#132252', '#3a4478', '#80668c', '#bf848b', '#414f80', '#545f87',
    '#2e3e6e', '#9ea9db', '#b5c6f5', '#8f98c4', '#313c66', '#6974a8', '#292e47', 1.0, 0.62, 0.35),
  // 0.93 Starry nightfall
  mkKey(0.93, '#08132e', '#132852', '#26426e', '#5076a8', '#1d365e', '#223d66',
    '#233560', '#7fa5dc', '#9bcaff', '#5777a3', '#1e2e4f', '#385d99', '#162038', 0.9, 0.96, 0.0),
];

export interface DayNightState {
  lightDir: THREE.Vector3;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  hemiIntensity: number;
  nightFactor: number;
  sunsetFactor: number;
  bloomStrength: number;
  phase: 'morning' | 'sunset' | 'night' | 'dawn';
  phaseLabel: string;
}

export const DAY_PRESETS = [
  { t: 0.39, phase: 'morning' as const, label: '晴晝' },
  { t: 0.745, phase: 'sunset' as const, label: '夕陽' },
  { t: 0.02, phase: 'night' as const, label: '星空' },
  { t: 0.255, phase: 'dawn' as const, label: '朝霞' },
];

const _tmpRim = new THREE.Color();
const _state: DayNightState = {
  lightDir: new THREE.Vector3(0.48, 0.58, 0.36).normalize(),
  hemiSky: new THREE.Color('#d6eeff'),
  hemiGround: new THREE.Color('#7b6d4a'),
  hemiIntensity: 1.4,
  nightFactor: 0,
  sunsetFactor: 0,
  bloomStrength: 0.32,
  phase: 'morning',
  phaseLabel: '晴晝',
};

/**
 * Updates all shared BotW cel-shading, sky, cloud, water, and fog uniforms for a given
 * normalized time of day in [0, 1) (0 = midnight, 0.25 = dawn, 0.5 = noon, 0.75 = sunset).
 */
export function updateDayNight(timeOfDay: number): DayNightState {
  const t = ((timeOfDay % 1) + 1) % 1;

  // Locate surrounding keyframes (wrapping cleanly across midnight)
  let a = SKY_KEYS[SKY_KEYS.length - 1];
  let b = SKY_KEYS[0];
  let span = 1 - a.t + b.t;
  let local = t >= a.t ? (t - a.t) / span : (t + 1 - a.t) / span;
  for (let i = 0; i < SKY_KEYS.length - 1; i++) {
    if (t >= SKY_KEYS[i].t && t < SKY_KEYS[i + 1].t) {
      a = SKY_KEYS[i];
      b = SKY_KEYS[i + 1];
      span = b.t - a.t;
      local = (t - a.t) / span;
      break;
    }
  }
  // Smoothstep easing between keyframes for buttery color transitions
  const k = local * local * (3 - 2 * local);

  celUniforms.uSkyZenith.value.copy(a.skyZenith).lerp(b.skyZenith, k);
  celUniforms.uSkyMid.value.copy(a.skyMid).lerp(b.skyMid, k);
  celUniforms.uSkyHorizon.value.copy(a.skyHorizon).lerp(b.skyHorizon, k);
  celUniforms.uSunHaze.value.copy(a.sunHaze).lerp(b.sunHaze, k);
  celUniforms.uAerialBlue.value.copy(a.aerialBlue).lerp(b.aerialBlue, k);
  celUniforms.uValleyMist.value.copy(a.valleyMist).lerp(b.valleyMist, k);
  celUniforms.uShadowTint.value.copy(a.shadowTint).lerp(b.shadowTint, k);
  celUniforms.uLitTint.value.copy(a.litTint).lerp(b.litTint, k);
  celUniforms.uCloudTop.value.copy(a.cloudTop).lerp(b.cloudTop, k);
  celUniforms.uCloudBottom.value.copy(a.cloudBottom).lerp(b.cloudBottom, k);

  _tmpRim.copy(a.rimColor).lerp(b.rimColor, k);
  celUniforms.uRimMod.value.set(
    _tmpRim.r / Math.max(DAY_RIM_BASE.r, 0.01),
    _tmpRim.g / Math.max(DAY_RIM_BASE.g, 0.01),
    _tmpRim.b / Math.max(DAY_RIM_BASE.b, 0.01),
  );
  celUniforms.uShadowMod.value.set(
    celUniforms.uShadowTint.value.r / Math.max(DAY_SHADOW_BASE.r, 0.01),
    celUniforms.uShadowTint.value.g / Math.max(DAY_SHADOW_BASE.g, 0.01),
    celUniforms.uShadowTint.value.b / Math.max(DAY_SHADOW_BASE.b, 0.01),
  );

  const night = a.night + (b.night - a.night) * k;
  const sunset = a.sunset + (b.sunset - a.sunset) * k;
  celUniforms.uNightFactor.value = night;
  celUniforms.uSunsetFactor.value = sunset;

  // Orbital sun arc tilted gracefully across the southern/eastern sky (matches original morning angle around t=0.39)
  const theta = (t - 0.25) * Math.PI * 2;
  const elev = Math.sin(theta);
  const horiz = Math.cos(theta);
  celUniforms.uSunDir.value.set(horiz * 0.82, elev * 0.78 + 0.06, 0.44 - Math.abs(horiz) * 0.08).normalize();
  celUniforms.uMoonDir.value.set(-horiz * 0.78, -elev * 0.74 + 0.12, -0.38).normalize();

  // Primary shadow-casting directional light follows the sun by day and the moon by night
  const useMoon = celUniforms.uSunDir.value.y < 0.14;
  if (useMoon) {
    _state.lightDir.copy(celUniforms.uMoonDir.value);
  } else {
    _state.lightDir.copy(celUniforms.uSunDir.value);
  }
  // Keep shadow caster above shallow grazing artifacts
  if (_state.lightDir.y < 0.22) {
    _state.lightDir.y = 0.22;
    _state.lightDir.normalize();
  }

  _state.hemiSky.copy(a.hemiSky).lerp(b.hemiSky, k);
  _state.hemiGround.copy(a.hemiGround).lerp(b.hemiGround, k);
  _state.hemiIntensity = a.hemiInt + (b.hemiInt - a.hemiInt) * k;
  _state.nightFactor = night;
  _state.sunsetFactor = sunset;
  // Soft selective bloom intensifies subtly at sunset & starry night
  _state.bloomStrength = 0.30 + sunset * 0.10 + night * 0.14;

  if (night > 0.55) { _state.phase = 'night'; _state.phaseLabel = '星空'; }
  else if (t >= 0.66 && t < 0.86) { _state.phase = 'sunset'; _state.phaseLabel = '夕陽'; }
  else if (t >= 0.19 && t < 0.31) { _state.phase = 'dawn'; _state.phaseLabel = '朝霞'; }
  else { _state.phase = 'morning'; _state.phaseLabel = '晴晝'; }

  return _state;
}

// ------------------------------------------------------------ Shared GLSL snippets

export const CEL_NOISE_GLSL = /* glsl */ `
float celHash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float celNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = celHash(i);
  float b = celHash(i + vec2(1.0, 0.0));
  float c = celHash(i + vec2(0.0, 1.0));
  float d = celHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float celFbm(vec2 p) {
  float v = 0.0;
  v += 0.62 * celNoise(p);
  v += 0.38 * celNoise(p * 2.07 + vec2(17.1, 31.7));
  return v;
}

float celCloudShadow(vec2 xz, float time) {
  vec2 uv = xz * 0.0085 - vec2(time * 0.022, time * 0.009);
  float n = celFbm(uv);
  return smoothstep(0.45, 0.70, n);
}
`;

export const CEL_SAFE_MATH_GLSL = /* glsl */ `
vec3 safeNormalize(vec3 v) {
  float lenSq = dot(v, v);
  return lenSq > 1e-10 ? v * inversesqrt(lenSq) : vec3(0.0, 1.0, 0.0);
}

float safePow(float x, float y) {
  return x > 1e-6 ? pow(x, y) : 0.0;
}
`;

export const CEL_ATMOS_PARS_GLSL = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform float uNightFactor;
uniform vec3 uSkyHorizon;
uniform vec3 uSunHaze;
uniform vec3 uAerialBlue;
uniform vec3 uValleyMist;
uniform float uFogNear;
uniform float uFogFar;

vec3 applyBotwAtmosphere(vec3 col, vec3 worldPos) {
  vec3 toFrag = worldPos - cameraPosition;
  float dist = length(toFrag);
  vec3 viewDir = toFrag / max(dist, 0.0001);

  vec3 scatterDir = safeNormalize(mix(uSunDir, uMoonDir, uNightFactor));
  float sd = clamp(dot(viewDir, scatterDir), 0.0, 1.0);
  float sd2 = sd * sd;
  float sunScatter = sd2 * sd2;
  float horizonLift = smoothstep(0.28, -0.05, viewDir.y);

  // Aerial perspective: near & mid stay vivid; distant ridges layer into sky-tinted mist
  vec3 farColor = mix(uAerialBlue, uSkyHorizon, 0.38 + 0.35 * horizonLift);
  farColor = mix(farColor, uSunHaze, sunScatter * (0.52 - 0.18 * uNightFactor));

  float distFactor = smoothstep(uFogNear, uFogFar, dist);
  distFactor = safePow(distFactor, 1.18);
  col = mix(col, farColor, distFactor * 0.88);

  // Delicate valley mountain mist (山嵐) settling in distant lowlands & lakes
  float lowMask = smoothstep(26.0, 1.5, worldPos.y);
  float mistDist = smoothstep(75.0, 260.0, dist);
  float valleyAmt = lowMask * mistDist * 0.22;
  vec3 mistCol = mix(uValleyMist, uSunHaze, sunScatter * 0.32);
  col = mix(col, mistCol, valleyAmt);

  return col;
}
`;

// ------------------------------------------------------------ Cel Material Factory

export interface CelMaterialOptions {
  color?: THREE.ColorRepresentation;
  vertexColors?: boolean;
  flatShading?: boolean;
  side?: THREE.Side;
  transparent?: boolean;
  opacity?: number;
  depthWrite?: boolean;
  shadowTint?: THREE.ColorRepresentation;
  rimColor?: THREE.ColorRepresentation;
  rimStrength?: number;
  rimPower?: number;
  stepLow?: number;
  stepHigh?: number;
  highlight?: number;
  cloudShadow?: number;
  mossTop?: number;
  wind?: { amp: number; freq: number; heightOffset?: number };
  cacheKey?: string;
}

/**
 * Creates a Breath of the Wild watercolor-cel material built on MeshLambertMaterial
 * so Three.js handles real-time shadow maps, InstancedMesh transforms/colors,
 * transparency fades, and depth sorting natively.
 */
export function createCelMaterial(opts: CelMaterialOptions = {}): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({
    color: opts.color ?? '#ffffff',
    vertexColors: opts.vertexColors ?? false,
    flatShading: opts.flatShading ?? false,
    side: opts.side ?? THREE.FrontSide,
    transparent: opts.transparent ?? false,
    opacity: opts.opacity ?? 1,
    depthWrite: opts.depthWrite ?? true,
    fog: false,
  });

  const shadowTint = opts.shadowTint ? new THREE.Color(opts.shadowTint) : BOTW_PALETTE.shadowTint.clone();
  const rimColor = opts.rimColor ? new THREE.Color(opts.rimColor) : BOTW_PALETTE.rimColor.clone();
  const rimStrength = opts.rimStrength ?? 0.38;
  const rimPower = opts.rimPower ?? 2.7;
  const stepLow = opts.stepLow ?? -0.02;
  const stepHigh = opts.stepHigh ?? 0.14;
  const highlight = opts.highlight ?? 0.18;
  const cloudShadow = opts.cloudShadow ?? 0.28;
  const mossTop = opts.mossTop ?? 0;
  const windAmp = opts.wind?.amp ?? 0;
  const windFreq = opts.wind?.freq ?? 1.6;
  const windOffset = opts.wind?.heightOffset ?? 1.2;

  const key = opts.cacheKey ?? `cel_${windAmp > 0 ? 'w' : 's'}_${mossTop > 0 ? 'm' : 'n'}_${opts.flatShading ? 'f' : 'g'}`;
  mat.customProgramCacheKey = () => key;

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = celUniforms.uTime;
    shader.uniforms.uSunDir = celUniforms.uSunDir;
    shader.uniforms.uMoonDir = celUniforms.uMoonDir;
    shader.uniforms.uNightFactor = celUniforms.uNightFactor;
    shader.uniforms.uSkyHorizon = celUniforms.uSkyHorizon;
    shader.uniforms.uSunHaze = celUniforms.uSunHaze;
    shader.uniforms.uAerialBlue = celUniforms.uAerialBlue;
    shader.uniforms.uValleyMist = celUniforms.uValleyMist;
    shader.uniforms.uFogNear = celUniforms.uFogNear;
    shader.uniforms.uFogFar = celUniforms.uFogFar;
    shader.uniforms.uLitTint = celUniforms.uLitTint;
    shader.uniforms.uShadowMod = celUniforms.uShadowMod;
    shader.uniforms.uRimMod = celUniforms.uRimMod;
    shader.uniforms.uMatShadowTint = { value: shadowTint };
    shader.uniforms.uRimColor = { value: rimColor };
    shader.uniforms.uRimStrength = { value: rimStrength };
    shader.uniforms.uRimPower = { value: rimPower };
    shader.uniforms.uStepLow = { value: stepLow };
    shader.uniforms.uStepHigh = { value: stepHigh };
    shader.uniforms.uHighlight = { value: highlight };
    shader.uniforms.uCloudShadow = { value: cloudShadow };
    shader.uniforms.uMossTop = { value: mossTop };
    shader.uniforms.uWindAmp = { value: windAmp };
    shader.uniforms.uWindFreq = { value: windFreq };
    shader.uniforms.uWindOffset = { value: windOffset };

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `
        #include <common>
        uniform float uTime;
        uniform float uWindAmp;
        uniform float uWindFreq;
        uniform float uWindOffset;
        varying vec3 vCelWorldPos;
        varying vec3 vCelWorldNormal;
        `,
      )
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `
        #include <begin_vertex>
        vec4 celInstBase = vec4(0.0, 0.0, 0.0, 1.0);
        #ifdef USE_INSTANCING
          celInstBase = instanceMatrix * celInstBase;
        #endif
        vec3 celObjOrigin = (modelMatrix * celInstBase).xyz;
        if (uWindAmp > 0.0) {
          float hMask = smoothstep(uWindOffset, uWindOffset + 3.2, transformed.y);
          float phase = celObjOrigin.x * 0.14 + celObjOrigin.z * 0.11 + uTime * uWindFreq;
          float gust = sin(phase) * 0.65 + sin(phase * 2.1 + transformed.y * 0.7) * 0.35;
          transformed.x += gust * uWindAmp * hMask;
          transformed.z += cos(phase * 0.85) * uWindAmp * 0.55 * hMask;
        }
        `,
      )
      .replace(
        '#include <worldpos_vertex>',
        /* glsl */ `
        #include <worldpos_vertex>
        vec4 celWp = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          celWp = instanceMatrix * celWp;
        #endif
        celWp = modelMatrix * celWp;
        vCelWorldPos = celWp.xyz;

        vec3 celWn = objectNormal;
        #ifdef USE_INSTANCING
          celWn = mat3(instanceMatrix) * celWn;
        #endif
        vec3 celWnWorld = mat3(modelMatrix) * celWn;
        float celWnLenSq = dot(celWnWorld, celWnWorld);
        vCelWorldNormal = celWnLenSq > 1e-10 ? celWnWorld * inversesqrt(celWnLenSq) : vec3(0.0, 1.0, 0.0);
        `,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `
        #include <common>
        uniform float uTime;
        uniform vec3 uLitTint;
        uniform vec3 uShadowMod;
        uniform vec3 uRimMod;
        uniform vec3 uMatShadowTint;
        uniform vec3 uRimColor;
        uniform float uRimStrength;
        uniform float uRimPower;
        uniform float uStepLow;
        uniform float uStepHigh;
        uniform float uHighlight;
        uniform float uCloudShadow;
        uniform float uMossTop;
        varying vec3 vCelWorldPos;
        varying vec3 vCelWorldNormal;
        ${CEL_NOISE_GLSL}
        ${CEL_SAFE_MATH_GLSL}
        ${CEL_ATMOS_PARS_GLSL}
        `,
      )
      .replace(
        '#include <normal_fragment_begin>',
        /* glsl */ `
        float faceDirection = gl_FrontFacing ? 1.0 : -1.0;
        #ifdef FLAT_SHADED
          vec3 fdx = dFdx( vViewPosition );
          vec3 fdy = dFdy( vViewPosition );
          vec3 flatCross = cross( fdx, fdy );
          float flatLenSq = dot( flatCross, flatCross );
          vec3 normal = flatLenSq > 1e-12 ? flatCross * inversesqrt( flatLenSq ) : vec3( 0.0, 0.0, 1.0 );
        #else
          float vNormLenSq = dot( vNormal, vNormal );
          vec3 normal = vNormLenSq > 1e-12 ? vNormal * inversesqrt( vNormLenSq ) : vec3( 0.0, 0.0, 1.0 );
          #ifdef DOUBLE_SIDED
            normal *= faceDirection;
          #endif
        #endif
        vec3 nonPerturbedNormal = normal;
        `,
      )
      .replace(
        '#include <lights_lambert_pars_fragment>',
        /* glsl */ `
        varying vec3 vViewPosition;
        struct LambertMaterial {
          vec3 diffuseColor;
          float specularStrength;
        };
        void RE_Direct_Lambert(
          const in IncidentLight directLight,
          const in vec3 geometryPosition,
          const in vec3 geometryNormal,
          const in vec3 geometryViewDir,
          const in vec3 geometryClearcoatNormal,
          const in LambertMaterial material,
          inout ReflectedLight reflectedLight
        ) {
          float rawNdotL = dot(geometryNormal, directLight.direction);
          #if NUM_DIR_LIGHTS > 0
            float baseLum = max(dot(directionalLights[0].color, vec3(0.3333)), 0.001);
            float curLum = dot(directLight.color, vec3(0.3333));
            float shadowMask = clamp(curLum / baseLum, 0.0, 1.0);
          #else
            float shadowMask = 1.0;
          #endif

          // Crisp yet soft-edged watercolor cel bands
          float celBand = smoothstep(uStepLow, uStepHigh, rawNdotL);
          float celHi = smoothstep(0.56, 0.78, rawNdotL) * uHighlight;
          float castSh = smoothstep(0.24, 0.76, shadowMask);
          float cloudVal = mix(1.0, celCloudShadow(vCelWorldPos.xz, uTime), uCloudShadow * (1.0 - 0.5 * uNightFactor));
          float lit = celBand * castSh * cloudVal;

          vec3 wNorm = safeNormalize(vCelWorldNormal);
          float skyFacing = wNorm.y * 0.5 + 0.5;

          // Hue-shifted shadow & light adapting smoothly across Dawn / Day / Sunset / Night
          vec3 dynShadow = uMatShadowTint * uShadowMod;
          vec3 shadowCol = mix(dynShadow * 0.80, dynShadow * 1.15, skyFacing);
          vec3 litCol = uLitTint * (1.02 + celHi);
          vec3 shade = mix(shadowCol, litCol, lit);

          // Delicate BotW atmospheric rim light (warm gold at sunset, cool silver under moonlight)
          float ndotv = saturate(dot(geometryNormal, geometryViewDir));
          float rimGate = mix(0.22, 1.0, smoothstep(-0.20, 0.50, rawNdotL)) * mix(0.38, 1.0, castSh * cloudVal);
          float rim = safePow(1.0 - ndotv, uRimPower) * uRimStrength * rimGate;

          vec3 albedo = material.diffuseColor;
          if (uMossTop > 0.0) {
            float mossMask = smoothstep(0.60, 0.84, wNorm.y) * uMossTop;
            albedo = mix(albedo, vec3(0.14, 0.34, 0.08), mossMask);
          }

          vec3 rimTint = uRimColor * uRimMod;
          reflectedLight.directDiffuse += albedo * shade + rimTint * rim * (0.35 + 0.65 * albedo);
        }
        void RE_IndirectDiffuse_Lambert(
          const in vec3 irradiance,
          const in vec3 geometryPosition,
          const in vec3 geometryNormal,
          const in vec3 geometryViewDir,
          const in vec3 geometryClearcoatNormal,
          const in LambertMaterial material,
          inout ReflectedLight reflectedLight
        ) {
          reflectedLight.indirectDiffuse += irradiance * 0.028 * BRDF_Lambert(material.diffuseColor);
        }
        #define RE_Direct RE_Direct_Lambert
        #define RE_IndirectDiffuse RE_IndirectDiffuse_Lambert
        `,
      )
      .replace(
        '#include <opaque_fragment>',
        /* glsl */ `
        outgoingLight = applyBotwAtmosphere(outgoingLight, vCelWorldPos);
        #include <opaque_fragment>
        `,
      );
  };

  return mat;
}

// ------------------------------------------------------------ Painterly BotW Terrain Material

export function createTerrainMaterial(): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({
    color: '#ffffff',
    flatShading: false,
    fog: false,
  });
  mat.customProgramCacheKey = () => 'botw_terrain_v3';

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = celUniforms.uTime;
    shader.uniforms.uSunDir = celUniforms.uSunDir;
    shader.uniforms.uMoonDir = celUniforms.uMoonDir;
    shader.uniforms.uNightFactor = celUniforms.uNightFactor;
    shader.uniforms.uSkyHorizon = celUniforms.uSkyHorizon;
    shader.uniforms.uSunHaze = celUniforms.uSunHaze;
    shader.uniforms.uAerialBlue = celUniforms.uAerialBlue;
    shader.uniforms.uValleyMist = celUniforms.uValleyMist;
    shader.uniforms.uFogNear = celUniforms.uFogNear;
    shader.uniforms.uFogFar = celUniforms.uFogFar;
    shader.uniforms.uLitTint = celUniforms.uLitTint;
    shader.uniforms.uShadowTint = celUniforms.uShadowTint;
    shader.uniforms.uWaterLevel = { value: WATER_LEVEL };

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `
        #include <common>
        varying vec3 vCelWorldPos;
        varying vec3 vCelWorldNormal;
        `,
      )
      .replace(
        '#include <worldpos_vertex>',
        /* glsl */ `
        #include <worldpos_vertex>
        vec4 celWp = modelMatrix * vec4(transformed, 1.0);
        vCelWorldPos = celWp.xyz;
        vec3 celWnWorld = mat3(modelMatrix) * objectNormal;
        float celWnLenSq = dot(celWnWorld, celWnWorld);
        vCelWorldNormal = celWnLenSq > 1e-10 ? celWnWorld * inversesqrt(celWnLenSq) : vec3(0.0, 1.0, 0.0);
        `,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `
        #include <common>
        uniform float uTime;
        uniform float uWaterLevel;
        uniform vec3 uLitTint;
        uniform vec3 uShadowTint;
        varying vec3 vCelWorldPos;
        varying vec3 vCelWorldNormal;
        ${CEL_NOISE_GLSL}
        ${CEL_SAFE_MATH_GLSL}
        ${CEL_ATMOS_PARS_GLSL}
        `,
      )
      .replace(
        '#include <normal_fragment_begin>',
        /* glsl */ `
        float faceDirection = gl_FrontFacing ? 1.0 : -1.0;
        float vNormLenSq = dot( vNormal, vNormal );
        vec3 normal = vNormLenSq > 1e-12 ? vNormal * inversesqrt( vNormLenSq ) : vec3( 0.0, 0.0, 1.0 );
        vec3 nonPerturbedNormal = normal;
        `,
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `
        #include <color_fragment>
        {
          vec3 wPos = vCelWorldPos;
          vec3 wNrm = safeNormalize(vCelWorldNormal);
          float h = wPos.y;
          float ny = wNrm.y;

          float nLarge = celFbm(wPos.xz * 0.015);
          float nMed   = celNoise(wPos.xz * 0.062);
          float nFine  = celNoise(wPos.xz * 0.22);
          float brush  = (nMed - 0.5) * 0.11 + (nFine - 0.5) * 0.04;

          vec3 grassBright = vec3(0.205, 0.485, 0.068);
          vec3 grassRich   = vec3(0.088, 0.315, 0.062);
          vec3 grassGold   = vec3(0.320, 0.455, 0.082);
          vec3 alpineCol   = vec3(0.265, 0.365, 0.095);
          vec3 sandDry     = vec3(0.760, 0.630, 0.350);
          vec3 sandWet     = vec3(0.455, 0.365, 0.200);
          vec3 rockWarm    = vec3(0.370, 0.325, 0.260);
          vec3 rockCool    = vec3(0.235, 0.235, 0.245);
          vec3 snowCol     = vec3(0.860, 0.895, 0.935);

          vec3 grass = mix(grassRich, grassBright, smoothstep(0.30, 0.72, nLarge));
          grass = mix(grass, grassGold, smoothstep(0.56, 0.84, nMed) * 0.42);
          grass *= 0.94 + nFine * 0.12;

          float alpineMask = smoothstep(38.0, 54.0, h + (nLarge - 0.5) * 7.0);
          vec3 ground = mix(grass, alpineCol, alpineMask);

          float sandMask = smoothstep(uWaterLevel + 2.9, uWaterLevel + 0.5, h + (nMed - 0.5) * 1.4);
          float wetMask  = smoothstep(uWaterLevel + 0.80, uWaterLevel - 0.15, h);
          vec3 sand = mix(sandDry, sandWet, wetMask * 0.72);
          ground = mix(ground, sand, sandMask);

          float rockPatch = celFbm(vec2((wPos.x + wPos.z) * 0.032, h * 0.085));
          float ledgeHint = smoothstep(0.35, 0.68, celNoise(vec2((wPos.x - wPos.z) * 0.025, h * 0.22 + rockPatch * 2.2)));
          vec3 rock = mix(rockCool, rockWarm, smoothstep(0.32, 0.68, rockPatch));
          rock *= 0.88 + 0.22 * ledgeHint;

          float slopeVal = ny + brush * 0.45;
          float rockMask = smoothstep(0.77, 0.70, slopeVal);
          rockMask = max(rockMask, smoothstep(50.0, 68.0, h + (nLarge - 0.5) * 6.0) * smoothstep(0.90, 0.74, ny));
          vec3 surface = mix(ground, rock, rockMask);

          float snowMask = smoothstep(57.0, 65.0, h + (nLarge - 0.5) * 7.0) * smoothstep(0.67, 0.79, ny + brush * 0.35);
          surface = mix(surface, snowCol, snowMask);

          diffuseColor.rgb = surface;
        }
        `,
      )
      .replace(
        '#include <lights_lambert_pars_fragment>',
        /* glsl */ `
        varying vec3 vViewPosition;
        struct LambertMaterial {
          vec3 diffuseColor;
          float specularStrength;
        };
        void RE_Direct_Lambert(
          const in IncidentLight directLight,
          const in vec3 geometryPosition,
          const in vec3 geometryNormal,
          const in vec3 geometryViewDir,
          const in vec3 geometryClearcoatNormal,
          const in LambertMaterial material,
          inout ReflectedLight reflectedLight
        ) {
          float rawNdotL = dot(geometryNormal, directLight.direction);
          #if NUM_DIR_LIGHTS > 0
            float baseLum = max(dot(directionalLights[0].color, vec3(0.3333)), 0.001);
            float curLum = dot(directLight.color, vec3(0.3333));
            float shadowMask = clamp(curLum / baseLum, 0.0, 1.0);
          #else
            float shadowMask = 1.0;
          #endif

          float celMid = smoothstep(-0.02, 0.16, rawNdotL);
          float celHi  = smoothstep(0.54, 0.78, rawNdotL) * 0.14;
          float castSh = smoothstep(0.22, 0.76, shadowMask);
          float cloudVal = mix(1.0, celCloudShadow(vCelWorldPos.xz, uTime), 0.36 * (1.0 - 0.5 * uNightFactor));
          float lit = celMid * castSh * cloudVal;

          vec3 wNrm = safeNormalize(vCelWorldNormal);
          float skyFacing = wNrm.y * 0.5 + 0.5;
          vec3 shadowCol = mix(uShadowTint * 0.80, uShadowTint * 1.18, skyFacing);
          vec3 litCol = uLitTint * (1.02 + celHi);

          float ndotv = saturate(dot(geometryNormal, geometryViewDir));
          float ridgeRim = safePow(1.0 - ndotv, 3.4) * 0.18 * smoothstep(0.0, 0.5, rawNdotL) * castSh * cloudVal;

          reflectedLight.directDiffuse += material.diffuseColor * mix(shadowCol, litCol, lit) + uLitTint * ridgeRim * 0.30;
        }
        void RE_IndirectDiffuse_Lambert(
          const in vec3 irradiance,
          const in vec3 geometryPosition,
          const in vec3 geometryNormal,
          const in vec3 geometryViewDir,
          const in vec3 geometryClearcoatNormal,
          const in LambertMaterial material,
          inout ReflectedLight reflectedLight
        ) {
          reflectedLight.indirectDiffuse += irradiance * 0.028 * BRDF_Lambert(material.diffuseColor);
        }
        #define RE_Direct RE_Direct_Lambert
        #define RE_IndirectDiffuse RE_IndirectDiffuse_Lambert
        `,
      )
      .replace(
        '#include <opaque_fragment>',
        /* glsl */ `
        outgoingLight = applyBotwAtmosphere(outgoingLight, vCelWorldPos);
        #include <opaque_fragment>
        `,
      );
  };

  return mat;
}

// ------------------------------------------------------------ Stylized BotW Water

function buildShoreDepthTexture(terrain: Terrain): THREE.DataTexture {
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

export function createWaterMaterial(terrain: Terrain): THREE.ShaderMaterial {
  const depthTex = buildShoreDepthTexture(terrain);
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
      uLitTint: celUniforms.uLitTint,
      uFogNear: celUniforms.uFogNear,
      uFogFar: celUniforms.uFogFar,
      uDepthMap: { value: depthTex },
      uWaterLevel: { value: WATER_LEVEL },
      uWorldHalf: { value: HALF },
      uWorldSize: { value: WORLD_SIZE },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorldPos;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uSunsetFactor;
      uniform vec3 uLitTint;
      uniform sampler2D uDepthMap;
      uniform float uWaterLevel;
      uniform float uWorldHalf;
      uniform float uWorldSize;
      varying vec3 vWorldPos;
      ${CEL_NOISE_GLSL}
      ${CEL_SAFE_MATH_GLSL}
      ${CEL_ATMOS_PARS_GLSL}

      void main() {
        vec2 uv = (vWorldPos.xz + uWorldHalf) / uWorldSize;
        float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
        float texVal = texture2D(uDepthMap, clamp(uv, 0.0, 1.0)).r;
        float groundH = mix(uWaterLevel - 14.0, (uWaterLevel - 14.0) + texVal * 18.0, inside);
        float depth = max(0.0, uWaterLevel - groundH);

        vec3 toFrag = vWorldPos - cameraPosition;
        float dist = length(toFrag);
        vec3 viewDir = toFrag / max(dist, 0.0001);

        // Day -> Sunset -> Moonlit Night water palette
        vec3 colShallow = vec3(0.16, 0.70, 0.62);
        vec3 colMid     = vec3(0.05, 0.39, 0.64);
        vec3 colDeep    = vec3(0.03, 0.18, 0.44);

        float shallowT = smoothstep(0.15, 2.5, depth);
        float deepT    = smoothstep(2.2, 9.5, depth);
        vec3 waterCol  = mix(colShallow, colMid, shallowT);
        waterCol       = mix(waterCol, colDeep, deepT);

        // Adapt water color cleanly to sunset warmth & moonlit sapphire night
        waterCol *= mix(vec3(1.0), vec3(1.12, 0.86, 0.74), uSunsetFactor * 0.55);
        waterCol *= mix(vec3(1.0), vec3(0.26, 0.36, 0.58), uNightFactor);

        // Drifting stylized cel wave ribbons
        vec2 wUv1 = vWorldPos.xz * 0.22 + vec2(uTime * 0.24, uTime * 0.13);
        vec2 wUv2 = vWorldPos.xz * 0.15 - vec2(uTime * 0.16, uTime * 0.20);
        float r1 = celNoise(wUv1);
        float r2 = celNoise(wUv2 + r1 * 0.85);
        float ripple = smoothstep(0.64, 0.74, r2) * smoothstep(240.0, 35.0, dist);
        vec3 rippleCol = mix(vec3(0.55, 0.92, 0.95), vec3(0.42, 0.64, 0.92), uNightFactor);
        rippleCol = mix(rippleCol, vec3(1.0, 0.80, 0.56), uSunsetFactor * 0.5);
        waterCol = mix(waterCol, rippleCol, ripple * 0.24);

        // Cloud shadows drifting on the water
        float cSh = mix(0.84, 1.0, celCloudShadow(vWorldPos.xz, uTime));
        waterCol *= mix(cSh, 1.0, uNightFactor * 0.6);

        // Animated shoreline foam contours
        float shoreNoise = celNoise(vWorldPos.xz * 0.26 + vec2(uTime * 0.16, -uTime * 0.11));
        float waveLap = sin(depth * 5.2 - uTime * 2.1 + shoreNoise * 3.6);
        float innerFoam = smoothstep(0.56, 0.05, depth + (shoreNoise - 0.5) * 0.34);
        float outerRing = smoothstep(0.56, 0.82, waveLap) * smoothstep(2.0, 0.45, depth) * smoothstep(0.06, 0.36, depth);
        float foam = clamp(innerFoam * 0.94 + outerRing * 0.65, 0.0, 1.0) * inside;
        foam *= smoothstep(340.0, 95.0, dist);

        // Crisp HDR sun/moon specular sparkles (catches Selective Soft Bloom!)
        vec3 waveN = safeNormalize(vec3((r1 - 0.5) * 0.24, 1.0, (r2 - 0.5) * 0.24));
        vec3 glintDir = safeNormalize(mix(uSunDir, uMoonDir, step(0.5, uNightFactor)));
        vec3 halfV = safeNormalize(glintDir - viewDir);
        float spec = safePow(clamp(dot(waveN, halfV), 0.0, 1.0), 85.0);
        float celSpec = smoothstep(0.30, 0.54, spec) * cSh;
        vec3 glintCol = mix(uSunHaze * 1.45, vec3(0.85, 1.15, 1.55), uNightFactor);
        waterCol += glintCol * celSpec;

        // Grazing Fresnel sky reflection
        float fresnelBase = clamp(1.0 - clamp(-viewDir.y, 0.0, 1.0), 0.0, 1.0);
        float fresnel = fresnelBase * fresnelBase * fresnelBase;
        vec3 skyRefl = mix(uAerialBlue, uSkyHorizon, 0.52);
        waterCol = mix(waterCol, skyRefl, fresnel * 0.44);

        // Composite shoreline foam tinted softly by time of day
        vec3 foamCol = mix(vec3(0.92, 0.96, 0.98), vec3(0.98, 0.86, 0.72), uSunsetFactor * 0.6);
        foamCol = mix(foamCol, vec3(0.55, 0.72, 0.92), uNightFactor);
        waterCol = mix(waterCol, foamCol, foam);

        float alpha = mix(0.56, 1.0, smoothstep(0.0, 4.5, depth));
        alpha = max(alpha, foam * 0.97);
        alpha = mix(alpha, 1.0, smoothstep(90.0, 220.0, dist));

        waterCol = applyBotwAtmosphere(waterCol, vWorldPos);

        gl_FragColor = vec4(waterCol, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}

// ------------------------------------------------------------ Painterly Cel Cloud Material

export function createCloudMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    fog: false,
    uniforms: {
      uSunDir: celUniforms.uSunDir,
      uMoonDir: celUniforms.uMoonDir,
      uNightFactor: celUniforms.uNightFactor,
      uSkyHorizon: celUniforms.uSkyHorizon,
      uSunHaze: celUniforms.uSunHaze,
      uCloudTop: celUniforms.uCloudTop,
      uCloudBottom: celUniforms.uCloudBottom,
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        vec3 wn = mat3(modelMatrix) * normal;
        float wnLenSq = dot(wn, wn);
        vWorldNormal = wnLenSq > 1e-10 ? wn * inversesqrt(wnLenSq) : vec3(0.0, 1.0, 0.0);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uSunDir;
      uniform vec3 uMoonDir;
      uniform float uNightFactor;
      uniform vec3 uSkyHorizon;
      uniform vec3 uSunHaze;
      uniform vec3 uCloudTop;
      uniform vec3 uCloudBottom;
      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;
      ${CEL_SAFE_MATH_GLSL}

      void main() {
        vec3 n = safeNormalize(vWorldNormal);
        vec3 toFrag = vWorldPos - cameraPosition;
        float dist = length(toFrag);
        vec3 viewDir = toFrag / max(dist, 0.0001);
        vec3 v = -viewDir;
        vec3 lDir = safeNormalize(mix(uSunDir, uMoonDir, uNightFactor));
        float ndotl = dot(n, lDir);
        float up = n.y * 0.5 + 0.5;

        // Watercolor cel cloud adapting across Dawn, Day, Sunset & Moonlit Night
        float cel = smoothstep(-0.14, 0.26, ndotl * 0.62 + (up - 0.5) * 0.72);
        vec3 underside = mix(uCloudBottom * 0.85, uCloudBottom * 1.12, up);
        vec3 crown = uCloudTop * 0.94; // stays just below bloom threshold so clouds remain crisp
        vec3 col = mix(underside, crown, cel);

        // Silver-lining / sunset gold rim toward sun or moon
        float ndotv = clamp(dot(n, v), 0.0, 1.0);
        float rim = safePow(1.0 - ndotv, 2.3);
        float sunSide = smoothstep(-0.1, 0.7, dot(viewDir, lDir));
        col += uSunHaze * rim * (0.14 + 0.30 * sunSide);

        float farFade = smoothstep(580.0, 260.0, dist);
        col = mix(uSkyHorizon, col, smoothstep(660.0, 340.0, dist));

        gl_FragColor = vec4(col, 0.93 * farFade);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}

// ------------------------------------------------------------ Ultra-Subtle Rim Outline (Style 1)

export function createSubtleOutlineMaterial(thickness = 0.02, color = '#2a334a'): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    transparent: true,
    depthWrite: true,
    fog: false,
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uThickness: { value: thickness },
      uSunDir: celUniforms.uSunDir,
      uMoonDir: celUniforms.uMoonDir,
      uNightFactor: celUniforms.uNightFactor,
      uSkyHorizon: celUniforms.uSkyHorizon,
      uSunHaze: celUniforms.uSunHaze,
      uAerialBlue: celUniforms.uAerialBlue,
      uValleyMist: celUniforms.uValleyMist,
      uFogNear: celUniforms.uFogNear,
      uFogFar: celUniforms.uFogFar,
    },
    vertexShader: /* glsl */ `
      uniform float uThickness;
      varying vec3 vWorldPos;
      varying float vDist;
      void main() {
        vec4 wp0 = modelMatrix * vec4(position, 1.0);
        vDist = length(wp0.xyz - cameraPosition);
        float t = uThickness * clamp(vDist * 0.085, 0.65, 1.4);
        float nLenSq = dot(normal, normal);
        vec3 nDir = nLenSq > 1e-10 ? normal * inversesqrt(nLenSq) : vec3(0.0, 1.0, 0.0);
        vec3 extruded = position + nDir * t;
        vec4 wp = modelMatrix * vec4(extruded, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying vec3 vWorldPos;
      varying float vDist;
      ${CEL_SAFE_MATH_GLSL}
      ${CEL_ATMOS_PARS_GLSL}
      void main() {
        float alpha = 0.48 * smoothstep(38.0, 12.0, vDist);
        if (alpha < 0.02) discard;
        vec3 col = applyBotwAtmosphere(uColor, vWorldPos);
        gl_FragColor = vec4(col, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}

// ------------------------------------------------------------ Wind-Swept Grass & Wildflower Material

export function createGrassMaterial(isFlower = false): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    fog: false,
    uniforms: {
      uTime: celUniforms.uTime,
      uSunDir: celUniforms.uSunDir,
      uMoonDir: celUniforms.uMoonDir,
      uNightFactor: celUniforms.uNightFactor,
      uSkyHorizon: celUniforms.uSkyHorizon,
      uSunHaze: celUniforms.uSunHaze,
      uAerialBlue: celUniforms.uAerialBlue,
      uValleyMist: celUniforms.uValleyMist,
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
          vInstColor = vec3(0.20, 0.48, 0.07);
        #endif

        vec4 baseWp = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float dist = length(baseWp.xyz - cameraPosition);
        float distScale = smoothstep(42.0, 26.0, dist);
        vec3 p = position * distScale;

        float gust = celNoise(baseWp.xz * 0.042 - vec2(uTime * 0.65, uTime * 0.34));
        float flutter = sin(uTime * 3.1 + baseWp.x * 0.55 + baseWp.z * 0.42) * 0.5 + 0.5;
        float bend = (gust * 0.38 + flutter * 0.12) * vTip * vTip * distScale;
        vGust = gust;

        vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
        wp.x += bend * 0.85;
        wp.z += bend * 0.48;
        wp.y -= bend * 0.16;

        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
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
        vec3 col;
        if (uIsFlower > 0.5) {
          col = vInstColor * mix(0.84, 1.06, vTip);
        } else {
          vec3 rootCol = vInstColor * 0.64;
          vec3 tipCol  = vInstColor * 1.24 + vec3(0.04, 0.07, 0.005);
          col = mix(rootCol, tipCol, smoothstep(0.0, 0.90, vTip));
          float shimmer = smoothstep(0.50, 0.82, vGust) * vTip * (1.0 - 0.65 * uNightFactor);
          col += vec3(0.09, 0.12, 0.015) * shimmer;
        }

        float cloudVal = mix(0.55, 1.0, celCloudShadow(vWorldPos.xz, uTime));
        vec3 shade = mix(uShadowTint * 1.10, uLitTint * 1.02, mix(cloudVal, 0.85, uNightFactor));
        col *= shade;

        col = applyBotwAtmosphere(col, vWorldPos);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}
