import { Simplex2 } from './noise';

export const WORLD_SIZE = 640;
export const HALF = WORLD_SIZE / 2;
export const SEG = 160;
export const WATER_LEVEL = 1.5;

/** A hand-placed landmark area: terrain is flattened into a plateau around it. */
export interface Flatten { x: number; z: number; r: number; }

export const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Heightfield = procedural noise (rolling hills + ridged mountain ranges)
 * + hand-placed plateaus for landmarks. The ridges are what create the
 * "triangle" occlusion: they hide what's behind until you crest them.
 */
export class Terrain {
  readonly heights: Float32Array;
  readonly step = WORLD_SIZE / SEG;
  private n1 = new Simplex2(7);
  private n2 = new Simplex2(19);
  private n3 = new Simplex2(41);

  constructor(flats: Flatten[]) {
    const N = SEG + 1;
    this.heights = new Float32Array(N * N);
    const bases = flats.map((f) => Math.max(this.raw(f.x, f.z), WATER_LEVEL + 4));
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const x = -HALF + i * this.step;
        const z = -HALF + j * this.step;
        let h = this.raw(x, z);
        for (let k = 0; k < flats.length; k++) {
          const f = flats[k];
          const d = Math.hypot(x - f.x, z - f.z);
          const w = 1 - smoothstep(f.r * 0.45, f.r, d);
          h += (bases[k] - h) * w;
        }
        this.heights[j * N + i] = h;
      }
    }
  }

  private fbm(x: number, z: number, oct: number): number {
    let a = 1, f = 1, s = 0, norm = 0;
    for (let o = 0; o < oct; o++) {
      s += a * this.n1.noise(x * f, z * f);
      norm += a; a *= 0.5; f *= 2;
    }
    return s / norm;
  }

  private ridged(x: number, z: number, oct: number): number {
    let a = 1, f = 1, s = 0, norm = 0;
    for (let o = 0; o < oct; o++) {
      let v = 1 - Math.abs(this.n2.noise(x * f, z * f));
      v *= v;
      s += a * v; norm += a; a *= 0.5; f *= 2.1;
    }
    return s / norm;
  }

  raw(x: number, z: number): number {
    const d = Math.hypot(x, z) / HALF;
    let h = this.fbm(x * 0.004, z * 0.004, 5) * 26 + 11;
    // Mountain ranges only appear in some regions -> valleys between ridges.
    const mask = smoothstep(-0.15, 0.45, this.n3.noise(x * 0.0026 + 50, z * 0.0026 - 30));
    h += Math.pow(this.ridged(x * 0.0065, z * 0.0065, 4), 1.6) * 80 * mask;
    // Small rolling bumps: local occluders at walking scale.
    h += this.n3.noise(x * 0.025, z * 0.025) * 2.5;
    // Island falloff into the sea.
    const edge = smoothstep(0.72, 0.98, d);
    return h * (1 - edge) - 14 * edge;
  }

  /** Exact height on the rendered triangle mesh. */
  height(x: number, z: number): number {
    const N = SEG + 1;
    const gx = Math.min(SEG - 1e-4, Math.max(0, (x + HALF) / this.step));
    const gz = Math.min(SEG - 1e-4, Math.max(0, (z + HALF) / this.step));
    const i = Math.floor(gx), j = Math.floor(gz);
    const fx = gx - i, fz = gz - j;
    const H = this.heights;
    const a = H[j * N + i], b = H[j * N + i + 1];
    const c = H[(j + 1) * N + i], d = H[(j + 1) * N + i + 1];
    if (fx + fz <= 1) return a + (b - a) * fx + (c - a) * fz;
    return d + (c - d) * (1 - fx) + (b - d) * (1 - fz);
  }

  /** Approximate surface normal Y (1 = flat). */
  flatness(x: number, z: number): number {
    const e = 1.5;
    const gx = (this.height(x + e, z) - this.height(x - e, z)) / (2 * e);
    const gz = (this.height(x, z + e) - this.height(x, z - e)) / (2 * e);
    return 1 / Math.sqrt(1 + gx * gx + gz * gz);
  }
}
