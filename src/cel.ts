import * as THREE from 'three';
import { HALF, SEG, WATER_LEVEL, WORLD_SIZE, type Terrain } from './terrain';
import { BIOMES, BIOME_COUNT } from './biomes';

/**
 * Watercolor / anime cel-shading palette & uniforms.
 * Supports a full smooth day/night cycle (Dawn -> Day -> Sunset -> Twilight -> Moonlit Night)
 * plus seamless per-biome atmosphere blending (fog range, mist tint, light/shadow hue).
 */
export const CEL_PALETTE = {
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

const DAY_SHADOW_BASE = CEL_PALETTE.shadowTint.clone();
const DAY_RIM_BASE = CEL_PALETTE.rimColor.clone();

export const celUniforms = {
  uTime: { value: 0 },
  uSunDir: { value: new THREE.Vector3(0.48, 0.58, 0.36).normalize() },
  uMoonDir: { value: new THREE.Vector3(-0.48, -0.58, -0.36).normalize() },
  uNightFactor: { value: 0.0 },
  uSunsetFactor: { value: 0.0 },
  uSkyZenith: { value: CEL_PALETTE.skyZenith.clone() },
  uSkyMid: { value: CEL_PALETTE.skyMid.clone() },
  uSkyHorizon: { value: CEL_PALETTE.skyHorizon.clone() },
  uSunHaze: { value: CEL_PALETTE.sunHaze.clone() },
  uAerialBlue: { value: CEL_PALETTE.aerialBlue.clone() },
  uValleyMist: { value: CEL_PALETTE.valleyMist.clone() },
  uValleyMistBoost: { value: 0.22 },
  uShadowTint: { value: CEL_PALETTE.shadowTint.clone() },
  uShadowMod: { value: new THREE.Vector3(1, 1, 1) },
  uLitTint: { value: CEL_PALETTE.litTint.clone() },
  uRimMod: { value: new THREE.Vector3(1, 1, 1) },
  uCloudTop: { value: CEL_PALETTE.cloudTop.clone() },
  uCloudBottom: { value: CEL_PALETTE.cloudBottom.clone() },
  uFogNear: { value: 105.0 },
  uFogFar: { value: 560.0 },
};

// Base day/night colors before regional biome tinting (prevents drift when both update each frame)
const _baseAerialBlue = CEL_PALETTE.aerialBlue.clone();
const _baseValleyMist = CEL_PALETTE.valleyMist.clone();
const _baseShadowTint = CEL_PALETTE.shadowTint.clone();
const _baseLitTint = CEL_PALETTE.litTint.clone();

// Smoothed biome atmosphere state
const _bioFogTint = new THREE.Color('#8ec3e8');
const _bioMistTint = new THREE.Color('#e2f2f1');
const _bioLitTint = new THREE.Color('#fff9eb');
const _bioShadowTint = new THREE.Color('#4f6fa3');
let _bioFogAmt = 0;
let _bioLitAmt = 0;
let _bioShadowAmt = 0;
let _bioFogNear = 108;
let _bioFogFar = 560;
let _bioMistBoost = 0.22;

const _tFogTint = new THREE.Color();
const _tMistTint = new THREE.Color();
const _tLitTint = new THREE.Color();
const _tShadowTint = new THREE.Color();

export function updateCelTime(t: number) {
  celUniforms.uTime.value = t;
}

/**
 * Smoothly blends regional atmosphere (fog distance, mist density, and subtle
 * light/shadow color tint) according to the player's current biome weights.
 */
export function updateBiomeAtmosphere(weights: Float32Array, dt: number, immediate = false) {
  let targetNear = 0;
  let targetFar = 0;
  let targetFogAmt = 0;
  let targetMistBoost = 0;
  let targetLitAmt = 0;
  let targetShadowAmt = 0;
  _tFogTint.setRGB(0, 0, 0);
  _tMistTint.setRGB(0, 0, 0);
  _tLitTint.setRGB(0, 0, 0);
  _tShadowTint.setRGB(0, 0, 0);

  for (let i = 0; i < BIOME_COUNT; i++) {
    const w = weights[i];
    if (w <= 0.0001) continue;
    const b = BIOMES[i];
    targetNear += b.fogNear * w;
    targetFar += b.fogFar * w;
    targetFogAmt += b.fogTintAmt * w;
    targetMistBoost += b.valleyMistBoost * w;
    targetLitAmt += b.litTintAmt * w;
    targetShadowAmt += b.shadowTintAmt * w;
    _tFogTint.r += b.fogTint.r * w;
    _tFogTint.g += b.fogTint.g * w;
    _tFogTint.b += b.fogTint.b * w;
    _tMistTint.r += b.valleyMistTint.r * w;
    _tMistTint.g += b.valleyMistTint.g * w;
    _tMistTint.b += b.valleyMistTint.b * w;
    _tLitTint.r += b.litTint.r * w;
    _tLitTint.g += b.litTint.g * w;
    _tLitTint.b += b.litTint.b * w;
    _tShadowTint.r += b.shadowTint.r * w;
    _tShadowTint.g += b.shadowTint.g * w;
    _tShadowTint.b += b.shadowTint.b * w;
  }

  const k = immediate ? 1 : Math.min(1, dt * 1.45);
  _bioFogNear += (targetNear - _bioFogNear) * k;
  _bioFogFar += (targetFar - _bioFogFar) * k;
  _bioFogAmt += (targetFogAmt - _bioFogAmt) * k;
  _bioMistBoost += (targetMistBoost - _bioMistBoost) * k;
  _bioLitAmt += (targetLitAmt - _bioLitAmt) * k;
  _bioShadowAmt += (targetShadowAmt - _bioShadowAmt) * k;
  _bioFogTint.lerp(_tFogTint, k);
  _bioMistTint.lerp(_tMistTint, k);
  _bioLitTint.lerp(_tLitTint, k);
  _bioShadowTint.lerp(_tShadowTint, k);

  composeAtmosphereUniforms();
}

function composeAtmosphereUniforms() {
  const night = celUniforms.uNightFactor.value;
  const sunset = celUniforms.uSunsetFactor.value;
  // Soften daylight biome tints at night/sunset so moonlit and golden-hour harmony stays rich
  const dayWeight = 1 - night * 0.62;
  const lightWeight = 1 - Math.max(night * 0.68, sunset * 0.45);

  celUniforms.uFogNear.value = _bioFogNear;
  celUniforms.uFogFar.value = _bioFogFar;
  celUniforms.uValleyMistBoost.value = _bioMistBoost * (1 - night * 0.25);

  // Night darkens regional fog tint gracefully toward deep twilight-indigo
  const fogTargetR = _bioFogTint.r * (1 - night * 0.68);
  const fogTargetG = _bioFogTint.g * (1 - night * 0.60);
  const fogTargetB = _bioFogTint.b * (1 - night * 0.48);
  celUniforms.uAerialBlue.value.setRGB(
    _baseAerialBlue.r + (fogTargetR - _baseAerialBlue.r) * _bioFogAmt,
    _baseAerialBlue.g + (fogTargetG - _baseAerialBlue.g) * _bioFogAmt,
    _baseAerialBlue.b + (fogTargetB - _baseAerialBlue.b) * _bioFogAmt,
  );

  const mistTargetR = _bioMistTint.r * (1 - night * 0.72);
  const mistTargetG = _bioMistTint.g * (1 - night * 0.62);
  const mistTargetB = _bioMistTint.b * (1 - night * 0.50);
  celUniforms.uValleyMist.value.setRGB(
    _baseValleyMist.r + (mistTargetR - _baseValleyMist.r) * (_bioFogAmt * 0.9 + 0.15),
    _baseValleyMist.g + (mistTargetG - _baseValleyMist.g) * (_bioFogAmt * 0.9 + 0.15),
    _baseValleyMist.b + (mistTargetB - _baseValleyMist.b) * (_bioFogAmt * 0.9 + 0.15),
  );

  celUniforms.uLitTint.value.copy(_baseLitTint).lerp(_bioLitTint, _bioLitAmt * lightWeight);
  celUniforms.uShadowTint.value.copy(_baseShadowTint).lerp(_bioShadowTint, _bioShadowAmt * dayWeight);
  celUniforms.uShadowMod.value.set(
    celUniforms.uShadowTint.value.r / Math.max(DAY_SHADOW_BASE.r, 0.01),
    celUniforms.uShadowTint.value.g / Math.max(DAY_SHADOW_BASE.g, 0.01),
    celUniforms.uShadowTint.value.b / Math.max(DAY_SHADOW_BASE.b, 0.01),
  );
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
  // 0.36 Bright sunlit morning-day (晴晝 — primary daytime look)
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
 * Updates all shared cel-shading, sky, cloud, water, and fog uniforms for a given
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
  _baseAerialBlue.copy(a.aerialBlue).lerp(b.aerialBlue, k);
  _baseValleyMist.copy(a.valleyMist).lerp(b.valleyMist, k);
  _baseShadowTint.copy(a.shadowTint).lerp(b.shadowTint, k);
  _baseLitTint.copy(a.litTint).lerp(b.litTint, k);
  celUniforms.uCloudTop.value.copy(a.cloudTop).lerp(b.cloudTop, k);
  celUniforms.uCloudBottom.value.copy(a.cloudBottom).lerp(b.cloudBottom, k);

  _tmpRim.copy(a.rimColor).lerp(b.rimColor, k);
  celUniforms.uRimMod.value.set(
    _tmpRim.r / Math.max(DAY_RIM_BASE.r, 0.01),
    _tmpRim.g / Math.max(DAY_RIM_BASE.g, 0.01),
    _tmpRim.b / Math.max(DAY_RIM_BASE.b, 0.01),
  );

  const night = a.night + (b.night - a.night) * k;
  const sunset = a.sunset + (b.sunset - a.sunset) * k;
  celUniforms.uNightFactor.value = night;
  celUniforms.uSunsetFactor.value = sunset;

  composeAtmosphereUniforms();

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
  _state.bloomStrength = 0.30 + sunset * 0.10 + night * 0.16;

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
uniform float uValleyMistBoost;
uniform float uFogNear;
uniform float uFogFar;

vec3 applyCelAtmosphere(vec3 col, vec3 worldPos) {
  vec3 toFrag = worldPos - cameraPosition;
  float dist = length(toFrag);
  vec3 viewDir = toFrag / max(dist, 0.0001);

  vec3 scatterDir = safeNormalize(mix(uSunDir, uMoonDir, uNightFactor));
  float sd = clamp(dot(viewDir, scatterDir), 0.0, 1.0);
  float sd2 = sd * sd;
  float sunScatter = sd2 * sd2;
  float horizonLift = smoothstep(0.28, -0.05, viewDir.y);

  // Aerial perspective: near & mid stay vivid; distant ridges layer into biome-tinted mist
  vec3 farColor = mix(uAerialBlue, uSkyHorizon, 0.34 + 0.30 * horizonLift);
  farColor = mix(farColor, uSunHaze, sunScatter * (0.48 - 0.18 * uNightFactor));

  float distFactor = smoothstep(uFogNear, uFogFar, dist);
  distFactor = safePow(distFactor, 1.15);
  col = mix(col, farColor, distFactor * 0.88);

  // Delicate valley mountain mist (山嵐) settling in lowlands, lagoons, & misty woods
  float lowMask = smoothstep(28.0, 1.5, worldPos.y);
  float mistDist = smoothstep(42.0, 210.0, dist);
  float valleyAmt = clamp(lowMask * mistDist * uValleyMistBoost, 0.0, 0.56);
  vec3 mistCol = mix(uValleyMist, uSunHaze, sunScatter * 0.28);
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
 * Creates a watercolor-cel material built on MeshLambertMaterial
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

  const shadowTint = opts.shadowTint ? new THREE.Color(opts.shadowTint) : CEL_PALETTE.shadowTint.clone();
  const rimColor = opts.rimColor ? new THREE.Color(opts.rimColor) : CEL_PALETTE.rimColor.clone();
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
    shader.uniforms.uValleyMistBoost = celUniforms.uValleyMistBoost;
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

          // Delicate atmospheric rim light (warm gold at sunset, cool silver under moonlight)
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
        outgoingLight = applyCelAtmosphere(outgoingLight, vCelWorldPos);
        #include <opaque_fragment>
        `,
      );
  };

  return mat;
}

// ------------------------------------------------------------ Biome Lookup Textures

const biomeTexCache = new WeakMap<Terrain, { texA: THREE.DataTexture; texB: THREE.DataTexture }>();

export function getBiomeTextures(terrain: Terrain): { texA: THREE.DataTexture; texB: THREE.DataTexture } {
  const existing = biomeTexCache.get(terrain);
  if (existing) return existing;

  const N = SEG + 1;
  const dataA = new Uint8Array(N * N * 4);
  const dataB = new Uint8Array(N * N * 4);
  const bw = terrain.biomeWeights;

  for (let i = 0; i < N * N; i++) {
    const off = i * BIOME_COUNT;
    const p = i * 4;
    dataA[p] = Math.round(bw[off] * 255);     // meadow
    dataA[p + 1] = Math.round(bw[off + 1] * 255); // karst
    dataA[p + 2] = Math.round(bw[off + 2] * 255); // canyon
    dataA[p + 3] = Math.round(bw[off + 3] * 255); // maple
    dataB[p] = Math.round(bw[off + 4] * 255);     // mistwood
    dataB[p + 1] = Math.round(bw[off + 5] * 255); // snow
    dataB[p + 2] = 0;
    dataB[p + 3] = 255;
  }

  const mk = (buf: Uint8Array) => {
    const tex = new THREE.DataTexture(buf, N, N, THREE.RGBAFormat);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    return tex;
  };
  const pair = { texA: mk(dataA), texB: mk(dataB) };
  biomeTexCache.set(terrain, pair);
  return pair;
}

// ------------------------------------------------------------ Painterly Multi-Biome Terrain Material

export function createTerrainMaterial(terrain: Terrain): THREE.MeshLambertMaterial {
  const { texA, texB } = getBiomeTextures(terrain);
  const mat = new THREE.MeshLambertMaterial({
    color: '#ffffff',
    flatShading: false,
    fog: false,
  });
  mat.customProgramCacheKey = () => 'cel_terrain_biome_v4';

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = celUniforms.uTime;
    shader.uniforms.uSunDir = celUniforms.uSunDir;
    shader.uniforms.uMoonDir = celUniforms.uMoonDir;
    shader.uniforms.uNightFactor = celUniforms.uNightFactor;
    shader.uniforms.uSkyHorizon = celUniforms.uSkyHorizon;
    shader.uniforms.uSunHaze = celUniforms.uSunHaze;
    shader.uniforms.uAerialBlue = celUniforms.uAerialBlue;
    shader.uniforms.uValleyMist = celUniforms.uValleyMist;
    shader.uniforms.uValleyMistBoost = celUniforms.uValleyMistBoost;
    shader.uniforms.uFogNear = celUniforms.uFogNear;
    shader.uniforms.uFogFar = celUniforms.uFogFar;
    shader.uniforms.uLitTint = celUniforms.uLitTint;
    shader.uniforms.uShadowTint = celUniforms.uShadowTint;
    shader.uniforms.uWaterLevel = { value: WATER_LEVEL };
    shader.uniforms.uWorldHalf = { value: HALF };
    shader.uniforms.uWorldSize = { value: WORLD_SIZE };
    shader.uniforms.uBiomeA = { value: texA };
    shader.uniforms.uBiomeB = { value: texB };

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
        uniform float uWorldHalf;
        uniform float uWorldSize;
        uniform sampler2D uBiomeA;
        uniform sampler2D uBiomeB;
        uniform vec3 uLitTint;
        uniform vec3 uShadowTint;
        varying vec3 vCelWorldPos;
        varying vec3 vCelWorldNormal;
        float gMistGlow = 0.0;
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

          vec2 buv = clamp((wPos.xz + uWorldHalf) / uWorldSize, 0.0, 1.0);
          vec4 wA = texture2D(uBiomeA, buv);
          vec4 wB = texture2D(uBiomeB, buv);
          float wMeadow   = wA.r;
          float wKarst    = wA.g;
          float wCanyon   = wA.b;
          float wMaple    = wA.a;
          float wMistwood = wB.r;
          float wSnow     = wB.g;
          float wSum = max(0.001, wMeadow + wKarst + wCanyon + wMaple + wMistwood + wSnow);
          wMeadow /= wSum; wKarst /= wSum; wCanyon /= wSum;
          wMaple /= wSum; wMistwood /= wSum; wSnow /= wSum;

          float nLarge = celFbm(wPos.xz * 0.015);
          float nMed   = celNoise(wPos.xz * 0.062);
          float nFine  = celNoise(wPos.xz * 0.22);
          float brush  = (nMed - 0.5) * 0.11 + (nFine - 0.5) * 0.04;

          // --- Ground palettes per biome (linear color space for vivid watercolor richness) ---
          // 0: Meadow (sunlit emerald + golden pasture)
          vec3 gMeadow = mix(vec3(0.088, 0.315, 0.062), vec3(0.205, 0.485, 0.068), smoothstep(0.30, 0.72, nLarge));
          gMeadow = mix(gMeadow, vec3(0.320, 0.455, 0.082), smoothstep(0.56, 0.84, nMed) * 0.40);

          // 1: Karst (lush jade-emerald moss on pillar crowns & turquoise lagoon banks)
          vec3 gKarst = mix(vec3(0.048, 0.290, 0.145), vec3(0.115, 0.430, 0.215), smoothstep(0.28, 0.74, nLarge));
          gKarst = mix(gKarst, vec3(0.200, 0.460, 0.275), smoothstep(0.60, 0.86, nMed) * 0.35);

          // 2: Red Canyon (sun-baked ochre terracotta & dry dusty clay)
          vec3 gCanyon = mix(vec3(0.465, 0.175, 0.062), vec3(0.640, 0.295, 0.105), smoothstep(0.26, 0.74, nLarge));
          gCanyon = mix(gCanyon, vec3(0.720, 0.445, 0.175), smoothstep(0.58, 0.85, nMed) * 0.48);

          // 3: South Maple Lake (autumn olive-gold meadow dappled with fallen crimson & amber leaves)
          vec3 gMaple = mix(vec3(0.185, 0.295, 0.072), vec3(0.355, 0.340, 0.085), smoothstep(0.28, 0.72, nLarge));
          float leafPatch = smoothstep(0.54, 0.80, nMed);
          vec3 leafCol = mix(vec3(0.560, 0.125, 0.048), vec3(0.660, 0.310, 0.060), nFine);
          gMaple = mix(gMaple, leafCol, leafPatch * 0.56);

          // 4: Mistwood (deep mossy blue-green pine/fern carpet)
          vec3 gMist = mix(vec3(0.028, 0.145, 0.115), vec3(0.068, 0.245, 0.170), smoothstep(0.26, 0.75, nLarge));
          gMist = mix(gMist, vec3(0.095, 0.285, 0.205), smoothstep(0.62, 0.86, nMed) * 0.35);

          // 5: Northern Snowfield (frosted alpine tundra transitioning quickly into snow)
          vec3 gSnow = mix(vec3(0.560, 0.665, 0.755), vec3(0.840, 0.895, 0.945), smoothstep(0.25, 0.72, nLarge));

          vec3 ground = gMeadow * wMeadow + gKarst * wKarst + gCanyon * wCanyon
                      + gMaple * wMaple + gMist * wMistwood + gSnow * wSnow;
          ground *= 0.94 + nFine * 0.12;

          // Gentle high-altitude alpine shift in non-canyon / non-snow areas
          float alpineMask = smoothstep(38.0, 54.0, h + (nLarge - 0.5) * 7.0) * (1.0 - wCanyon - wSnow);
          ground = mix(ground, vec3(0.265, 0.365, 0.095), alpineMask * 0.65);

          // --- Shoreline / sand palettes per biome ---
          vec3 sandDry = vec3(0.760, 0.630, 0.350) * (wMeadow + wMaple)
                       + vec3(0.680, 0.720, 0.640) * wKarst
                       + vec3(0.740, 0.440, 0.200) * wCanyon
                       + vec3(0.250, 0.340, 0.310) * wMistwood
                       + vec3(0.720, 0.800, 0.880) * wSnow;
          vec3 sandWet = sandDry * 0.58;
          float sandMask = smoothstep(uWaterLevel + 2.8, uWaterLevel + 0.45, h + (nMed - 0.5) * 1.4);
          float wetMask  = smoothstep(uWaterLevel + 0.80, uWaterLevel - 0.15, h);
          vec3 sand = mix(sandDry, sandWet, wetMask * 0.72);
          ground = mix(ground, sand, sandMask);

          // --- Cliff / Rock palettes per biome ---
          float rockPatch = celFbm(vec2((wPos.x + wPos.z) * 0.032, h * 0.085));
          float strata = 0.5 + 0.5 * sin(h * 0.95 + rockPatch * 3.4);
          float ledgeHint = smoothstep(0.35, 0.68, celNoise(vec2((wPos.x - wPos.z) * 0.025, h * 0.22 + rockPatch * 2.2)));

          vec3 rMeadow = mix(vec3(0.235, 0.235, 0.245), vec3(0.370, 0.325, 0.260), smoothstep(0.32, 0.68, rockPatch));
          // Pale weathered jade-limestone with horizontal karst ledges
          vec3 rKarst  = mix(vec3(0.255, 0.335, 0.320), vec3(0.540, 0.585, 0.545), smoothstep(0.26, 0.74, rockPatch * 0.7 + strata * 0.3));
          // Vivid stratified red/ochre sandstone canyon walls
          vec3 rCanyon = mix(vec3(0.365, 0.095, 0.042), vec3(0.655, 0.235, 0.088), smoothstep(0.22, 0.78, strata));
          rCanyon = mix(rCanyon, vec3(0.760, 0.405, 0.150), smoothstep(0.66, 0.92, strata) * 0.55);
          vec3 rMaple  = mix(vec3(0.250, 0.215, 0.185), vec3(0.410, 0.320, 0.235), smoothstep(0.30, 0.70, rockPatch));
          vec3 rMist   = mix(vec3(0.095, 0.155, 0.165), vec3(0.185, 0.260, 0.250), smoothstep(0.30, 0.70, rockPatch));
          vec3 rSnow   = mix(vec3(0.175, 0.245, 0.345), vec3(0.325, 0.405, 0.505), smoothstep(0.28, 0.72, rockPatch));

          vec3 rock = rMeadow * wMeadow + rKarst * wKarst + rCanyon * wCanyon
                    + rMaple * wMaple + rMist * wMistwood + rSnow * wSnow;
          rock *= 0.88 + 0.22 * ledgeHint;

          // Canyon & Karst show rock faces slightly earlier on steep slopes for sculptural crispness
          float slopeThresh = 0.77 + (wCanyon * 0.04 + wKarst * 0.03);
          float slopeVal = ny + brush * 0.45;
          float rockMask = smoothstep(slopeThresh, slopeThresh - 0.08, slopeVal);
          rockMask = max(rockMask, smoothstep(52.0, 68.0, h + (nLarge - 0.5) * 6.0) * smoothstep(0.90, 0.74, ny) * (1.0 - wCanyon * 0.5));
          vec3 surface = mix(ground, rock, rockMask);

          // Regional snowline: drops dramatically to ~17m in Northern Snowfield, stays high (~58m) elsewhere
          float snowLine = mix(58.0, 16.0, smoothstep(0.15, 0.75, wSnow));
          float snowSlope = mix(0.68, 0.54, wSnow);
          float snowMask = smoothstep(snowLine - 4.0, snowLine + 5.0, h + (nLarge - 0.5) * 7.0)
                         * smoothstep(snowSlope, snowSlope + 0.14, ny + brush * 0.35)
                         * (1.0 - wCanyon * 0.85);
          vec3 snowCol = mix(vec3(0.840, 0.895, 0.945), vec3(0.920, 0.955, 0.990), wSnow * 0.6);
          surface = mix(surface, snowCol, snowMask);

          // Delicate nocturnal bioluminescent moss veins on the Mistwood floor
          float mossGlowNoise = smoothstep(0.72, 0.90, celNoise(wPos.xz * 0.16 + nLarge * 1.8));
          gMistGlow = wMistwood * mossGlowNoise * smoothstep(0.72, 0.90, ny) * smoothstep(uWaterLevel + 2.0, uWaterLevel + 6.0, h) * uNightFactor;

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
        outgoingLight += vec3(0.20, 0.82, 0.72) * gMistGlow * 0.55;
        outgoingLight = applyCelAtmosphere(outgoingLight, vCelWorldPos);
        #include <opaque_fragment>
        `,
      );
  };

  return mat;
}

