import { Terrain, HALF, WORLD_SIZE, WATER_LEVEL } from './terrain';
import { mulberry32, Simplex2 } from './noise';
import { EXPLORE_RADIUS, type Tower } from './world';
import { BIOMES, BIOME_COUNT, sampleBiomeWeights } from './biomes';
import type { Wonder } from './landmarks';

const RES = 512;
const FOG_RES = 256;
const TRAIL_GRID = 128;
const TRAIL_BYTES = (TRAIL_GRID * TRAIL_GRID) >> 3;

interface Reveal { x: number; z: number; r: number; p: number; }

type RGB = [number, number, number];
const lerp3 = (a: RGB, b: RGB, t: number): RGB => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

function fbm(n: Simplex2, x: number, y: number, oct: number): number {
  let a = 1, f = 1, s = 0, norm = 0;
  for (let o = 0; o < oct; o++) {
    s += a * n.noise(x * f, y * f);
    norm += a;
    a *= 0.5;
    f *= 2.04;
  }
  return Math.max(0, Math.min(1, (s / norm) * 0.5 + 0.5));
}

export interface MapPlayerPose {
  x: number;
  z: number;
  /** Character facing angle in radians (world forward = (sin(facing), cos(facing))). */
  facing: number;
  /** Camera yaw in radians (camera looks along (-sin(camYaw), -cos(camYaw))). */
  camYaw: number;
}

export interface MapViewState {
  zoom: number;
  centerX: number;
  centerZ: number;
}

/**
 * Topographic parchment map blanketed in layered fog of war.
 * Passing through terrain parts a small ribbon of mist, resonating with an
 * ancient shrine sweeps away a wide expanse of fog, and the map supports
 * regional zoom/pan along with the explorer's live position and facing.
 */
export class GameMap {
  static readonly MIN_ZOOM = 1;
  static readonly MAX_ZOOM = 4;
  static readonly REGIONAL_ZOOM = 2.6;

  private terrainImg = document.createElement('canvas');
  private fogBase = document.createElement('canvas');
  private fogComp = document.createElement('canvas');
  private frameOverlay = document.createElement('canvas');

  private trailCanvas = document.createElement('canvas');
  private revealMask = document.createElement('canvas');
  private fogMask = document.createElement('canvas');
  private wispTile = document.createElement('canvas');
  private wispComp = document.createElement('canvas');
  private trailBrush = document.createElement('canvas');

  private fogNoise = new Float32Array(FOG_RES * FOG_RES);
  private fogMaskImg: ImageData;
  private trailGrid = new Uint8Array(TRAIL_GRID * TRAIL_GRID);
  private trailDirty = true;
  private trailCache = '';

  private reveals: Reveal[] = [];
  private dirty = true;

  private zoom = 1;
  private targetZoom = 1;
  private centerX = 0;
  private centerZ = 0;
  private targetCenterX = 0;
  private targetCenterZ = 0;

  constructor(terrain: Terrain) {
    for (const c of [this.terrainImg, this.fogBase, this.fogComp, this.frameOverlay]) {
      c.width = c.height = RES;
    }
    for (const c of [this.trailCanvas, this.revealMask, this.fogMask, this.wispTile, this.wispComp]) {
      c.width = c.height = FOG_RES;
    }
    this.fogMaskImg = this.fogMask.getContext('2d')!.createImageData(FOG_RES, FOG_RES);

    this.renderTerrain(terrain);
    this.renderFogBase();
    this.renderWispTile();
    this.renderFrame();
    this.renderTrailBrush();
  }

