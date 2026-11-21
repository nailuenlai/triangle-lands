import { Terrain, HALF, WORLD_SIZE, WATER_LEVEL } from './terrain';
import { mulberry32, Simplex2 } from './noise';
import { EXPLORE_RADIUS, type Tower } from './world';

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

/**
 * Topographic parchment map blanketed in layered fog of war.
 * Passing through terrain parts a small ribbon of mist (without showing
 * the player's current position), while resonating with an ancient shrine
 * sweeps away a wide expanse of fog.
 */
export class GameMap {
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
    const deep: RGB = [74, 128, 150], shallow: RGB = [136, 184, 196];
    const sand: RGB = [226, 210, 160], grassLo: RGB = [150, 178, 104], grassHi: RGB = [118, 146, 88];
    const rock: RGB = [158, 146, 128], snow: RGB = [246, 244, 238];
    for (let py = 0; py < RES; py++) {
      for (let px = 0; px < RES; px++) {
        const x = -HALF + (px + 0.5) * s, z = -HALF + (py + 0.5) * s;
        const h = terrain.height(x, z);
        let c: RGB;
        if (h < WATER_LEVEL) {
          c = lerp3(shallow, deep, Math.min(1, (WATER_LEVEL - h) / 12));
        } else {
          if (h < WATER_LEVEL + 1.5) c = sand;
          else if (h < 30) c = lerp3(grassLo, grassHi, (h - WATER_LEVEL) / 30);
          else if (h < 62) c = lerp3(grassHi, rock, (h - 30) / 32);
          else c = lerp3(rock, snow, Math.min(1, (h - 62) / 12));
          const gx = terrain.height(x + s, z) - h;
          const gz = terrain.height(x, z + s) - h;
          const shade = Math.max(0.55, Math.min(1.25, 1 + (-gx - gz) * 0.35));
          const contour = Math.floor(h / 10) !== Math.floor((h + Math.max(Math.abs(gx), Math.abs(gz))) / 10) ? 0.82 : 1;
          c = [c[0] * shade * contour, c[1] * shade * contour, c[2] * shade * contour];
        }
        const i = (py * RES + px) * 4;
        img.data[i] = c[0]; img.data[i + 1] = c[1]; img.data[i + 2] = c[2]; img.data[i + 3] = 255;
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
    ctx.font = '600 11px "Noto Serif TC", serif';
    ctx.textAlign = 'center';
    ctx.fillText('北', 0, -24);
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

  toMap(x: number, z: number, size: number): [number, number] {
    return [((x + HALF) / WORLD_SIZE) * size, ((z + HALF) / WORLD_SIZE) * size];
  }

  draw(canvas: HTMLCanvasElement, towers: Tower[], time = 0) {
    if (this.dirty) this.rebuild();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const css = canvas.clientWidth;
    const size = Math.round(css * dpr);
    if (size <= 0) return;
    if (canvas.width !== size) { canvas.width = size; canvas.height = size; }
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = true;

    // 1. Underlying topographic terrain
    ctx.drawImage(this.terrainImg, 0, 0, size, size);

    // 2. Layered fog of war over unexplored areas
    ctx.drawImage(this.fogComp, 0, 0, size, size);

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
    ctx.drawImage(this.wispComp, 0, 0, size, size);
    ctx.restore();

    // 4. Luminous resonance wave ring while a shrine is parting the fog
    const u = size / 100;
    for (const r of this.reveals) {
      if (r.p <= 0 || r.p >= 1) continue;
      const e = 1 - Math.pow(1 - r.p, 3);
      const [cx, cy] = this.toMap(r.x, r.z, size);
      const rad = (r.r / WORLD_SIZE) * size * e * 0.9;
      if (rad < 2) continue;
      const fade = (1 - r.p) * Math.min(1, r.p * 6);
      ctx.save();
      ctx.strokeStyle = `rgba(110, 232, 255, ${(fade * 0.72).toFixed(3)})`;
      ctx.lineWidth = Math.max(1.5, 0.75 * u);
      ctx.shadowColor = 'rgba(79, 227, 255, 0.85)';
      ctx.shadowBlur = 1.6 * u;
      ctx.beginPath();
      ctx.arc(cx, cy, rad, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // 5. Cartographic border, vignette, and compass rose above the fog
    ctx.drawImage(this.frameOverlay, 0, 0, size, size);

    // 6. Subtle hand-inked region names only for already-resonated shrines (never player GPS)
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = `600 ${2.15 * u}px "Noto Serif TC", serif`;
    for (const t of towers) {
      if (!t.activated) continue;
      const [x, y] = this.toMap(t.def.x, t.def.z, size);
      const regionName = t.def.name.replace(/之碑$/, '');
      ctx.fillStyle = 'rgba(243, 234, 214, 0.65)';
      ctx.fillText(regionName, x, y + 0.35 * u);
      ctx.fillStyle = 'rgba(48, 36, 22, 0.78)';
      ctx.fillText(regionName, x, y);
    }
    ctx.restore();
  }
}
