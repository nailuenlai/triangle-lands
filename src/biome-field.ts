import { Simplex2 } from './noise.ts';

export type BiomeId = 'meadow' | 'karst' | 'canyon' | 'maple' | 'mistwood' | 'snow';

export interface BiomeSeed {
  readonly index: number;
  readonly id: BiomeId;
  /** Seed center in world XZ for organic Voronoi-softmax partitioning. */
  readonly cx: number;
  readonly cz: number;
  /** Distance scale factor (<1 enlarges biome, >1 shrinks it). */
  readonly distScale: number;
}

/** Pure spatial biome partition seeds (no Three.js dependency, usable directly in Node scripts). */
export const BIOME_SEEDS: readonly BiomeSeed[] = [
  { index: 0, id: 'meadow', cx: 4, cz: 16, distScale: 1.0 },
  { index: 1, id: 'karst', cx: -178, cz: -48, distScale: 0.96 },
  { index: 2, id: 'canyon', cx: 168, cz: -78, distScale: 0.96 },
  { index: 3, id: 'maple', cx: 112, cz: 146, distScale: 0.95 },
  { index: 4, id: 'mistwood', cx: -128, cz: 155, distScale: 0.95 },
  { index: 5, id: 'snow', cx: -14, cz: -222, distScale: 0.94 },
];

export const BIOME_COUNT = BIOME_SEEDS.length;

const warpNoiseX = new Simplex2(137);
const warpNoiseZ = new Simplex2(269);

// Softmax sharpness: lower = crisper regions, higher = wider blend bands
const SOFTMAX_TEMP = 24.0;

/**
 * Computes smooth, domain-warped biome blend weights (6 floats summing to 1)
 * for any world position (x, z). Writes into `out` to avoid allocations in hot loops.
 */
export function sampleBiomeWeights(x: number, z: number, out = new Float32Array(BIOME_COUNT)): Float32Array {
  const wx = x + warpNoiseX.noise(x * 0.0068, z * 0.0068) * 34;
  const wz = z + warpNoiseZ.noise(x * 0.0068 + 47.2, z * 0.0068 - 29.8) * 34;

  let minD = Infinity;
  for (let i = 0; i < BIOME_COUNT; i++) {
    const b = BIOME_SEEDS[i];
    const d = Math.hypot(wx - b.cx, wz - b.cz) * b.distScale;
    out[i] = d;
    if (d < minD) minD = d;
  }

  let sum = 0;
  for (let i = 0; i < BIOME_COUNT; i++) {
    const e = Math.exp(-(out[i] - minD) / SOFTMAX_TEMP);
    out[i] = e;
    sum += e;
  }
  const inv = sum > 1e-6 ? 1 / sum : 1;
  for (let i = 0; i < BIOME_COUNT; i++) out[i] *= inv;
  return out;
}

const _domTmp = new Float32Array(BIOME_COUNT);

/** Returns the dominant biome index (0..5) and its weight at (x, z). */
export function sampleDominantBiomeIndex(x: number, z: number): { index: number; weight: number } {
  sampleBiomeWeights(x, z, _domTmp);
  let best = 0;
  let bestW = _domTmp[0];
  for (let i = 1; i < BIOME_COUNT; i++) {
    if (_domTmp[i] > bestW) {
      bestW = _domTmp[i];
      best = i;
    }
  }
  return { index: best, weight: bestW };
}
