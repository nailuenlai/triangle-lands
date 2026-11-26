import * as THREE from 'three';
import {
  BIOME_COUNT,
  BIOME_SEEDS,
  sampleBiomeWeights,
  sampleDominantBiomeIndex,
  type BiomeId,
} from './biome-field';

export { BIOME_COUNT, BIOME_SEEDS, sampleBiomeWeights, type BiomeId };

export interface BiomeMoteProfile {
  dayColA: THREE.Color;
  dayColB: THREE.Color;
  nightColA: THREE.Color;
  nightColB: THREE.Color;
  /** Drift velocity (x, y, z) in world units / sec. */
  drift: THREE.Vector3;
  size: number;
  /** 0 = soft pollen/mist, 1 = brisk falling snow/petals, 2 = vivid night spores */
  dayAlpha: number;
  nightAlpha: number;
}

export interface BiomeDef {
  index: number;
  id: BiomeId;
  name: string;
  subtitle: string;
  /** Seed center in world XZ for organic Voronoi-softmax partitioning. */
  cx: number;
  cz: number;
  /** Distance scale factor (<1 enlarges biome, >1 shrinks it). */
  distScale: number;
  /** Cartographic ink label placement on the parchment map. */
  labelX: number;
  labelZ: number;
  /** Fog range & atmospheric color shifts blended smoothly as the player travels. */
  fogNear: number;
  fogFar: number;
  fogTint: THREE.Color;
  fogTintAmt: number;
  valleyMistTint: THREE.Color;
  valleyMistBoost: number;
  litTint: THREE.Color;
  litTintAmt: number;
  shadowTint: THREE.Color;
  shadowTintAmt: number;
  /** Musical pentatonic/modal frequencies for ambient wind-harp phrases. */
  scale: number[];
  bass: number[];
  /** Signature arrival motif notes (3-4 notes). */
  arrivalMotif: number[];
  /** Soundscape modifiers. */
  windBoost: number;
  leafFactor: number;
  birdFactor: number;
  waterFactor: number;
  motes: BiomeMoteProfile;
}