// ------------------------------------------------------------ Stylized Cel Water (Biome-Aware)

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
      uniform sampler2D uBiomeA;
      uniform sampler2D uBiomeB;
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
        vec2 cuv = clamp(uv, 0.0, 1.0);
        float texVal = texture2D(uDepthMap, cuv).r;
        float groundH = mix(uWaterLevel - 14.0, (uWaterLevel - 14.0) + texVal * 18.0, inside);
        float depth = max(0.0, uWaterLevel - groundH);

        // Biome tint inside the island (outer ocean smoothly stays classic deep azure)
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

        // Base ocean/meadow water palette modulated by biome waters
        vec3 colShallow = vec3(0.16, 0.70, 0.62);
        vec3 colMid     = vec3(0.05, 0.39, 0.64);
        vec3 colDeep    = vec3(0.03, 0.18, 0.44);

        // West Karst: luminous jade-emerald lagoon
        colShallow = mix(colShallow, vec3(0.12, 0.78, 0.56), wKarst * 0.88);
        colMid     = mix(colMid,     vec3(0.04, 0.48, 0.44), wKarst * 0.85);
        // East Canyon: warm turquoise-amber coastal cove
        colShallow = mix(colShallow, vec3(0.28, 0.64, 0.56), wCanyon * 0.75);
        // South Maple Lake: calm crystal autumn lake (jade-teal mirror)
        colShallow = mix(colShallow, vec3(0.16, 0.56, 0.50), wMaple * 0.82);
        colMid     = mix(colMid,     vec3(0.06, 0.29, 0.40), wMaple * 0.82);
        // Mistwood: deep enigmatic emerald-slate water
        colShallow = mix(colShallow, vec3(0.07, 0.36, 0.35), wMist * 0.85);
        colMid     = mix(colMid,     vec3(0.03, 0.19, 0.25), wMist * 0.85);
        // Northern Snowfield: crisp glacial ice-blue sea
        colShallow = mix(colShallow, vec3(0.36, 0.76, 0.88), wSnow * 0.85);
        colMid     = mix(colMid,     vec3(0.11, 0.34, 0.62), wSnow * 0.75);

        float shallowT = smoothstep(0.15, 2.5, depth);
        float deepT    = smoothstep(2.2, 9.5, depth);
        vec3 waterCol  = mix(colShallow, colMid, shallowT);
        waterCol       = mix(waterCol, colDeep, deepT);

        // Adapt water color cleanly to sunset warmth & moonlit sapphire night
        waterCol *= mix(vec3(1.0), vec3(1.12, 0.86, 0.74), uSunsetFactor * 0.55);
        waterCol *= mix(vec3(1.0), vec3(0.26, 0.36, 0.58), uNightFactor);

        // Drifting stylized cel wave ribbons (calmer mirror ripples on South Maple Lake)
        vec2 wUv1 = vWorldPos.xz * 0.22 + vec2(uTime * 0.24, uTime * 0.13);
        vec2 wUv2 = vWorldPos.xz * 0.15 - vec2(uTime * 0.16, uTime * 0.20);
        float r1 = celNoise(wUv1);
        float r2 = celNoise(wUv2 + r1 * 0.85);
        float ripple = smoothstep(0.64, 0.74, r2) * smoothstep(240.0, 35.0, dist);
        vec3 rippleCol = mix(vec3(0.55, 0.92, 0.95), vec3(0.42, 0.64, 0.92), uNightFactor);
        rippleCol = mix(rippleCol, vec3(1.0, 0.80, 0.56), uSunsetFactor * 0.5);
        waterCol = mix(waterCol, rippleCol, ripple * mix(0.24, 0.14, wMaple));

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

        // Crisp HDR sun/moon specular sparkles (enhanced silver moon shimmer on South Maple Lake!)
        vec3 waveN = safeNormalize(vec3((r1 - 0.5) * mix(0.24, 0.14, wMaple), 1.0, (r2 - 0.5) * mix(0.24, 0.14, wMaple)));
        vec3 glintDir = safeNormalize(mix(uSunDir, uMoonDir, step(0.5, uNightFactor)));
        vec3 halfV = safeNormalize(glintDir - viewDir);
        float specPow = mix(85.0, 42.0, wMaple * uNightFactor);
        float spec = safePow(clamp(dot(waveN, halfV), 0.0, 1.0), specPow);
        float celSpec = smoothstep(0.28, 0.54, spec) * cSh;
        vec3 glintCol = mix(uSunHaze * 1.45, vec3(0.85, 1.15, 1.55) * (1.0 + wMaple * 0.45), uNightFactor);
        waterCol += glintCol * celSpec;

        // Grazing Fresnel sky reflection (extra mirror-like on Maple Lake)
        float fresnelBase = clamp(1.0 - clamp(-viewDir.y, 0.0, 1.0), 0.0, 1.0);
        float fresnel = fresnelBase * fresnelBase * fresnelBase;
        vec3 skyRefl = mix(uAerialBlue, uSkyHorizon, 0.52);
        waterCol = mix(waterCol, skyRefl, fresnel * (0.44 + wMaple * 0.18));

        // Composite shoreline foam tinted softly by time of day
        vec3 foamCol = mix(vec3(0.92, 0.96, 0.98), vec3(0.98, 0.86, 0.72), uSunsetFactor * 0.6);
        foamCol = mix(foamCol, vec3(0.55, 0.72, 0.92), uNightFactor);
        waterCol = mix(waterCol, foamCol, foam);

        float alpha = mix(0.56, 1.0, smoothstep(0.0, 4.5, depth));
        alpha = max(alpha, foam * 0.97);
        alpha = mix(alpha, 1.0, smoothstep(90.0, 220.0, dist));

        waterCol = applyCelAtmosphere(waterCol, vWorldPos);

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
      uValleyMistBoost: celUniforms.uValleyMistBoost,
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
        vec3 col = applyCelAtmosphere(uColor, vWorldPos);
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

        col = applyCelAtmosphere(col, vWorldPos);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}

