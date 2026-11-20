import { Terrain, HALF, WORLD_SIZE, WATER_LEVEL } from './terrain';
import { mulberry32 } from './noise';
import type { Tower } from './world';

const RES = 512;

interface Reveal { x: number; z: number; r: number; p: number; }

type RGB = [number, number, number];
const lerp3 = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Parchment map with a fog-of-war mask that towers punch holes into. */
export class GameMap {
  private terrainImg = document.createElement('canvas');
  private paper = document.createElement('canvas');
  private mask = document.createElement('canvas');
  private comp = document.createElement('canvas');
  private reveals: Reveal[] = [];
  private dirty = true;

  constructor(terrain: Terrain) {
    for (const c of [this.terrainImg, this.paper, this.mask, this.comp]) { c.width = c.height = RES; }
    this.renderTerrain(terrain);
    this.renderPaper();
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

  private renderPaper() {
    const ctx = this.paper.getContext('2d')!;
    ctx.fillStyle = '#e8dcc0';
    ctx.fillRect(0, 0, RES, RES);
    const rand = mulberry32(99);
    for (let k = 0; k < 6000; k++) {
      ctx.fillStyle = `rgba(${90 + rand() * 40},${70 + rand() * 30},${40},${rand() * 0.06})`;
      const r = rand() * 3;
      ctx.fillRect(rand() * RES, rand() * RES, r, r);
    }
    const v = ctx.createRadialGradient(RES / 2, RES / 2, RES * 0.3, RES / 2, RES / 2, RES * 0.72);
    v.addColorStop(0, 'rgba(120,90,50,0)');
    v.addColorStop(1, 'rgba(120,90,50,0.28)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, RES, RES);

    // Subtle vintage cartographic border
    ctx.strokeStyle = 'rgba(78, 58, 34, 0.28)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(14, 14, RES - 28, RES - 28);
    ctx.strokeStyle = 'rgba(78, 58, 34, 0.14)';
    ctx.lineWidth = 1;
    ctx.strokeRect(19, 19, RES - 38, RES - 38);

    // Classic ink compass rose in top-right corner for orienting with HUD compass
    const cx = RES - 48, cy = 52;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = 'rgba(68, 50, 30, 0.42)';
    ctx.fillStyle = 'rgba(68, 50, 30, 0.48)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(0, 0, 14, 0, Math.PI * 2);
    ctx.stroke();
    // North-south & east-west needles
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

  /** Add a reveal. p=1 shows instantly, p=0 animates via advance(). */
  addReveal(x: number, z: number, r: number, p = 1) {
    this.reveals.push({ x, z, r, p });
    this.dirty = true;
  }

  /** Animate pending reveals; returns true while still animating. */
  advance(dt: number): boolean {
    let animating = false;
    for (const r of this.reveals) {
      if (r.p < 1) { r.p = Math.min(1, r.p + dt / 1.8); animating = true; this.dirty = true; }
    }
    return animating;
  }

  reset() { this.reveals = []; this.dirty = true; }

  private rebuild() {
    const m = this.mask.getContext('2d')!;
    m.clearRect(0, 0, RES, RES);
    for (const r of this.reveals) {
      const e = 1 - Math.pow(1 - r.p, 3);
      const [cx, cy] = this.toMap(r.x, r.z, RES);
      const rad = (r.r / WORLD_SIZE) * RES * e;
      if (rad < 1) continue;
      const g = m.createRadialGradient(cx, cy, rad * 0.7, cx, cy, rad);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      m.fillStyle = g;
      m.beginPath(); m.arc(cx, cy, rad, 0, Math.PI * 2); m.fill();
    }
    const c = this.comp.getContext('2d')!;
    c.globalCompositeOperation = 'source-over';
    c.clearRect(0, 0, RES, RES);
    c.drawImage(this.terrainImg, 0, 0);
    c.globalCompositeOperation = 'destination-in';
    c.drawImage(this.mask, 0, 0);
    c.globalCompositeOperation = 'source-over';
    this.dirty = false;
  }

  toMap(x: number, z: number, size: number): [number, number] {
    return [((x + HALF) / WORLD_SIZE) * size, ((z + HALF) / WORLD_SIZE) * size];
  }

  draw(canvas: HTMLCanvasElement, towers: Tower[]) {
    if (this.dirty) this.rebuild();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const css = canvas.clientWidth;
    const size = Math.round(css * dpr);
    if (canvas.width !== size) { canvas.width = size; canvas.height = size; }
    const ctx = canvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.paper, 0, 0, size, size);
    ctx.drawImage(this.comp, 0, 0, size, size);

    const u = size / 100;
    const anyActivated = towers.some((t) => t.activated);

    if (!anyActivated) {
      ctx.save();
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(68, 50, 30, 0.62)';
      ctx.font = `600 ${3.1 * u}px "Noto Serif TC", serif`;
      ctx.fillText('尚未描繪地貌', size * 0.5, size * 0.48);
      ctx.fillStyle = 'rgba(68, 50, 30, 0.45)';
      ctx.font = `600 ${2.0 * u}px "Noto Serif TC", serif`;
      ctx.fillText('漫步山野，尋訪古碑共鳴以繪入山水', size * 0.5, size * 0.54);
      ctx.restore();
      return;
    }

    // Subtle hand-inked region names only for already-resonated areas (no player GPS, no unfound landmarks)
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = `600 ${2.15 * u}px "Noto Serif TC", serif`;
    for (const t of towers) {
      if (!t.activated) continue;
      const [x, y] = this.toMap(t.def.x, t.def.z, size);
      const regionName = t.def.name.replace(/之碑$/, '');
      ctx.fillStyle = 'rgba(243, 234, 214, 0.65)';
      ctx.fillText(regionName, x, y + 0.35 * u);
      ctx.fillStyle = 'rgba(48, 36, 22, 0.72)';
      ctx.fillText(regionName, x, y);
    }
    ctx.restore();
  }
}