export const BIOMES: BiomeDef[] = [
  // 0: 翠野 — Central sunlit emerald meadow (baseline)
  {
    ...BIOME_SEEDS[0],
    name: '翠野',
    subtitle: '微風拂青丘，花信滿山原',
    labelX: 22,
    labelZ: 28,
    fogNear: 108,
    fogFar: 560,
    fogTint: new THREE.Color('#8ec3e8'),
    fogTintAmt: 0.0,
    valleyMistTint: new THREE.Color('#e2f2f1'),
    valleyMistBoost: 0.22,
    litTint: new THREE.Color('#fff9eb'),
    litTintAmt: 0.0,
    shadowTint: new THREE.Color('#4f6fa3'),
    shadowTintAmt: 0.0,
    // D major pentatonic
    scale: [293.66, 329.63, 369.99, 440.0, 493.88, 587.33, 659.25, 739.99],
    bass: [146.83, 196.0, 220.0],
    arrivalMotif: [293.66, 440.0, 587.33],
    windBoost: 0.0,
    leafFactor: 1.0,
    birdFactor: 1.0,
    waterFactor: 0.0,
    motes: {
      dayColA: new THREE.Color(1.18, 1.14, 0.90),
      dayColB: new THREE.Color(1.12, 1.20, 0.88),
      nightColA: new THREE.Color(1.35, 1.95, 0.58),
      nightColB: new THREE.Color(1.85, 1.65, 0.52),
      drift: new THREE.Vector3(0.75, 0.14, 0.35),
      size: 0.36,
      dayAlpha: 0.54,
      nightAlpha: 0.92,
    },
  },
  // 1: 西嶺石林 — Western jade limestone karst spires & turquoise lagoons
  {
    ...BIOME_SEEDS[1],
    name: '西嶺石林',
    subtitle: '千峰拔碧水，雲海繞危崖',
    labelX: -188,
    labelZ: -108,
    fogNear: 78,
    fogFar: 410,
    fogTint: new THREE.Color('#9cd4cc'),
    fogTintAmt: 0.36,
    valleyMistTint: new THREE.Color('#d9f5ee'),
    valleyMistBoost: 0.42,
    litTint: new THREE.Color('#f4fff9'),
    litTintAmt: 0.22,
    shadowTint: new THREE.Color('#3b6f7a'),
    shadowTintAmt: 0.35,
    // E major pentatonic / luminous high Guilin flute feel
    scale: [329.63, 369.99, 415.30, 493.88, 554.37, 659.25, 739.99, 830.61],
    bass: [164.81, 220.0, 246.94],
    arrivalMotif: [329.63, 493.88, 659.25, 830.61],
    windBoost: 0.22,
    leafFactor: 0.65,
    birdFactor: 0.85,
    waterFactor: 0.28,
    motes: {
      dayColA: new THREE.Color(0.95, 1.25, 1.18),
      dayColB: new THREE.Color(1.15, 1.28, 1.22),
      nightColA: new THREE.Color(0.85, 1.65, 1.55),
      nightColB: new THREE.Color(1.15, 1.75, 1.45),
      drift: new THREE.Vector3(0.45, 0.22, 0.28),
      size: 0.46,
      dayAlpha: 0.52,
      nightAlpha: 0.78,
    },
  },
  // 2: 東崖赤谷 — Eastern terraced red sandstone mesas & desert canyons
  {
    ...BIOME_SEEDS[2],
    name: '東崖赤谷',
    subtitle: '丹崖千層疊，長風捲赤沙',
    labelX: 196,
    labelZ: -96,
    fogNear: 94,
    fogFar: 490,
    fogTint: new THREE.Color('#e0a67e'),
    fogTintAmt: 0.40,
    valleyMistTint: new THREE.Color('#f2c89d'),
    valleyMistBoost: 0.26,
    litTint: new THREE.Color('#ffe8c4'),
    litTintAmt: 0.34,
    shadowTint: new THREE.Color('#6b4d6e'),
    shadowTintAmt: 0.42,
    // D Dorian / dry open desert fifths
    scale: [293.66, 329.63, 349.23, 440.0, 523.25, 587.33, 659.25, 783.99],
    bass: [146.83, 174.61, 220.0],
    arrivalMotif: [293.66, 440.0, 523.25, 587.33],
    windBoost: 0.42,
    leafFactor: 0.18,
    birdFactor: 0.35,
    waterFactor: 0.0,
    motes: {
      dayColA: new THREE.Color(1.38, 0.98, 0.62),
      dayColB: new THREE.Color(1.45, 0.84, 0.50),
      nightColA: new THREE.Color(1.55, 1.15, 0.68),
      nightColB: new THREE.Color(1.35, 0.95, 0.58),
      drift: new THREE.Vector3(2.4, -0.10, 0.95),
      size: 0.32,
      dayAlpha: 0.62,
      nightAlpha: 0.48,
    },
  },
  // 3: 南湖楓渚 — Southern maple lake, islets, crimson foliage & lotus shoals
  {
    ...BIOME_SEEDS[3],
    name: '南湖楓渚',
    subtitle: '秋楓映碧水，孤渚泊清波',
    labelX: 112,
    labelZ: 208,
    fogNear: 90,
    fogFar: 460,
    fogTint: new THREE.Color('#d6b8a8'),
    fogTintAmt: 0.25,
    valleyMistTint: new THREE.Color('#f2e2d4'),
    valleyMistBoost: 0.30,
    litTint: new THREE.Color('#fff0d8'),
    litTintAmt: 0.22,
    shadowTint: new THREE.Color('#5a628f'),
    shadowTintAmt: 0.24,
    // A minor pentatonic / poetic autumn Yo scale
    scale: [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25],
    bass: [130.81, 164.81, 196.0],
    arrivalMotif: [329.63, 392.0, 523.25, 440.0],
    windBoost: -0.05,
    leafFactor: 1.05,
    birdFactor: 0.95,
    waterFactor: 0.42,
    motes: {
      dayColA: new THREE.Color(1.38, 0.46, 0.26), // drifting crimson maple leaves
      dayColB: new THREE.Color(1.42, 0.86, 0.28), // amber gold leaves
      nightColA: new THREE.Color(1.55, 1.32, 0.72), // warm golden lake fireflies
      nightColB: new THREE.Color(1.25, 1.65, 0.95),
      drift: new THREE.Vector3(0.55, -0.58, 0.32),
      size: 0.48,
      dayAlpha: 0.78,
      nightAlpha: 0.84,
    },
  },
  // 4: 霧林 — Southwestern misty ancient woods & nocturnal bioluminescent spores
  {
    ...BIOME_SEEDS[4],
    name: '霧林',
    subtitle: '古木深藏霧，幽林夜綻光',
    labelX: -74,
    labelZ: 184,
    fogNear: 48,
    fogFar: 225,
    fogTint: new THREE.Color('#5f9990'),
    fogTintAmt: 0.56,
    valleyMistTint: new THREE.Color('#8ec7bd'),
    valleyMistBoost: 0.48,
    litTint: new THREE.Color('#dcf5eb'),
    litTintAmt: 0.28,
    shadowTint: new THREE.Color('#274f5c'),
    shadowTintAmt: 0.52,
    // F# minor / dreamy suspended mystery
    scale: [277.18, 329.63, 369.99, 440.0, 493.88, 554.37, 659.25, 739.99],
    bass: [138.59, 185.0, 220.0],
    arrivalMotif: [277.18, 369.99, 493.88, 554.37],
    windBoost: -0.08,
    leafFactor: 1.35,
    birdFactor: 0.72,
    waterFactor: 0.08,
    motes: {
      dayColA: new THREE.Color(0.72, 1.28, 1.12),
      dayColB: new THREE.Color(0.95, 1.35, 1.05),
      nightColA: new THREE.Color(0.55, 2.05, 1.75), // luminous cyan-emerald forest spores
      nightColB: new THREE.Color(1.15, 1.35, 2.15), // mystic lavender spores
      drift: new THREE.Vector3(0.22, 0.28, 0.16),
      size: 0.45,
      dayAlpha: 0.58,
      nightAlpha: 1.0,
    },
  },
  // 5: 北境雪原 — Northern towering snow peaks, crisp air & night aurora
  {
    ...BIOME_SEEDS[5],
    name: '北境雪原',
    subtitle: '雪嶺連天白，夜空垂極光',
    labelX: -62,
    labelZ: -194,
    fogNear: 84,
    fogFar: 430,
    fogTint: new THREE.Color('#a8c9e8'),
    fogTintAmt: 0.38,
    valleyMistTint: new THREE.Color('#dcecf8'),
    valleyMistBoost: 0.30,
    litTint: new THREE.Color('#eef7ff'),
    litTintAmt: 0.28,
    shadowTint: new THREE.Color('#47679e'),
    shadowTintAmt: 0.36,
    // B / C# crystalline high alpine bells
    scale: [369.99, 440.0, 493.88, 554.37, 659.25, 739.99, 880.0, 987.77],
    bass: [185.0, 246.94, 277.18],
    arrivalMotif: [493.88, 659.25, 739.99, 987.77],
    windBoost: 0.48,
    leafFactor: 0.25,
    birdFactor: 0.12,
    waterFactor: 0.0,
    motes: {
      dayColA: new THREE.Color(1.22, 1.30, 1.40), // drifting crisp snowflakes
      dayColB: new THREE.Color(1.12, 1.24, 1.38),
      nightColA: new THREE.Color(0.88, 1.35, 1.65),
      nightColB: new THREE.Color(0.75, 1.65, 1.45),
      drift: new THREE.Vector3(0.42, -1.05, 0.25),
      size: 0.44,
      dayAlpha: 0.85,
      nightAlpha: 0.88,
    },
  },
];

/** Returns the dominant biome index (0..5), its weight, and its full definition at (x, z). */
export function sampleDominantBiome(x: number, z: number): { index: number; weight: number; biome: BiomeDef } {
  const { index, weight } = sampleDominantBiomeIndex(x, z);
  return { index, weight, biome: BIOMES[index] };
}