// ------------------------------------------------------------ Northern Night Aurora Ribbon Material

export function createAuroraMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    fog: false,
    uniforms: {
      uTime: celUniforms.uTime,
      uNightFactor: celUniforms.uNightFactor,
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec3 p = position;
        // Gentle billowing sky curtain
        float sway = sin(uv.x * 12.566 + uTime * 0.35) * 14.0 + cos(uv.x * 25.13 - uTime * 0.22) * 7.0;
        p.z += sway;
        p.y += sin(uv.x * 18.85 + uTime * 0.28) * 6.0;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uNightFactor;
      varying vec2 vUv;
      ${CEL_NOISE_GLSL}

      void main() {
        float nightVis = smoothstep(0.28, 0.82, uNightFactor);
        if (nightVis < 0.01) discard;

        // Vertical luminous rays shimmering horizontally along the aurora curtain
        float r1 = celNoise(vec2(vUv.x * 18.0 + uTime * 0.14, vUv.y * 1.8));
        float r2 = celNoise(vec2(vUv.x * 36.0 - uTime * 0.20, vUv.y * 2.4 + 4.1));
        float rays = smoothstep(0.25, 0.85, r1 * 0.65 + r2 * 0.55);

        float edgeX = smoothstep(0.0, 0.18, vUv.x) * smoothstep(1.0, 0.82, vUv.x);
        float baseEdge = smoothstep(0.0, 0.20, vUv.y);
        float topFade = smoothstep(1.0, 0.22, vUv.y);
        float band = baseEdge * topFade * edgeX * (0.45 + 0.85 * rays);

        // Classic aurora palette: luminous emerald-jade lower rim -> teal -> soft violet crown
        vec3 colLow  = vec3(0.25, 1.55, 0.98);
        vec3 colMid  = vec3(0.18, 1.15, 1.38);
        vec3 colHigh = vec3(0.75, 0.42, 1.45);
        vec3 col = mix(colLow, colMid, smoothstep(0.08, 0.52, vUv.y));
        col = mix(col, colHigh, smoothstep(0.48, 0.92, vUv.y));

        float a = band * nightVis * 0.52;
        if (a < 0.004) discard;
        gl_FragColor = vec4(col * a, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}

// ------------------------------------------------------------ Karst Cloud Sea Mist Ribbon Material

export function createCloudSeaMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
    uniforms: {
      uTime: celUniforms.uTime,
      uValleyMist: celUniforms.uValleyMist,
      uSunHaze: celUniforms.uSunHaze,
      uSunsetFactor: celUniforms.uSunsetFactor,
      uNightFactor: celUniforms.uNightFactor,
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vWorldPos;
      void main() {
        vUv = uv;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uValleyMist;
      uniform vec3 uSunHaze;
      uniform float uSunsetFactor;
      uniform float uNightFactor;
      varying vec2 vUv;
      varying vec3 vWorldPos;
      ${CEL_NOISE_GLSL}

      void main() {
        vec2 centered = vUv * 2.0 - 1.0;
        float r = length(centered);
        float radial = smoothstep(1.0, 0.25, r);
        if (radial < 0.01) discard;

        float n1 = celFbm(vWorldPos.xz * 0.018 + vec2(uTime * 0.035, -uTime * 0.018));
        float n2 = celNoise(vWorldPos.xz * 0.042 - vec2(uTime * 0.025, uTime * 0.02));
        float wisp = smoothstep(0.32, 0.78, n1 * 0.7 + n2 * 0.3);

        // Fade softly when camera gets right inside the sheet so it never clips harshly
        float camDist = length(vWorldPos - cameraPosition);
        float nearFade = smoothstep(8.0, 32.0, camDist);

        vec3 col = mix(uValleyMist, uSunHaze, uSunsetFactor * 0.45);
        col = mix(col, vec3(0.42, 0.58, 0.72), uNightFactor * 0.65);

        float alpha = radial * wisp * nearFade * mix(0.42, 0.22, uNightFactor);
        if (alpha < 0.005) discard;
        gl_FragColor = vec4(col, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}

// ------------------------------------------------------------ Mistwood Bioluminescent Mushroom Material

export function createGlowMushroomMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
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
      uValleyMistBoost: celUniforms.uValleyMistBoost,
      uShadowTint: celUniforms.uShadowTint,
      uLitTint: celUniforms.uLitTint,
      uFogNear: celUniforms.uFogNear,
      uFogFar: celUniforms.uFogFar,
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;
      varying vec3 vInstColor;
      varying float vHeight;
      void main() {
        vHeight = clamp(position.y, 0.0, 1.0);
        #ifdef USE_INSTANCING_COLOR
          vInstColor = instanceColor;
        #else
          vInstColor = vec3(0.25, 0.92, 0.84);
        #endif
        vec4 wp = vec4(position, 1.0);
        vec3 wn = normal;
        #ifdef USE_INSTANCING
          wp = instanceMatrix * wp;
          wn = mat3(instanceMatrix) * wn;
        #endif
        wp = modelMatrix * wp;
        wn = mat3(modelMatrix) * wn;
        vWorldPos = wp.xyz;
        float lsq = dot(wn, wn);
        vWorldNormal = lsq > 1e-10 ? wn * inversesqrt(lsq) : vec3(0.0, 1.0, 0.0);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uShadowTint;
      uniform vec3 uLitTint;
      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;
      varying vec3 vInstColor;
      varying float vHeight;
      ${CEL_SAFE_MATH_GLSL}
      ${CEL_ATMOS_PARS_GLSL}

      void main() {
        vec3 n = safeNormalize(vWorldNormal);
        float ndotl = dot(n, safeNormalize(mix(uSunDir, uMoonDir, uNightFactor)));
        float cel = smoothstep(-0.08, 0.25, ndotl);

        // Stem is pale cream-teal; cap carries the bioluminescent pigment
        float capMask = smoothstep(0.32, 0.58, vHeight);
        vec3 baseCol = mix(vec3(0.68, 0.78, 0.74), vInstColor, capMask);
        vec3 litCol = baseCol * mix(uShadowTint * 0.95, uLitTint * 1.02, cel);

        // Gentle breathing HDR glow at night (and subtle mystic sheen by day)
        float pulse = 0.82 + 0.18 * sin(uTime * 1.8 + vWorldPos.x * 0.7 + vWorldPos.z * 0.6);
        float glowBoost = mix(0.22, 1.85, smoothstep(0.15, 0.85, uNightFactor)) * capMask * pulse;
        vec3 col = litCol + vInstColor * glowBoost;

        col = applyCelAtmosphere(col, vWorldPos);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
}

