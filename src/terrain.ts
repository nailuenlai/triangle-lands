import { Simplex2 } from './noise';
import { BIOME_COUNT, sampleBiomeWeights } from './biomes';

export const WORLD_SIZE = 640;
export const HALF = WORLD_SIZE / 2;
export const SEG = 192;
export const WATER_LEVEL = 1.5;

/** A hand-placed landmark area: terrain is flattened into a plateau (or shallow lake bed) around it. */
export interface Flatten {
  x: number;
  z: number;
  r: number;
  /** Optional explicit elevation override (e.g. underwater lake bed for sunken ruins). */
  targetH?: number;
  /** Optional minimum elevation above raw height. */
  minH?: number;
  /** Optional gentle vertical lift added to raw terrain at center. */
  lift?: number;
}

export const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Multi-biome heightfield: blends six distinct regional silhouettes seamlessly
 * (Meadow, Karst Spires & Lagoons, Red Sandstone Canyons, Maple Lake & Islets,
 * Rounded Mistwood Hills, and Towering Northern Snow Peaks) + hand-placed plateaus.
 */
export class Terrain {
  readonly heights: Float32Array;
  /** Precomputed 6 biome weights at every grid vertex (N * N * 6). */
  readonly biomeWeights: Float32Array;
  readonly step = WORLD_SIZE / SEG;
  private n1 = new Simplex2(7);
  private n2 = new Simplex2(19);
  private n3 = new Simplex2(41);
  private n4 = new Simplex2(73);
  private n5 = new Simplex2(109);
  private wTmp = new Float32Array(BIOME_COUNT);