  private renderTerrain(terrain: Terrain) {
    const ctx = this.terrainImg.getContext('2d')!;
    const img = ctx.createImageData(RES, RES);
    const s = WORLD_SIZE / RES;

    const deepSea: RGB = [72, 124, 148], shallowSea: RGB = [132, 182, 194];
    const karstLagoon: RGB = [98, 178, 162], mapleLake: RGB = [96, 158, 158], snowSea: RGB = [138, 186, 206];
    const sandBase: RGB = [226, 208, 158];
    const snowCol: RGB = [245, 247, 250];

    // Per-biome parchment low-ground, high-ground, and cliff/rock RGB palettes
    const bioLo: RGB[] = [
      [152, 180, 104], // 0: 翠野
      [118, 170, 138], // 1: 西嶺石林
      [208, 138, 86],  // 2: 東崖赤谷
      [196, 132, 78],  // 3: 南湖楓渚 (warm autumn maple shores)
      [76, 126, 108],  // 4: 霧林
      [214, 224, 232], // 5: 北境雪原
    ];
    const bioHi: RGB[] = [
      [120, 148, 88],  // 0: 翠野
      [96, 146, 122],  // 1: 西嶺石林
      [184, 96, 62],   // 2: 東崖赤谷
      [168, 136, 76],  // 3: 南湖楓渚
      [58, 102, 92],   // 4: 霧林
      [240, 245, 250], // 5: 北境雪原
    ];
    const bioRock: RGB[] = [
      [158, 146, 128], // 0: 翠野
      [166, 178, 170], // 1: 西嶺石林 (pale limestone)
      [172, 84, 54],   // 2: 東崖赤谷 (red sandstone)
      [152, 124, 98],  // 3: 南湖楓渚
      [88, 106, 104],  // 4: 霧林
      [142, 160, 180], // 5: 北境雪原
    ];

    const bw = new Float32Array(BIOME_COUNT);

    for (let py = 0; py < RES; py++) {
      for (let px = 0; px < RES; px++) {
        const x = -HALF + (px + 0.5) * s;
        const z = -HALF + (py + 0.5) * s;
        const h = terrain.height(x, z);
        sampleBiomeWeights(x, z, bw);

        let c: RGB;
        if (h < WATER_LEVEL) {
          const tDeep = Math.min(1, (WATER_LEVEL - h) / 11);
          const inIsland = Math.max(0, Math.min(1, (290 - Math.hypot(x, z)) / 90));
          let shallow = shallowSea;
          if (inIsland > 0.01) {
            shallow = lerp3(shallow, karstLagoon, bw[1] * inIsland * 0.85);
            shallow = lerp3(shallow, mapleLake, bw[3] * inIsland * 0.82);
            shallow = lerp3(shallow, snowSea, bw[5] * inIsland * 0.65);
          }
          c = lerp3(shallow, deepSea, tDeep);
        } else {
          let lr = 0, lg = 0, lb = 0;
          let hr = 0, hg = 0, hb = 0;
          let rr = 0, rg = 0, rb = 0;
          for (let b = 0; b < BIOME_COUNT; b++) {
            const w = bw[b];
            if (w <= 0.001) continue;
            lr += bioLo[b][0] * w; lg += bioLo[b][1] * w; lb += bioLo[b][2] * w;
            hr += bioHi[b][0] * w; hg += bioHi[b][1] * w; hb += bioHi[b][2] * w;
            rr += bioRock[b][0] * w; rg += bioRock[b][1] * w; rb += bioRock[b][2] * w;
          }
          const cLo: RGB = [lr, lg, lb];
          const cHi: RGB = [hr, hg, hb];
          const cRock: RGB = [rr, rg, rb];

          const gx = terrain.height(x + s, z) - h;
          const gz = terrain.height(x, z + s) - h;
          const slope = Math.hypot(gx, gz) / s;
          const snowLine = 60 - bw[5] * 42;

          if (h < WATER_LEVEL + 1.5 && bw[5] < 0.5) {
            c = lerp3(sandBase, cLo, bw[4] * 0.6);
          } else if (h >= snowLine && bw[2] < 0.5) {
            c = lerp3(cRock, snowCol, Math.min(1, (h - snowLine) / 10));
          } else if (slope > 0.55) {
            c = lerp3(cHi, cRock, Math.min(1, (slope - 0.55) / 0.65));
          } else if (h < 28) {
            c = lerp3(cLo, cHi, Math.min(1, (h - WATER_LEVEL) / 28));
          } else {
            c = lerp3(cHi, cRock, Math.min(1, (h - 28) / 34));
          }

          const shade = Math.max(0.58, Math.min(1.24, 1 + (-gx - gz) * 0.32));
          const contour = Math.floor(h / 10) !== Math.floor((h + Math.max(Math.abs(gx), Math.abs(gz))) / 10) ? 0.84 : 1;
          c = [c[0] * shade * contour, c[1] * shade * contour, c[2] * shade * contour];
        }
        const i = (py * RES + px) * 4;
        img.data[i] = Math.min(255, Math.max(0, c[0]));
        img.data[i + 1] = Math.min(255, Math.max(0, c[1]));
        img.data[i + 2] = Math.min(255, Math.max(0, c[2]));
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  /** Domain-warped swirling mountain mist texture + aligned density field for organic fog edges. */
  private renderFogBase() {
    const ctx = this.fogBase.getContext('2d')!;
    const img = ctx.createImageData(RES, RES);
    const nA = new Simplex2(307);
    const nB = new Simplex2(521);
    const rand = mulberry32(99);

    const mistDark: RGB = [174, 186, 186];
    const mistMid: RGB = [214, 219, 213];
    const mistLit: RGB = [244, 241, 232];

    for (let py = 0; py < RES; py++) {
      const v = py / RES;
      for (let px = 0; px < RES; px++) {
        const u = px / RES;
        const wx = (fbm(nA, u * 4.2, v * 4.2, 3) - 0.5) * 0.85;
        const wy = (fbm(nB, u * 4.2 + 11.3, v * 4.2 - 7.1, 3) - 0.5) * 0.85;
        const body = fbm(nA, u * 5.8 + wx, v * 5.8 + wy, 5);
        const wisp = fbm(nB, u * 12.5 - wy * 0.65, v * 12.5 + wx * 0.65, 3);
        const density = Math.max(0, Math.min(1, body * 0.72 + wisp * 0.28));

        if ((px & 1) === 0 && (py & 1) === 0) {
          this.fogNoise[(py >> 1) * FOG_RES + (px >> 1)] = density;
        }

        const c = density < 0.5
          ? lerp3(mistDark, mistMid, density * 2)
          : lerp3(mistMid, mistLit, (density - 0.5) * 2);
        const grain = (rand() - 0.5) * 7;
        const i = (py * RES + px) * 4;
        img.data[i] = Math.max(0, Math.min(255, c[0] + grain));
        img.data[i + 1] = Math.max(0, Math.min(255, c[1] + grain));
        img.data[i + 2] = Math.max(0, Math.min(255, c[2] + grain));
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  /** Seamless periodic soft mist puffs drifted gently over unexplored regions. */
  private renderWispTile() {
    const ctx = this.wispTile.getContext('2d')!;
    const rand = mulberry32(419);
    ctx.clearRect(0, 0, FOG_RES, FOG_RES);
    for (let k = 0; k < 42; k++) {
      const x = rand() * FOG_RES;
      const y = rand() * FOG_RES;
      const r = 22 + rand() * 44;
      const a = 0.08 + rand() * 0.11;
      for (const ox of [-FOG_RES, 0, FOG_RES]) {
        for (const oy of [-FOG_RES, 0, FOG_RES]) {
          const cx = x + ox, cy = y + oy;
          if (cx + r < 0 || cx - r > FOG_RES || cy + r < 0 || cy - r > FOG_RES) continue;
          const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
          g.addColorStop(0, `rgba(250, 248, 240, ${a})`);
          g.addColorStop(0.55, `rgba(235, 240, 238, ${a * 0.45})`);
          g.addColorStop(1, 'rgba(235, 240, 238, 0)');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  /** Vintage vignette, double border, and ink compass rose rendered above terrain & fog. */
  private renderFrame() {
    const ctx = this.frameOverlay.getContext('2d')!;
    ctx.clearRect(0, 0, RES, RES);

    const v = ctx.createRadialGradient(RES / 2, RES / 2, RES * 0.34, RES / 2, RES / 2, RES * 0.72);
    v.addColorStop(0, 'rgba(110, 82, 46, 0)');
    v.addColorStop(1, 'rgba(110, 82, 46, 0.25)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, RES, RES);

    // Subtle vintage cartographic border
    ctx.strokeStyle = 'rgba(72, 54, 34, 0.34)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(14, 14, RES - 28, RES - 28);
    ctx.strokeStyle = 'rgba(72, 54, 34, 0.18)';
    ctx.lineWidth = 1;
    ctx.strokeRect(19, 19, RES - 38, RES - 38);

    // Classic ink compass rose in top-right corner for orienting with HUD compass
    const cx = RES - 48, cy = 52;
    ctx.save();
    ctx.translate(cx, cy);
    const halo = ctx.createRadialGradient(0, 0, 8, 0, 0, 34);
    halo.addColorStop(0, 'rgba(243, 236, 220, 0.55)');
    halo.addColorStop(1, 'rgba(243, 236, 220, 0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(0, 0, 34, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(58, 44, 28, 0.55)';
    ctx.fillStyle = 'rgba(58, 44, 28, 0.62)';
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.arc(0, 0, 14, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -20); ctx.lineTo(4, 0); ctx.lineTo(0, -3); ctx.lineTo(-4, 0); ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(0, 18); ctx.lineTo(0, 3);
    ctx.moveTo(-18, 0); ctx.lineTo(18, 0);
    ctx.stroke();
    // Vermilion-inked North spearhead finial (wordless orientation matching HUD compass)
    ctx.fillStyle = 'rgba(182, 64, 44, 0.85)';
    ctx.beginPath();
    ctx.moveTo(0, -29);
    ctx.lineTo(3.5, -24);
    ctx.lineTo(0, -19.5);
    ctx.lineTo(-3.5, -24);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  private renderTrailBrush() {
    const rad = (EXPLORE_RADIUS / WORLD_SIZE) * FOG_RES;
    const dim = Math.ceil(rad) * 2 + 2;
    this.trailBrush.width = this.trailBrush.height = dim;
    const half = dim / 2;
    const ctx = this.trailBrush.getContext('2d')!;
    const g = ctx.createRadialGradient(half, half, rad * 0.45, half, half, rad);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.58)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(half, half, rad, 0, Math.PI * 2);
    ctx.fill();
  }

  private stampCell(gx: number, gz: number) {
    const ctx = this.trailCanvas.getContext('2d')!;
    const cx = ((gx + 0.5) / TRAIL_GRID) * FOG_RES;
    const cy = ((gz + 0.5) / TRAIL_GRID) * FOG_RES;
    const half = this.trailBrush.width / 2;
    ctx.drawImage(this.trailBrush, cx - half, cy - half);
  }

  /** Reveal a small area of fog around a world position the player passed through. */
  explore(x: number, z: number): boolean {
    const gx = Math.max(0, Math.min(TRAIL_GRID - 1, Math.floor(((x + HALF) / WORLD_SIZE) * TRAIL_GRID)));
    const gz = Math.max(0, Math.min(TRAIL_GRID - 1, Math.floor(((z + HALF) / WORLD_SIZE) * TRAIL_GRID)));
    const idx = gz * TRAIL_GRID + gx;
    if (this.trailGrid[idx]) return false;
    this.trailGrid[idx] = 1;
    this.stampCell(gx, gz);
    this.trailDirty = true;
    this.dirty = true;
    return true;
  }

  /** Compact Base64 bitset encoding of all visited cells for localStorage persistence. */
  serializeTrail(): string {
    if (!this.trailDirty) return this.trailCache;
    const bytes = new Uint8Array(TRAIL_BYTES);
    for (let i = 0; i < this.trailGrid.length; i++) {
      if (this.trailGrid[i]) bytes[i >> 3] |= 1 << (i & 7);
    }
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    this.trailCache = btoa(bin);
    this.trailDirty = false;
    return this.trailCache;
  }

  /** Restore explored cells from a serialized Base64 bitset. */
  loadTrail(encoded?: string) {
    if (!encoded) return;
    try {
      const bin = atob(encoded);
      if (bin.length !== TRAIL_BYTES) return;
      for (let b = 0; b < TRAIL_BYTES; b++) {
        const byte = bin.charCodeAt(b);
        if (!byte) continue;
        for (let bit = 0; bit < 8; bit++) {
          if (!(byte & (1 << bit))) continue;
          const idx = (b << 3) + bit;
          if (!this.trailGrid[idx]) {
            this.trailGrid[idx] = 1;
            this.stampCell(idx % TRAIL_GRID, Math.floor(idx / TRAIL_GRID));
          }
        }
      }
      this.trailCache = encoded;
      this.trailDirty = false;
      this.dirty = true;
    } catch {
      // Ignore malformed legacy save data
    }
  }

  /** Add a large shrine reveal. p=1 shows instantly, p=0 animates via advance(). */
  addReveal(x: number, z: number, r: number, p = 1) {
    this.reveals.push({ x, z, r, p });
    this.dirty = true;
  }

  /** Animate pending shrine reveals; returns true while still animating. */
  advance(dt: number): boolean {
    let animating = false;
    for (const r of this.reveals) {
      if (r.p < 1) {
        r.p = Math.min(1, r.p + dt / 1.8);
        animating = true;
        this.dirty = true;
      }
    }
    return animating;
  }

  /** Immediately complete any in-progress shrine reveal animations. */
  finishReveals() {
    for (const r of this.reveals) {
      if (r.p < 1) {
        r.p = 1;
        this.dirty = true;
      }
    }
  }

  reset() {
    this.reveals = [];
    this.trailGrid.fill(0);
    this.trailCanvas.getContext('2d')!.clearRect(0, 0, FOG_RES, FOG_RES);
    this.trailCache = '';
    this.trailDirty = true;
    this.dirty = true;
  }

  private rebuild() {
    const rm = this.revealMask.getContext('2d')!;
    rm.clearRect(0, 0, FOG_RES, FOG_RES);
    rm.save();
    rm.filter = 'blur(3px)';
    rm.drawImage(this.trailCanvas, 0, 0);
    rm.restore();

    for (const r of this.reveals) {
      const e = 1 - Math.pow(1 - r.p, 3);
      const [cx, cy] = this.toMap(r.x, r.z, FOG_RES);
      const rad = (r.r / WORLD_SIZE) * FOG_RES * e;
      if (rad < 1) continue;
      const g = rm.createRadialGradient(cx, cy, rad * 0.52, cx, cy, rad);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.55, 'rgba(255,255,255,0.55)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      rm.fillStyle = g;
      rm.beginPath();
      rm.arc(cx, cy, rad, 0, Math.PI * 2);
      rm.fill();
    }

    // Convert reveal coverage into a cloud-eroded fog opacity mask
    const revData = rm.getImageData(0, 0, FOG_RES, FOG_RES).data;
    const out = this.fogMaskImg.data;
    const noise = this.fogNoise;
    const total = FOG_RES * FOG_RES;
    for (let idx = 0; idx < total; idx++) {
      const p = idx << 2;
      const rev = revData[p + 3] / 255;
      let fogAlpha: number;
      if (rev <= 0.004) {
        fogAlpha = 1;
      } else if (rev >= 0.996) {
        fogAlpha = 0;
      } else {
        const threshold = 0.1 + noise[idx] * 0.8;
        const t = (1 - rev - (1 - threshold) * 0.62) / 0.44;
        fogAlpha = t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
      }
      out[p] = 255;
      out[p + 1] = 255;
      out[p + 2] = 255;
      out[p + 3] = Math.round(fogAlpha * 255);
    }
    this.fogMask.getContext('2d')!.putImageData(this.fogMaskImg, 0, 0);

    const fc = this.fogComp.getContext('2d')!;
    fc.globalCompositeOperation = 'source-over';
    fc.clearRect(0, 0, RES, RES);
    fc.drawImage(this.fogBase, 0, 0);
    fc.globalCompositeOperation = 'destination-in';
    fc.imageSmoothingEnabled = true;
    fc.drawImage(this.fogMask, 0, 0, RES, RES);
    fc.globalCompositeOperation = 'source-over';

    this.dirty = false;
  }

  private clampCenter(x: number, z: number, zoom: number): [number, number] {
    const maxOff = Math.max(0, HALF - HALF / zoom);
    return [
      Math.max(-maxOff, Math.min(maxOff, x)),
      Math.max(-maxOff, Math.min(maxOff, z)),
    ];
  }

  getView(): MapViewState {
    return { zoom: this.zoom, centerX: this.centerX, centerZ: this.centerZ };
  }

  getTargetView(): MapViewState {
    return { zoom: this.targetZoom, centerX: this.targetCenterX, centerZ: this.targetCenterZ };
  }

  isZoomed(): boolean {
    return this.targetZoom > 1.05;
  }

  resetView(immediate = false) {
    this.targetZoom = GameMap.MIN_ZOOM;
    this.targetCenterX = 0;
    this.targetCenterZ = 0;
    if (immediate) {
      this.zoom = GameMap.MIN_ZOOM;
      this.centerX = 0;
      this.centerZ = 0;
    }
  }

  setView(zoom: number, cx: number, cz: number, immediate = false) {
    const zClamped = Math.max(GameMap.MIN_ZOOM, Math.min(GameMap.MAX_ZOOM, zoom));
    const [ccx, ccz] = this.clampCenter(cx, cz, zClamped);
    this.targetZoom = zClamped;
    this.targetCenterX = ccx;
    this.targetCenterZ = ccz;
    if (immediate) {
      this.zoom = zClamped;
      this.centerX = ccx;
      this.centerZ = ccz;
    }
  }

  focusOn(wx: number, wz: number, zoom = GameMap.REGIONAL_ZOOM, immediate = false) {
    this.setView(zoom, wx, wz, immediate);
  }

  canvasToWorld(canvas: HTMLCanvasElement, clientX: number, clientY: number, useTarget = false): [number, number] {
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return [this.centerX, this.centerZ];
    const nx = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const ny = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    const z = useTarget ? this.targetZoom : this.zoom;
    const cx = useTarget ? this.targetCenterX : this.centerX;
    const cz = useTarget ? this.targetCenterZ : this.centerZ;
    const span = WORLD_SIZE / z;
    return [cx + (nx - 0.5) * span, cz + (ny - 0.5) * span];
  }

  zoomAroundClientPoint(
    canvas: HTMLCanvasElement,
    clientX: number,
    clientY: number,
    nextZoom: number,
    immediate = false,
  ) {
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const nx = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const ny = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    const [wx, wz] = this.canvasToWorld(canvas, clientX, clientY, !immediate);
    const zClamped = Math.max(GameMap.MIN_ZOOM, Math.min(GameMap.MAX_ZOOM, nextZoom));
    const newSpan = WORLD_SIZE / zClamped;
    const newCx = wx - (nx - 0.5) * newSpan;
    const newCz = wz - (ny - 0.5) * newSpan;
    this.setView(zClamped, newCx, newCz, immediate);
  }

  panByCanvasDelta(canvas: HTMLCanvasElement, dxCss: number, dyCss: number) {
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || this.zoom <= 1.001) return;
    const span = WORLD_SIZE / this.zoom;
    const wx = this.centerX - (dxCss / rect.width) * span;
    const wz = this.centerZ - (dyCss / rect.height) * span;
    const [cx, cz] = this.clampCenter(wx, wz, this.zoom);
    this.centerX = this.targetCenterX = cx;
    this.centerZ = this.targetCenterZ = cz;
  }

  stepView(dt: number) {
    const k = 1 - Math.exp(-Math.min(0.1, dt) * 12);
    this.zoom += (this.targetZoom - this.zoom) * k;
    this.centerX += (this.targetCenterX - this.centerX) * k;
    this.centerZ += (this.targetCenterZ - this.centerZ) * k;
    if (Math.abs(this.targetZoom - this.zoom) < 0.002) this.zoom = this.targetZoom;
    if (Math.abs(this.targetCenterX - this.centerX) < 0.05) this.centerX = this.targetCenterX;
    if (Math.abs(this.targetCenterZ - this.centerZ) < 0.05) this.centerZ = this.targetCenterZ;
    const [cx, cz] = this.clampCenter(this.centerX, this.centerZ, this.zoom);
    this.centerX = cx;
    this.centerZ = cz;
  }

  toMap(x: number, z: number, size: number): [number, number] {
    return [((x + HALF) / WORLD_SIZE) * size, ((z + HALF) / WORLD_SIZE) * size];
  }

  worldToCanvas(x: number, z: number, size: number): [number, number] {
    const span = WORLD_SIZE / this.zoom;
    const left = this.centerX - span * 0.5;
    const top = this.centerZ - span * 0.5;
    return [((x - left) / span) * size, ((z - top) / span) * size];
  }

  draw(
    canvas: HTMLCanvasElement,
    towers: Tower[],
    time = 0,
    visitedBiomes?: ReadonlySet<number>,
    wonders: Wonder[] = [],
    playerPose?: MapPlayerPose,
  ) {
    if (this.dirty) this.rebuild();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const css = canvas.clientWidth;
    const size = Math.round(css * dpr);
    if (size <= 0) return;
    if (canvas.width !== size) { canvas.width = size; canvas.height = size; }
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = true;

    const span = WORLD_SIZE / this.zoom;
    const u0 = (this.centerX - span * 0.5 + HALF) / WORLD_SIZE;
    const v0 = (this.centerZ - span * 0.5 + HALF) / WORLD_SIZE;
    const uvSpan = span / WORLD_SIZE;

    // 1. Underlying topographic parchment terrain (colored by biome)
    ctx.drawImage(this.terrainImg, u0 * RES, v0 * RES, uvSpan * RES, uvSpan * RES, 0, 0, size, size);

    // 2. Layered fog of war over unexplored areas
    ctx.drawImage(this.fogComp, u0 * RES, v0 * RES, uvSpan * RES, uvSpan * RES, 0, 0, size, size);

    // 3. Gently drifting mist wisps clipped strictly to the fogged regions
    const wc = this.wispComp.getContext('2d')!;
    wc.globalCompositeOperation = 'source-over';
    wc.clearRect(0, 0, FOG_RES, FOG_RES);
    const ox = ((time * 7.5) % FOG_RES + FOG_RES) % FOG_RES;
    const oy = ((time * 3.2) % FOG_RES + FOG_RES) % FOG_RES;
    wc.drawImage(this.wispTile, ox, oy);
    wc.drawImage(this.wispTile, ox - FOG_RES, oy);
    wc.drawImage(this.wispTile, ox, oy - FOG_RES);
    wc.drawImage(this.wispTile, ox - FOG_RES, oy - FOG_RES);
    wc.globalCompositeOperation = 'destination-in';
    wc.drawImage(this.fogMask, 0, 0);
    wc.globalCompositeOperation = 'source-over';

    ctx.save();
    ctx.globalAlpha = 0.4;
    ctx.drawImage(this.wispComp, u0 * FOG_RES, v0 * FOG_RES, uvSpan * FOG_RES, uvSpan * FOG_RES, 0, 0, size, size);
    ctx.restore();

    // 4. Luminous resonance wave ring while a shrine is parting the fog
    const u = size / 100;
    const mu = u * (1 + (this.zoom - 1) * 0.16);
    const margin = 12 * mu;
    for (const r of this.reveals) {
      if (r.p <= 0 || r.p >= 1) continue;
      const e = 1 - Math.pow(1 - r.p, 3);
      const [cx, cy] = this.worldToCanvas(r.x, r.z, size);
      const rad = (r.r / span) * size * e * 0.9;
      if (rad < 2) continue;
      const fade = (1 - r.p) * Math.min(1, r.p * 6);
      ctx.save();
      ctx.strokeStyle = `rgba(110, 232, 255, ${(fade * 0.72).toFixed(3)})`;
      ctx.lineWidth = Math.max(1.5, 0.75 * mu);
      ctx.shadowColor = 'rgba(79, 227, 255, 0.85)';
      ctx.shadowBlur = 1.6 * mu;
      ctx.beginPath();
      ctx.arc(cx, cy, rad, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // 5. Cartographic border, vignette, and compass rose anchored in screen space
    ctx.drawImage(this.frameOverlay, 0, 0, size, size);

    // 6. Subtle resonated shrine triangles
    ctx.save();
    for (const t of towers) {
      if (!t.activated) continue;
      const [x, y] = this.worldToCanvas(t.def.x, t.def.z, size);
      if (x < -margin || x > size + margin || y < -margin || y > size + margin) continue;
      const r = 1.25 * mu;
      ctx.fillStyle = 'rgba(34, 130, 150, 0.85)';
      ctx.strokeStyle = 'rgba(243, 234, 214, 0.85)';
      ctx.lineWidth = Math.max(1, 0.3 * mu);
      ctx.beginPath();
      ctx.moveTo(x, y - r * 1.15);
      ctx.lineTo(x + r, y + r * 0.85);
      ctx.lineTo(x - r, y + r * 0.85);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();

    // 7. Discovered Wonder landmarks (delicate vermilion-ink 4-point star + illustrated glyph)
    if (wonders.length) {
      ctx.save();
      for (const w of wonders) {
        if (!w.discovered) continue;
        const [x, y] = this.worldToCanvas(w.def.x, w.def.z, size);
        if (x < -margin || x > size + margin || y < -margin || y > size + margin) continue;
        const r = 1.28 * mu;
        ctx.fillStyle = 'rgba(176, 62, 42, 0.9)';
        ctx.strokeStyle = 'rgba(248, 240, 222, 0.9)';
        ctx.lineWidth = Math.max(1, 0.24 * mu);
        ctx.beginPath();
        ctx.moveTo(x, y - r);
        ctx.lineTo(x + r * 0.4, y - r * 0.4);
        ctx.lineTo(x + r, y);
        ctx.lineTo(x + r * 0.4, y + r * 0.4);
        ctx.lineTo(x, y + r);
        ctx.lineTo(x - r * 0.4, y + r * 0.4);
        ctx.lineTo(x - r, y);
        ctx.lineTo(x - r * 0.4, y - r * 0.4);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        this.drawWonderGlyph(ctx, w.def.id, x, y + 2.45 * mu, mu);
      }
      ctx.restore();
    }

    // 8. Subtle hand-inked biome crest watermarks for visited biomes (wordless atlas)
    ctx.save();
    for (const b of BIOMES) {
      if (visitedBiomes && !visitedBiomes.has(b.index)) continue;
      const [x, y] = this.worldToCanvas(b.labelX, b.labelZ, size);
      if (x < -margin || x > size + margin || y < -margin || y > size + margin) continue;
      this.drawBiomeWatermark(ctx, b.id, x, y, mu);
    }
    ctx.restore();

    // 9. Explorer current position & facing direction (drawn crisp above landmarks)
    if (playerPose) {
      const [px, py] = this.worldToCanvas(playerPose.x, playerPose.z, size);
      if (px >= -margin && px <= size + margin && py >= -margin && py <= size + margin) {
        this.drawPlayerMarker(ctx, px, py, playerPose.facing, playerPose.camYaw, time, mu);
      }
    }
  }

  /** Draws the explorer's live position, camera sight cone, and facing arrowhead. */
  private drawPlayerMarker(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    facing: number,
    camYaw: number,
    time: number,
    u: number,
  ) {
    ctx.save();
    ctx.translate(x, y);

    // Subtle translucent camera sightline cone oriented along (-sin(camYaw), -cos(camYaw))
    ctx.save();
    ctx.rotate(-camYaw);
    const coneR = 6.2 * u;
    const halfAng = 0.52; // ~60° view sector
    const coneGrad = ctx.createRadialGradient(0, 0, 0.5 * u, 0, 0, coneR);
    coneGrad.addColorStop(0, 'rgba(255, 248, 224, 0.48)');
    coneGrad.addColorStop(0.55, 'rgba(232, 101, 60, 0.16)');
    coneGrad.addColorStop(1, 'rgba(232, 101, 60, 0)');
    ctx.fillStyle = coneGrad;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, coneR, -Math.PI / 2 - halfAng, -Math.PI / 2 + halfAng);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Gentle expanding location halo so the explorer is immediately easy to spot
    const pulse = (time * 0.52) % 1;
    const ringR = (1.6 + pulse * 2.8) * u;
    const ringA = (1 - pulse) * 0.62;
    ctx.strokeStyle = `rgba(255, 248, 228, ${ringA.toFixed(3)})`;
    ctx.lineWidth = Math.max(1.2, 0.38 * u);
    ctx.beginPath();
    ctx.arc(0, 0, ringR, 0, Math.PI * 2);
    ctx.stroke();

    // Crisp triangular directional arrow aligned to player.facing ((sin(facing), cos(facing)))
    ctx.save();
    ctx.rotate(Math.PI - facing);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    const tipY = -2.15 * u;
    const wingX = 1.45 * u;
    const wingY = 1.38 * u;
    const notchY = 0.68 * u;

    ctx.beginPath();
    ctx.moveTo(0, tipY);
    ctx.lineTo(wingX, wingY);
    ctx.lineTo(0, notchY);
    ctx.lineTo(-wingX, wingY);
    ctx.closePath();

    // Soft dark ink drop shadow + warm ivory halo border for readability on all biomes
    ctx.shadowColor = 'rgba(18, 28, 32, 0.52)';
    ctx.shadowBlur = 1.1 * u;
    ctx.strokeStyle = '#fffdf4';
    ctx.lineWidth = Math.max(2, 0.66 * u);
    ctx.stroke();

    ctx.shadowBlur = 0;
    ctx.fillStyle = '#e8653c';
    ctx.fill();

    ctx.strokeStyle = 'rgba(28, 38, 42, 0.85)';
    ctx.lineWidth = Math.max(1, 0.24 * u);
    ctx.stroke();

    // Bright ivory core dot for crisp precision
    ctx.fillStyle = '#fffdf4';
    ctx.beginPath();
    ctx.arc(0, -0.05 * u, 0.36 * u, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
    ctx.restore();
  }

  /** Hand-inked miniature cartographic illustration for each discovered Wonder. */
  private drawWonderGlyph(ctx: CanvasRenderingContext2D, id: string, x: number, y: number, u: number) {
    ctx.save();
    ctx.translate(x, y);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const s = 1.35 * u;

    // Soft parchment halo behind the miniature icon
    ctx.fillStyle = 'rgba(246, 238, 220, 0.72)';
    ctx.beginPath();
    ctx.arc(0, 0, s * 1.15, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(148, 42, 26, 0.92)';
    ctx.fillStyle = 'rgba(176, 62, 42, 0.22)';
    ctx.lineWidth = Math.max(1.1, 0.28 * u);

    if (id === 'sakura') {
      // 5-petal blossom cluster
      for (let i = 0; i < 5; i++) {
        const a = (i * Math.PI * 2) / 5 - Math.PI / 2;
        ctx.beginPath();
        ctx.arc(Math.cos(a) * s * 0.42, Math.sin(a) * s * 0.42, s * 0.34, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    } else if (id === 'arch') {
      // Stone bridge arch spanning water wave
      ctx.beginPath();
      ctx.arc(0, s * 0.2, s * 0.72, Math.PI, 0);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, s * 0.25, s * 0.44, Math.PI, 0);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-s * 0.85, s * 0.45);
      ctx.quadraticCurveTo(-s * 0.3, s * 0.22, 0, s * 0.45);
      ctx.quadraticCurveTo(s * 0.3, s * 0.68, s * 0.85, s * 0.45);
      ctx.stroke();
    } else if (id === 'bones') {
      // Leviathan ribcage arcs along spine
      ctx.beginPath();
      ctx.moveTo(-s * 0.78, s * 0.32);
      ctx.quadraticCurveTo(0, s * 0.12, s * 0.78, s * 0.32);
      ctx.stroke();
      for (const ox of [-0.48, 0, 0.48]) {
        ctx.beginPath();
        ctx.arc(ox * s, s * 0.22, s * 0.45, Math.PI * 1.12, Math.PI * 1.88);
        ctx.stroke();
      }
    } else if (id === 'gate') {
      // Triangular sunken stone gate + floating diamond
      ctx.beginPath();
      ctx.moveTo(-s * 0.65, s * 0.65);
      ctx.lineTo(0, -s * 0.72);
      ctx.lineTo(s * 0.65, s * 0.65);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.2);
      ctx.lineTo(s * 0.2, s * 0.1);
      ctx.lineTo(0, s * 0.4);
      ctx.lineTo(-s * 0.2, s * 0.1);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if (id === 'spirittree') {
      // Tall ancient tree canopy + flared roots
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.1);
      ctx.lineTo(0, s * 0.65);
      ctx.moveTo(0, s * 0.4);
      ctx.lineTo(-s * 0.45, s * 0.7);
      ctx.moveTo(0, s * 0.4);
      ctx.lineTo(s * 0.45, s * 0.7);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(0, -s * 0.28, s * 0.78, s * 0.42, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else if (id === 'ice_spire') {
      // Faceted glacier spire cluster
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.82);
      ctx.lineTo(s * 0.34, s * 0.65);
      ctx.lineTo(-s * 0.34, s * 0.65);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-s * 0.56, s * 0.65);
      ctx.lineTo(-s * 0.38, -s * 0.25);
      ctx.moveTo(s * 0.56, s * 0.65);
      ctx.lineTo(s * 0.38, -s * 0.25);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Delicate low-contrast sepia ink crest marking a visited biome region. */
  private drawBiomeWatermark(ctx: CanvasRenderingContext2D, id: string, x: number, y: number, u: number) {
    ctx.save();
    ctx.translate(x, y);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const s = 2.4 * u;

    // Subtle parchment glow for legibility over terrain contours
    const g = ctx.createRadialGradient(0, 0, s * 0.15, 0, 0, s * 1.35);
    g.addColorStop(0, 'rgba(246, 238, 220, 0.55)');
    g.addColorStop(1, 'rgba(246, 238, 220, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, s * 1.35, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(54, 40, 24, 0.52)';
    ctx.lineWidth = Math.max(1.1, 0.3 * u);

    if (id === 'meadow') {
      // Rolling hills + tiny blossom
      ctx.beginPath();
      ctx.moveTo(-s, s * 0.45);
      ctx.quadraticCurveTo(-s * 0.35, -s * 0.25, s * 0.2, s * 0.45);
      ctx.moveTo(-s * 0.25, s * 0.45);
      ctx.quadraticCurveTo(s * 0.35, -s * 0.12, s, s * 0.45);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(-s * 0.3, -s * 0.38, s * 0.16, 0, Math.PI * 2);
      ctx.stroke();
    } else if (id === 'karst') {
      // Twin karst limestone pillars + mist wave
      ctx.beginPath();
      ctx.moveTo(-s * 0.72, s * 0.45);
      ctx.lineTo(-s * 0.42, -s * 0.62);
      ctx.lineTo(-s * 0.12, s * 0.45);
      ctx.moveTo(s * 0.05, s * 0.45);
      ctx.lineTo(s * 0.42, -s * 0.8);
      ctx.lineTo(s * 0.76, s * 0.45);
      ctx.stroke();
    } else if (id === 'canyon') {
      // Stepped flat-top red mesas
      ctx.beginPath();
      ctx.moveTo(-s * 0.9, s * 0.5);
      ctx.lineTo(-s * 0.65, -s * 0.35);
      ctx.lineTo(-s * 0.05, -s * 0.35);
      ctx.lineTo(s * 0.1, s * 0.1);
      ctx.lineTo(s * 0.32, -s * 0.55);
      ctx.lineTo(s * 0.78, -s * 0.55);
      ctx.lineTo(s * 0.92, s * 0.5);
      ctx.stroke();
    } else if (id === 'maple') {
      // Stylized autumn maple leaf over lake line
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.72);
      ctx.lineTo(s * 0.22, -s * 0.15);
      ctx.lineTo(s * 0.72, -s * 0.22);
      ctx.lineTo(s * 0.32, s * 0.15);
      ctx.lineTo(s * 0.45, s * 0.48);
      ctx.lineTo(0, s * 0.3);
      ctx.lineTo(-s * 0.45, s * 0.48);
      ctx.lineTo(-s * 0.32, s * 0.15);
      ctx.lineTo(-s * 0.72, -s * 0.22);
      ctx.lineTo(-s * 0.22, -s * 0.15);
      ctx.closePath();
      ctx.stroke();
    } else if (id === 'mistwood') {
      // Wide canopy + mist bands
      ctx.beginPath();
      ctx.arc(0, -s * 0.15, s * 0.58, Math.PI, 0);
      ctx.moveTo(0, -s * 0.15);
      ctx.lineTo(0, s * 0.52);
      ctx.moveTo(-s * 0.82, s * 0.52);
      ctx.lineTo(s * 0.82, s * 0.52);
      ctx.moveTo(-s * 0.55, s * 0.22);
      ctx.lineTo(s * 0.55, s * 0.22);
      ctx.stroke();
    } else if (id === 'snow') {
      // Crisp alpine peak + aurora arc
      ctx.beginPath();
      ctx.moveTo(-s * 0.85, s * 0.5);
      ctx.lineTo(0, -s * 0.55);
      ctx.lineTo(s * 0.85, s * 0.5);
      ctx.moveTo(-s * 0.32, -s * 0.12);
      ctx.lineTo(0, s * 0.04);
      ctx.lineTo(s * 0.32, -s * 0.12);
      ctx.moveTo(-s * 0.7, -s * 0.62);
      ctx.quadraticCurveTo(0, -s * 0.98, s * 0.7, -s * 0.62);
      ctx.stroke();
    }
    ctx.restore();
  }
}