  constructor(flats: Flatten[]) {
    const N = SEG + 1;
    this.heights = new Float32Array(N * N);
    this.biomeWeights = new Float32Array(N * N * BIOME_COUNT);

    const bases = flats.map((f) => {
      if (f.targetH !== undefined) return f.targetH;
      const r = this.raw(f.x, f.z) + (f.lift ?? 0);
      return Math.max(r, f.minH ?? WATER_LEVEL + 4);
    });

    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const x = -HALF + i * this.step;
        const z = -HALF + j * this.step;
        const idx = j * N + i;

        sampleBiomeWeights(x, z, this.wTmp);
        const off = idx * BIOME_COUNT;
        for (let b = 0; b < BIOME_COUNT; b++) this.biomeWeights[off + b] = this.wTmp[b];

        let h = this.rawWithWeights(x, z, this.wTmp);
        for (let k = 0; k < flats.length; k++) {
          const f = flats[k];
          const d = Math.hypot(x - f.x, z - f.z);
          if (d >= f.r) continue;
          const w = 1 - smoothstep(f.r * 0.42, f.r, d);
          h += (bases[k] - h) * w;
        }
        this.heights[idx] = h;
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

  private rawWithWeights(x: number, z: number, w: Float32Array): number {
    const fbmLow = this.fbm(x * 0.0042, z * 0.0042, 5);
    const bumps = this.n3.noise(x * 0.025, z * 0.025);

    // 0: 翠野 — Classic rolling Hyrule hills & gentle ridges
    let hMeadow = 0;
    if (w[0] > 0.002) {
      const mask = smoothstep(-0.15, 0.45, this.n3.noise(x * 0.0028 + 50, z * 0.0028 - 30));
      hMeadow = fbmLow * 22 + 12.5
        + Math.pow(this.ridged(x * 0.0068, z * 0.0068, 4), 1.65) * 44 * mask
        + bumps * 2.2;
    }

    // 1: 西嶺石林 — Turquoise lagoon plains pierced by dramatic steep limestone karst pillars
    let hKarst = 0;
    if (w[1] > 0.002) {
      const lagoonFloor = this.n1.noise(x * 0.011, z * 0.011) * 4.0 + 0.55;
      const spireA = smoothstep(0.14, 0.50, this.n4.noise(x * 0.025, z * 0.025));
      const spireB = smoothstep(0.20, 0.56, this.n5.noise(x * 0.036 + 19, z * 0.036 - 23));
      const spireH = Math.min(54, Math.pow(spireA, 1.32) * 50 + Math.pow(spireB, 1.45) * 26);
      // Gentle dry rim along the eastern transition so players can walk right in
      hKarst = lagoonFloor + spireH + bumps * 1.1;
    }

    // 2: 東崖赤谷 — Multi-tiered terraced red sandstone mesas & winding canyon gorge
    let hCanyon = 0;
    if (w[2] > 0.002) {
      const rawMesa = (this.fbm(x * 0.0056 + 14, z * 0.0056 - 9, 4) * 0.5 + 0.5) * 34 + 11;
      const stepH = 9.5;
      const u = rawMesa / stepH;
      const fl = Math.floor(u);
      const mesa = (fl + smoothstep(0.20, 0.80, u - fl)) * stepH;
      const gorgeWave = this.n5.noise(x * 0.0075 - 12, z * 0.0075 + 21);
      const gorgeMask = 1 - smoothstep(0.06, 0.24, Math.abs(gorgeWave));
      const gorgeFloor = 7.2 + bumps * 1.3;
      hCanyon = mesa * (1 - gorgeMask * 0.84) + gorgeFloor * (gorgeMask * 0.84) + bumps * 0.9;
    }

    // 3: 南湖楓渚 — Broad serene lowland maple lake with islets & shallow sandy shoals
    let hMaple = 0;
    if (w[3] > 0.002) {
      const lakeWarp = this.n1.noise(x * 0.014, z * 0.014) * 22;
      const lakeD = Math.hypot((x - 98) * 0.90, (z - 138) * 1.04) + lakeWarp;
      const basinMask = 1 - smoothstep(42, 82, lakeD);
      const rimHills = 12 + (this.fbm(x * 0.006 + 8, z * 0.006 + 15, 4) * 0.5 + 0.5) * 16 + bumps * 1.6;
      // Sculpted maple islets & shoals rising inside the lake (leaving center clear for sunken gate)
      const centerClear = smoothstep(14, 30, Math.hypot(x - 92, z - 136));
      const isletN = this.n4.noise(x * 0.032 - 38, z * 0.032 + 27);
      const islet = smoothstep(0.22, 0.56, isletN) * 14.5 * centerClear;
      const shoal = smoothstep(-0.05, 0.28, isletN) * 2.4 * centerClear;
      const lakeBed = WATER_LEVEL - 4.4 + shoal + islet;
      hMaple = rimHills * (1 - basinMask) + lakeBed * basinMask;
    }

    // 4: 霧林 — Soft, billowing rounded hills & sheltered mossy glades
    let hMistwood = 0;
    if (w[4] > 0.002) {
      hMistwood = 18.5
        + this.fbm(x * 0.0052 - 22, z * 0.0052 + 18, 4) * 18.5
        + this.n3.noise(x * 0.013 + 7, z * 0.013 - 9) * 5.2
        + bumps * 1.4;
    }

    // 5: 北境雪原 — Towering alpine mountain massif & snowy ridges (highest on the island)
    let hSnow = 0;
    if (w[5] > 0.002) {
      const ridge = Math.pow(this.ridged(x * 0.0070 + 12, z * 0.0070 - 18, 4), 1.32);
      hSnow = 26 + fbmLow * 18 + ridge * 68 + bumps * 2.6;
    }

    const h = w[0] * hMeadow + w[1] * hKarst + w[2] * hCanyon + w[3] * hMaple + w[4] * hMistwood + w[5] * hSnow;

    // Organic coastline falloff into the surrounding sea
    const coastWarp = this.n1.noise(x * 0.0058 + 3.1, z * 0.0058 - 4.7) * 0.065;
    const d = Math.hypot(x, z) / HALF + coastWarp;
    const edge = smoothstep(0.74, 0.98, d);
    return h * (1 - edge) - 14 * edge;
  }

  raw(x: number, z: number): number {
    sampleBiomeWeights(x, z, this.wTmp);
    return this.rawWithWeights(x, z, this.wTmp);
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
