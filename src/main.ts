import * as THREE from 'three';
import './style.css';
import { Terrain, WATER_LEVEL, smoothstep, type Flatten } from './terrain';
import {
  createSky, createTerrainMesh, createWater, createVegetation, createClouds,
  Tower, TOWER_DEFS, REVEAL_RADIUS, START_POS, COLORS,
} from './world';
import { Player, type WorldQuery } from './player';
import { Input } from './input';
import { GameMap } from './map';
import { NatureAudio } from './audio';
import { Particles } from './fx';
import { createWilds, RingCourse, type CourseEvent } from './collectibles';

// ------------------------------------------------------------ DOM
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('scene');
const hud = $('hud');
const titleScreen = $('title-screen');
const mapOverlay = $('map-overlay');
const mapCanvas = $<HTMLCanvasElement>('map-canvas');
const btnInteract = $('btn-interact');
const btnInteractLabel = $('btn-interact-label');
const btnAudio = $('btn-audio');
const iconAudioOn = $('icon-audio-on');
const iconAudioOff = $('icon-audio-off');
const toastEl = $('toast');
const towerNum = $('tower-count-num');
const orbNum = $('orb-count-num');
const orbTotal = $('orb-count-total');
const orbPill = $('orb-count');
const compassStrip = $('compass-strip');
const hintEl = $('hint');
const staminaEl = $('stamina');
const staminaFg = document.getElementById('stamina-fg') as unknown as SVGCircleElement;
const staminaBg = document.getElementById('stamina-bg') as unknown as SVGCircleElement;
const speedlines = $('speedlines');
const trialEl = $('trial');
const trialName = $('trial-name');
const trialCount = $('trial-count');
const trialBar = $('trial-bar');
const floatLayer = $('float-layer');
const glideHint = $('glide-hint');

// ------------------------------------------------------------ Save & Settings
const SAVE_KEY = 'triangle-explorer-v1';
const MUTE_KEY = 'triangle-explorer-muted';
interface SaveData {
  discovered: number[];
  activated: number[];
  pos?: [number, number, number];
  orbs?: number[];
  courses?: number[];
  tips?: string[];
}
const loadSave = (): SaveData | null => {
  try { return JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch { return null; }
};

const audio = new NatureAudio(localStorage.getItem(MUTE_KEY) === '1');
function syncAudioUI() {
  const m = audio.muted;
  btnAudio.classList.toggle('muted', m);
  iconAudioOn.hidden = m;
  iconAudioOff.hidden = !m;
}
syncAudioUI();

// ------------------------------------------------------------ Renderer / scene
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(COLORS.horizon, 70, 460);
const camera = new THREE.PerspectiveCamera(62, 1, 0.3, 1500);

const sunDir = new THREE.Vector3(0.45, 0.6, 0.35).normalize();
scene.add(new THREE.HemisphereLight('#d8ecff', '#6b5a3a', 1.5));
const sun = new THREE.DirectionalLight('#fff0d4', 2.4);
sun.position.copy(sunDir).multiplyScalar(100);
scene.add(sun);

const flats: Flatten[] = [
  ...TOWER_DEFS.map((d) => ({ x: d.x, z: d.z, r: 12 })),
  { ...START_POS, r: 15 },
];
const terrain = new Terrain(flats);
const sky = createSky(sunDir);
scene.add(sky, createTerrainMesh(terrain), createWater());
scene.add(createVegetation(terrain, flats.map((f) => ({ x: f.x, z: f.z, r: f.r * 0.72 }))));
const clouds = createClouds();
scene.add(clouds);

const towers = TOWER_DEFS.map((d, i) => new Tower(d, i, terrain.height(d.x, d.z)));
towers.forEach((t) => scene.add(t.group));

const wilds = createWilds(terrain, towers.map((t) => ({ x: t.def.x, z: t.def.z, base: t.base })), START_POS);
const { orbs, updrafts, courses } = wilds;
scene.add(orbs.group);
updrafts.forEach((u) => scene.add(u.group));
courses.forEach((c) => scene.add(c.group));

const sparkles = new Particles(900, true);
const dust = new Particles(400, false);
scene.add(sparkles.points, dust.points);

const player = new Player();
scene.add(player.model, player.shadow);

const gameMap = new GameMap(terrain);

// ------------------------------------------------------------ World physics queries
const world: WorldQuery = {
  ground(x, z) {
    let h = terrain.height(x, z);
    for (const t of towers) {
      const d = Math.hypot(x - t.def.x, z - t.def.z);
      if (d < 6.5) {
        const outer = smoothstep(6.4, 5.5, d) * 0.42;
        const inner = smoothstep(4.3, 3.65, d) * 0.40;
        h = Math.max(h, t.base + outer + inner);
      }
    }
    return h;
  },
  collide(p) {
    for (const t of towers) {
      if (Math.hypot(p.x - t.def.x, p.z - t.def.z) > 8) continue;
      for (const pil of t.pillars) {
        const dx = p.x - pil.x, dz = p.z - pil.z;
        const d = Math.hypot(dx, dz);
        if (d < pil.r && d > 1e-4) {
          p.x = pil.x + (dx / d) * pil.r;
          p.z = pil.z + (dz / d) * pil.r;
        }
      }
    }
  },
  updraft(x, y, z) {
    let s = 0;
    for (const u of updrafts) s = Math.max(s, u.strength(x, y, z));
    return s;
  },
};

// ------------------------------------------------------------ Input
const input = new Input($('touch-layer'), $('joystick'), $('joy-knob'));
input.bindButton($('btn-jump'), () => { audio.unlock(); input.jump = true; });
input.bindHold($('btn-sprint'), () => audio.unlock());
input.bindButton(btnInteract, () => { audio.unlock(); input.action = true; });
input.bindButton($('btn-map'), () => { audio.unlock(); input.map = true; });
input.bindButton($('btn-map-close'), () => closeMap());
input.bindButton(btnAudio, () => {
  const m = audio.toggleMute();
  localStorage.setItem(MUTE_KEY, m ? '1' : '0');
  syncAudioUI();
});
input.onFirstMove = () => {
  audio.unlock();
  hintEl.classList.add('gone');
};
const isTouch = matchMedia('(pointer: coarse)').matches;
document.body.classList.toggle('touch', isTouch);
const JUMP_KEY = isTouch ? '跳躍鍵' : '空白鍵';
const SPRINT_KEY = isTouch ? '衝刺鍵' : 'Shift';

// ------------------------------------------------------------ State
type State = 'title' | 'play' | 'cinematic' | 'vista' | 'map';
let state: State = 'title';
let camYaw = Math.PI;
let camPitch = 0.32;
let camDist = 10;
let camDistTarget = 10;
let camLift = 0;
let camLiftTarget = 0;
let baseFov = 62;
let fovKick = 0;
let shake = 0;
let lookIdle = 0;
const camTarget = new THREE.Vector3();
let nearTower: Tower | null = null;
let cine: { tower: Tower; t: number } | null = null;
let mapAnimating = false;
let elapsed = 0;
let allDoneShown = false;
let everythingShown = false;
const tipsShown = new Set<string>();

function staminaMaxFor() {
  const act = towers.filter((t) => t.activated).length;
  return 100 + act * 15 + Math.floor(orbs.count / 5) * 10;
}

function resetPlayer() {
  player.staminaMax = staminaMaxFor();
  player.place(START_POS.x, terrain.height(START_POS.x, START_POS.z), START_POS.z);
  player.facing = Math.PI;
  camYaw = 0; // face north across the valley
}

function applySave() {
  const s = loadSave();
  gameMap.reset();
  towers.forEach((t) => { t.discovered = false; t.setActivated(false); });
  updrafts.forEach((u) => { if (u.towerIndex >= 0) u.active = false; });
  orbs.defs.forEach((d, i) => { orbs.setCollected(i, false); if (d.kind === 'reward') orbs.hide(i); });
  courses.forEach((c) => c.setDone(false));
  tipsShown.clear();
  if (s) {
    s.discovered.forEach((i) => towers[i] && (towers[i].discovered = true));
    s.activated.forEach((i) => {
      const t = towers[i];
      if (!t) return;
      t.setActivated(true);
      t.discovered = true;
      gameMap.addReveal(t.def.x, t.def.z, REVEAL_RADIUS, 1);
      const u = updrafts.find((u) => u.towerIndex === i);
      if (u) u.active = true;
    });
    (s.orbs ?? []).forEach((i) => i < orbs.total && orbs.setCollected(i, true));
    (s.courses ?? []).forEach((i) => courses[i]?.setDone(true));
    (s.tips ?? []).forEach((t) => tipsShown.add(t));
  }
  resetPlayer();
  if (s?.pos) {
    const gx = s.pos[0], gz = s.pos[2];
    const gy = Math.max(world.ground(gx, gz, 0), WATER_LEVEL - 1.1);
    player.place(gx, gy, gz);
  }
}

function save() {
  const data: SaveData = {
    discovered: towers.filter((t) => t.discovered).map((t) => t.index),
    activated: towers.filter((t) => t.activated).map((t) => t.index),
    pos: [player.pos.x, player.pos.y, player.pos.z],
    orbs: orbs.collected.flatMap((c, i) => (c ? [i] : [])),
    courses: courses.filter((c) => c.done).map((c) => c.id),
    tips: [...tipsShown],
  };
  localStorage.setItem(SAVE_KEY, JSON.stringify(data));
}

// ------------------------------------------------------------ UI helpers
interface ToastMsg { title: string; sub: string; ms: number; cls: string; }
const toastQueue: ToastMsg[] = [];
let toastBusy = false;
function toast(title: string, sub = '', ms = 3400, cls = '') {
  // Collapse duplicates already waiting
  if (toastQueue.some((t) => t.title === title)) return;
  toastQueue.push({ title, sub, ms, cls });
  if (!toastBusy) nextToast();
}
function nextToast() {
  const m = toastQueue.shift();
  if (!m) { toastBusy = false; return; }
  toastBusy = true;
  toastEl.className = `toast ${m.cls}`;
  toastEl.innerHTML = `<strong>${m.title}</strong>${m.sub ? `<span>${m.sub}</span>` : ''}`;
  void toastEl.offsetWidth;
  toastEl.classList.add('show');
  const dur = toastQueue.length ? Math.min(m.ms, 2200) : m.ms;
  window.setTimeout(() => {
    toastEl.classList.remove('show');
    window.setTimeout(nextToast, 380);
  }, dur);
}
function tip(id: string, title: string, sub: string, ms = 4600) {
  if (tipsShown.has(id)) return;
  tipsShown.add(id);
  toast(title, sub, ms, 'tip');
  save();
}

const projV = new THREE.Vector3();
function toScreen(p: THREE.Vector3): { x: number; y: number; ok: boolean } {
  projV.copy(p).project(camera);
  return {
    x: (projV.x * 0.5 + 0.5) * window.innerWidth,
    y: (-projV.y * 0.5 + 0.5) * window.innerHeight,
    ok: projV.z < 1 && Math.abs(projV.x) < 1.2 && Math.abs(projV.y) < 1.2,
  };
}
function floatText(p: THREE.Vector3, text: string, cls = '') {
  const s = toScreen(p);
  if (!s.ok) return;
  const el = document.createElement('div');
  el.className = `float-text ${cls}`;
  el.textContent = text;
  el.style.left = `${s.x}px`;
  el.style.top = `${s.y}px`;
  floatLayer.appendChild(el);
  setTimeout(() => el.remove(), 1300);
}

function updateCounter() {
  const n = towers.filter((t) => t.activated).length;
  towerNum.textContent = String(n);
  orbNum.textContent = String(orbs.count);
  orbTotal.textContent = `/ ${orbs.total}`;
}
function bumpOrbPill() {
  orbPill.classList.remove('bump');
  void orbPill.offsetWidth;
  orbPill.classList.add('bump');
}

// Compass: cardinal labels + markers for nearby discovered shrines.
const compassItems: { el: HTMLElement; bearing: () => number; alpha: () => number }[] = [];
(['北', '東', '南', '西'] as const).forEach((label, i) => {
  const el = document.createElement('span');
  el.className = 'c-label' + (i === 0 ? ' north' : '');
  el.textContent = label;
  compassStrip.appendChild(el);
  compassItems.push({ el, bearing: () => (i * Math.PI) / 2, alpha: () => 1 });
});
for (let i = 0; i < 8; i++) {
  if (i % 2 === 0) continue;
  const el = document.createElement('span');
  el.className = 'c-tick';
  compassStrip.appendChild(el);
  compassItems.push({ el, bearing: () => (i * Math.PI) / 4, alpha: () => 1 });
}
towers.forEach((t) => {
  const el = document.createElement('span');
  el.className = 'c-tower';
  compassStrip.appendChild(el);
  compassItems.push({
    el,
    bearing: () => Math.atan2(t.def.x - player.pos.x, -(t.def.z - player.pos.z)),
    alpha: () => {
      el.classList.toggle('active', t.activated);
      if (!t.discovered) return 0;
      if (!t.activated) return 1;
      const d = Math.hypot(t.def.x - player.pos.x, t.def.z - player.pos.z);
      return smoothstep(200, 90, d) * 0.55;
    },
  });
});
// Unfinished wind trials that you've come near show on the compass
courses.forEach((c) => {
  const el = document.createElement('span');
  el.className = 'c-trial';
  compassStrip.appendChild(el);
  let seen = false;
  compassItems.push({
    el,
    bearing: () => Math.atan2(c.start.x - player.pos.x, -(c.start.z - player.pos.z)),
    alpha: () => {
      if (c.done) return 0;
      const d = Math.hypot(c.start.x - player.pos.x, c.start.z - player.pos.z);
      if (d < 120) seen = true;
      return seen ? smoothstep(260, 120, d) * 0.9 : 0;
    },
  });
});
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
function updateCompass() {
  const heading = -camYaw;
  const span = Math.PI * 0.55;
  for (const it of compassItems) {
    const rel = wrap(it.bearing() - heading);
    const baseAlpha = it.alpha();
    const show = baseAlpha > 0.01 && Math.abs(rel) < span;
    it.el.style.opacity = show ? String(baseAlpha * (1 - Math.pow(Math.abs(rel) / span, 3))) : '0';
    it.el.style.left = `${50 + (rel / span) * 50}%`;
  }
}

// ------------------------------------------------------------ Stamina wheel
const headPos = new THREE.Vector3();
let staminaShowT = 0;
function updateStamina(dt: number) {
  const full = player.stamina >= player.staminaMax - 0.01 && !player.exhausted;
  const busy = player.climbing || player.gliding || player.sprinting;
  staminaShowT = full && !busy ? staminaShowT - dt : 1.0;
  const visible = state === 'play' && staminaShowT > 0;
  staminaEl.classList.toggle('show', visible);
  if (!visible) return;
  headPos.set(player.pos.x, player.pos.y + 1.6, player.pos.z);
  const s = toScreen(headPos);
  const r = 15 + Math.min(14, (player.staminaMax - 100) * 0.07);
  const C = 2 * Math.PI * r;
  const size = (r + 6) * 2;
  staminaEl.style.width = staminaEl.style.height = `${size}px`;
  staminaEl.style.transform = `translate(${s.x + 46}px, ${s.y - size / 2 - 6}px)`;
  for (const c of [staminaFg, staminaBg]) {
    c.setAttribute('r', String(r));
    c.setAttribute('cx', String(size / 2));
    c.setAttribute('cy', String(size / 2));
  }
  const f = player.stamina / player.staminaMax;
  staminaFg.style.strokeDasharray = `${C * f} ${C}`;
  staminaEl.classList.toggle('low', f < 0.3 && !player.exhausted);
  staminaEl.classList.toggle('exhausted', player.exhausted);
}

// ------------------------------------------------------------ Map overlay
let mapHideTimer = 0;
function progressText() {
  const n = towers.filter((t) => t.activated).length;
  const c = courses.filter((c) => c.done).length;
  return `古碑 ${n}/${towers.length} · 靈光 ${orbs.count}/${orbs.total} · 試煉 ${c}/${courses.length}`;
}
function openMap(animate = false) {
  clearTimeout(mapHideTimer);
  state = 'map';
  mapAnimating = animate;
  audio.playMap(true);
  $('map-progress').textContent = progressText();
  mapOverlay.hidden = false;
  gameMap.draw(mapCanvas, towers);
  void mapOverlay.offsetWidth;
  mapOverlay.classList.add('open');
}
function closeMap() {
  if (state !== 'map') return;
  audio.playMap(false);
  mapOverlay.classList.remove('open');
  clearTimeout(mapHideTimer);
  mapHideTimer = window.setTimeout(() => { mapOverlay.hidden = true; }, 250);
  state = 'play';
  camDistTarget = 10;
  camLiftTarget = 0;
  if (towers.every((t) => t.activated) && !allDoneShown) {
    allDoneShown = true;
    toast('群山萬水盡入畫卷', '所有古碑皆已共鳴。伴著山風繼續漫遊吧。', 6000);
  }
}

// ------------------------------------------------------------ Proximity Discovery
const ndc = new THREE.Vector3();
const losPt = new THREE.Vector3();
function lineOfSight(from: THREE.Vector3, to: THREE.Vector3): boolean {
  const steps = 44;
  for (let i = 2; i < steps; i++) {
    losPt.lerpVectors(from, to, i / steps);
    if (terrain.height(losPt.x, losPt.z) > losPt.y) return false;
  }
  return true;
}
let discoverTimer = 0;
function checkDiscovery(dt: number) {
  discoverTimer -= dt;
  if (discoverTimer > 0) return;
  discoverTimer = 0.25;
  for (const t of towers) {
    if (t.discovered) continue;
    const playerDist = Math.hypot(t.def.x - player.pos.x, t.def.z - player.pos.z);
    if (playerDist > 84) continue;
    const p = new THREE.Vector3(t.def.x, t.base + 3.6, t.def.z);
    ndc.copy(p).project(camera);
    if (Math.abs(ndc.x) > 0.88 || Math.abs(ndc.y) > 0.88 || ndc.z <= 0 || ndc.z > 1) continue;
    if (!lineOfSight(camera.position, p)) continue;
    t.discovered = true;
    audio.playDiscover();
    toast('林間浮現微光', `發現「${t.def.name}」 · 已記於方位羅盤`);
    save();
  }
}

// ------------------------------------------------------------ Resonance & Aerial Vista
function faceShrine(t: Tower) {
  const dx = t.def.x - player.pos.x, dz = t.def.z - player.pos.z;
  if (Math.hypot(dx, dz) > 0.2) player.facing = Math.atan2(dx, dz);
  player.vel.set(0, 0, 0);
  player.syncModel(0, world.ground(player.pos.x, player.pos.z, player.pos.y));
}

function activate(t: Tower) {
  faceShrine(t);
  t.discovered = true;
  t.setActivated(true);
  t.pulse();
  audio.playActivate();
  gameMap.addReveal(t.def.x, t.def.z, REVEAL_RADIUS, 0);
  const u = updrafts.find((u) => u.towerIndex === t.index);
  if (u) u.active = true;
  player.staminaMax = staminaMaxFor();
  player.stamina = player.staminaMax;
  player.exhausted = false;
  updateCounter();
  save();
  btnInteract.hidden = true;
  sparkles.burst(new THREE.Vector3(t.def.x, t.base + 3.6, t.def.z), 80, '#7ff0ff', 12, 0.8, 1.8, 2);
  toast(`${t.def.name} 已共鳴`, '地貌已繪入地圖 · 體力上限提升 · 古碑旁升起上升氣流', 4200);
  cine = { tower: t, t: 0 };
  state = 'cinematic';
}

function startVista(t: Tower) {
  faceShrine(t);
  t.pulse();
  audio.playVista();
  state = 'vista';
  camLiftTarget = 28;
  camDistTarget = 40;
  camPitch = Math.max(0.28, camPitch);
  btnInteractLabel.textContent = '返回';
  btnInteract.classList.add('revisit');
  btnInteract.hidden = false;
}

function exitVista() {
  state = 'play';
  camLiftTarget = 0;
  camDistTarget = 10;
}

function updateCinematic(dt: number) {
  if (!cine) return;
  cine.t += dt;
  camLiftTarget = 26;
  camDistTarget = 42;
  camPitch += (0.38 - camPitch) * Math.min(1, dt * 1.5);
  camYaw += dt * 0.34;
  if (cine.t > 3.8) {
    cine = null;
    openMap(true);
  }
}

// ------------------------------------------------------------ Player feedback (juice)
const tmpV = new THREE.Vector3();
const feet = () => tmpV.set(player.pos.x, player.pos.y, player.pos.z);
player.events = {
  jump: () => { audio.playJump(); dust.dust(feet(), 5, 2.2); },
  land: (impact) => {
    audio.playLand(impact);
    if (impact > 9) {
      dust.dust(feet(), Math.min(26, Math.round(impact * 0.8)), 2 + impact * 0.12);
      shake = Math.max(shake, Math.min(0.5, (impact - 9) / 40));
    }
  },
  splash: (impact) => {
    audio.playSplash(impact);
    sparkles.splash(tmpV.set(player.pos.x, WATER_LEVEL + 0.1, player.pos.z), 14 + Math.round(impact), 3 + impact * 0.25);
  },
  glideOpen: () => {
    audio.playGlideOpen();
    tipsShown.add('glide');
    glideHint.classList.remove('show');
  },
  glideClose: () => audio.playGlideClose(),
  climbStart: () => {
    audio.playGrab();
    tip('climb', '攀上岩壁', `推動方向攀爬 · ${JUMP_KEY}向上躍 · 向後推＋${JUMP_KEY}跳離 · 留意體力`);
  },
  climbLeap: () => audio.playLeap(),
  mantle: () => { audio.playGrab(); dust.dust(feet(), 6, 1.6); },
  exhausted: () => {
    audio.playExhausted();
    tip('stamina', '體力耗盡', '站穩腳步休息，體力全滿後才能再次使用');
  },
};

let orbCombo = 0;
let orbComboT = 0;
function onOrbs(got: number[]) {
  for (const i of got) {
    const d = orbs.defs[i];
    const p = new THREE.Vector3(player.pos.x, player.pos.y + 1.1, player.pos.z);
    orbCombo = orbComboT > 0 ? orbCombo + 1 : 0;
    orbComboT = 3;
    audio.playOrb(orbCombo);
    sparkles.burst(p, 26, '#ffd760', 6, 0.55, 1.0, 2);
    sparkles.burst(p, 10, '#ffffff', 3, 0.4, 0.7, 0);
    floatText(p, orbCombo > 0 ? `+1 ×${orbCombo + 1}` : '+1', 'orb');
    bumpOrbPill();
    updateCounter();
    const n = orbs.count;
    if (n === 1) tip('orb', '拾得靈光', '每收集 5 顆靈光，體力上限就會提升');
    if (n % 5 === 0) {
      player.staminaMax = staminaMaxFor();
      player.stamina = player.staminaMax;
      player.exhausted = false;
      setTimeout(() => audio.playUpgrade(), 250);
      sparkles.burst(p, 50, '#8dff9a', 9, 0.6, 1.4, 1);
      toast('體力上限提升', `靈光 ${n} 顆 · 體力 ${player.staminaMax}`, 3200, 'gold');
    } else if (d.kind === 'sky') {
      toast('乘風摘星', '拾得高空的靈光', 2400);
    } else if (d.kind === 'peak') {
      toast('登頂', '山巔的靈光 · 試著從這裡滑翔而下', 2400);
    }
    checkEverything();
  }
  if (got.length) save();
}

let activeCourse: RingCourse | null = null;
function onCourse(c: RingCourse, ev: CourseEvent) {
  if (!ev) return;
  if (ev.type === 'start' || ev.type === 'pass') {
    activeCourse = c;
    audio.playRing(ev.index - 1);
    sparkles.burst(c.rings[ev.index - 1].p, 24, '#bff8ff', 7, 0.6, 0.9, 0);
    if (ev.type === 'start') tip('trial', '風之試煉', '在時限內依序穿過所有光環');
  } else if (ev.type === 'fail') {
    if (activeCourse === c) activeCourse = null;
    audio.playCourseFail();
    toast('試煉中斷', '光環已重置 · 回到山頂再試一次', 2400);
  } else if (ev.type === 'complete') {
    activeCourse = null;
    audio.playRing(ev.index - 1);
    setTimeout(() => audio.playCourseDone(), 180);
    sparkles.burst(c.end, 90, '#ffe27a', 14, 0.8, 1.8, 1);
    orbs.reveal(c.rewardOrb);
    toast(`${c.name} · 完成`, '風之試煉達成 · 獲得靈光', 3400, 'gold');
    save();
  }
}

function updateTrialHud() {
  const c = activeCourse;
  trialEl.classList.toggle('show', !!c && state === 'play');
  if (!c) return;
  trialName.textContent = c.name;
  trialCount.textContent = `${c.next} / ${c.rings.length}`;
  trialBar.style.transform = `scaleX(${Math.max(0, c.timer / RingCourse.WINDOW)})`;
}

function checkEverything() {
  if (everythingShown) return;
  if (orbs.count === orbs.total && courses.every((c) => c.done) && towers.every((t) => t.activated)) {
    everythingShown = true;
    setTimeout(() => {
      audio.playCourseDone();
      toast('三角之境 · 全數制霸', '每一座山、每一陣風都已走遍。你就是這片大地的旅人。', 7000, 'gold');
    }, 1200);
  }
}

// Continuous effects: wind trails, sprint dust, swim ripples, contextual hints
const tipL = new THREE.Vector3(), tipR = new THREE.Vector3();
let dustAcc = 0;
let inUpdraft = false;
function updatePlayerFx(dt: number) {
  const sp = player.speedXZ;
  if (player.gliding && sp > 5) {
    player.model.updateMatrixWorld();
    tipL.set(1.85, 2.35, -0.6); tipR.set(-1.85, 2.35, -0.6);
    player.model.localToWorld(tipL); player.model.localToWorld(tipR);
    const c = player.diving ? '#ffffff' : '#e8fbff';
    sparkles.spawn(tipL.x, tipL.y, tipL.z, 0, 0, 0, c, 0.22, 0.55);
    sparkles.spawn(tipR.x, tipR.y, tipR.z, 0, 0, 0, c, 0.22, 0.55);
  }
  dustAcc += dt;
  if (player.sprinting && player.grounded && dustAcc > 0.09) {
    dustAcc = 0;
    dust.dust(feet(), 2, 1.2);
  } else if (player.swimming && sp > 1 && dustAcc > 0.18) {
    dustAcc = 0;
    sparkles.splash(tmpV.set(player.pos.x, WATER_LEVEL + 0.1, player.pos.z), 2, 1.5);
  }
  // Updraft cues
  const up = world.updraft(player.pos.x, player.pos.y + 1, player.pos.z);
  if (up > 0.05 && !inUpdraft) {
    inUpdraft = true;
    if (player.gliding) audio.playUpdraft();
    else tip('updraft', '上升氣流', `跳起後再按${JUMP_KEY}展開滑翔翼，乘風而上`);
  } else if (up <= 0.01) inUpdraft = false;
  // "Open your glider" prompt while falling from height
  const fallingHigh = player.mode === 'air' && player.airHeight > 6 && player.vel.y < -3 && state === 'play';
  glideHint.classList.toggle('show', fallingHigh && !tipsShown.has('glide'));
}

// ------------------------------------------------------------ Camera
function updateCamera(dt: number) {
  const look = input.consumeLook();
  if (state === 'play' || state === 'vista') {
    camYaw -= look.x * 0.0055;
    camPitch = Math.min(1.25, Math.max(-0.32, camPitch + look.y * 0.0045));
  }
  lookIdle = Math.abs(look.x) + Math.abs(look.y) > 0.5 ? 0 : lookIdle + dt;

  if (state === 'play') {
    // Dynamic framing per movement mode
    camDistTarget = player.gliding ? (player.diving ? 14.5 : 12.5) : player.climbing ? 9 : player.sprinting ? 11 : 10;
    // While gliding, ease the camera behind the flight direction
    if (player.gliding && lookIdle > 1.2) {
      const behind = player.facing + Math.PI;
      camYaw += wrap(behind - camYaw) * Math.min(1, dt * 0.9);
    }
  }
  const kick = state === 'play'
    ? (player.sprinting ? 6 : 0) + (player.gliding ? 5 + Math.min(10, player.speedXZ * 0.35) + (player.diving ? 8 : 0) : 0)
    : 0;
  fovKick += (kick - fovKick) * Math.min(1, dt * 3);
  const fov = baseFov + fovKick;
  if (Math.abs(camera.fov - fov) > 0.05) { camera.fov = fov; camera.updateProjectionMatrix(); }

  camDist += (camDistTarget - camDist) * Math.min(1, dt * 2.6);
  camLift += (camLiftTarget - camLift) * Math.min(1, dt * 2.2);
  const target = new THREE.Vector3(player.pos.x, player.pos.y + 1.6 + camLift, player.pos.z);
  camTarget.lerp(target, Math.min(1, dt * (player.gliding ? 14 : 10)));
  const cp = Math.cos(camPitch);
  camera.position.set(
    camTarget.x + Math.sin(camYaw) * cp * camDist,
    camTarget.y + Math.sin(camPitch) * camDist,
    camTarget.z + Math.cos(camYaw) * cp * camDist,
  );
  const floor = Math.max(terrain.height(camera.position.x, camera.position.z), WATER_LEVEL) + 0.8;
  if (camera.position.y < floor) camera.position.y = floor;
  camera.lookAt(camTarget);
  if (shake > 0.001) {
    camera.position.x += (Math.random() - 0.5) * shake;
    camera.position.y += (Math.random() - 0.5) * shake;
    shake *= Math.pow(0.002, dt);
  }

  const sl = state === 'play'
    ? (player.gliding ? smoothstep(11, 22, player.speedXZ - player.vel.y * 0.5) : 0) + (player.sprinting ? 0.22 : 0)
    : 0;
  speedlines.style.opacity = String(Math.min(0.85, sl));
}

function updateTitleCamera(t: number) {
  const a = t * 0.04;
  camera.position.set(Math.sin(a) * 250, 125, Math.cos(a) * 250);
  camera.lookAt(0, 20, 0);
}

// ------------------------------------------------------------ Audio environment query
function sampleWaterProximity(x: number, z: number): number {
  let minH = terrain.height(x, z);
  const R = 16;
  minH = Math.min(minH, terrain.height(x + R, z), terrain.height(x - R, z), terrain.height(x, z + R), terrain.height(x, z - R));
  return smoothstep(WATER_LEVEL + 9, WATER_LEVEL - 0.5, minH);
}

// ------------------------------------------------------------ Loop
let lastT = performance.now();
let saveTimer = 0;
const chest = new THREE.Vector3();

function frame() {
  const now = performance.now();
  const dt = Math.min((now - lastT) / 1000, 0.05);
  lastT = now;
  elapsed += dt;
  input.update();

  let moveSpeed = 0;
  let onStone = false;

  if (state === 'title') {
    updateTitleCamera(elapsed);
  } else {
    if (state === 'play') {
      player.update(dt, input, camYaw, world);
      moveSpeed = player.climbing
        ? Math.min(1, Math.hypot(input.move.x, input.move.y))
        : Math.min(1, player.speedXZ / 8.5);

      nearTower = null;
      if (player.grounded) {
        for (const t of towers) {
          const d = Math.hypot(player.pos.x - t.def.x, player.pos.z - t.def.z);
          if (d < 6.2) onStone = true;
          if (d < 6.0) { nearTower = t; break; }
        }
      }
      btnInteract.hidden = !nearTower;
      if (nearTower) {
        btnInteractLabel.textContent = nearTower.activated ? '遠眺' : '共鳴';
        btnInteract.classList.toggle('revisit', nearTower.activated);
      }
      if (input.action && nearTower) {
        if (!nearTower.activated) activate(nearTower);
        else startVista(nearTower);
      }
      if (input.map) openMap();
      checkDiscovery(dt);

      chest.set(player.pos.x, player.pos.y + 1.0, player.pos.z);
      onOrbs(orbs.update(elapsed, dt, chest, true));
      for (const c of courses) onCourse(c, c.update(elapsed, dt, chest));
      orbComboT -= dt;
      updatePlayerFx(dt);

      saveTimer += dt;
      if (saveTimer > 5) { saveTimer = 0; save(); }
    } else {
      chest.set(player.pos.x, player.pos.y + 1.0, player.pos.z);
      orbs.update(elapsed, dt, chest, false);
      for (const c of courses) c.update(elapsed, dt, new THREE.Vector3(0, -9999, 0));
      if (state === 'vista') {
        if (input.action || input.jump || Math.hypot(input.move.x, input.move.y) > 0.18) {
          exitVista();
        } else if (input.map) {
          openMap();
        }
      } else if (state === 'cinematic') {
        updateCinematic(dt);
      } else if (state === 'map') {
        if (input.map) closeMap();
        if (mapAnimating) mapAnimating = gameMap.advance(dt);
        gameMap.draw(mapCanvas, towers);
      }
    }
    updateCamera(dt);
    updateCompass();
    updateStamina(dt);
    updateTrialHud();
  }

  audio.update(dt, {
    altitude: state === 'title' ? 22 : player.pos.y,
    waterProximity: state === 'title' ? 0.25 : sampleWaterProximity(player.pos.x, player.pos.z),
    swimming: player.swimming,
    speed: moveSpeed,
    grounded: player.grounded,
    onStone,
    aerial: state === 'cinematic' || state === 'vista' || player.gliding,
    glide: player.gliding ? Math.min(1, (player.speedXZ + Math.abs(player.vel.y)) / 22) : 0,
    climbing: player.climbing,
  });

  towers.forEach((t) => t.update(elapsed, dt, player.pos, state === 'title'));
  updrafts.forEach((u) => u.update(elapsed, dt, sparkles, state === 'title' ? camera.position : player.pos));
  sparkles.update(dt);
  dust.update(dt);
  clouds.children.forEach((c) => {
    c.position.x += c.userData.speed * dt;
    if (c.position.x > 480) c.position.x = -480;
  });
  sky.position.copy(camera.position);
  input.clearPresses();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  baseFov = w < h ? 72 : 62;
  camera.fov = baseFov + fovKick;
  camera.updateProjectionMatrix();
  const ph = h * renderer.getPixelRatio();
  sparkles.setViewport(ph, baseFov);
  dust.setViewport(ph, baseFov);
}
window.addEventListener('resize', resize);
resize();

// ------------------------------------------------------------ Title
const hasSave = !!loadSave();
$('btn-reset').hidden = !hasSave;
$('btn-start').textContent = hasSave ? '繼續探索' : '開始探索';

function startGame() {
  audio.unlock();
  applySave();
  updateCounter();
  camLift = 0;
  camLiftTarget = 0;
  camDist = 10;
  camDistTarget = 10;
  camTarget.set(player.pos.x, player.pos.y + 1.6, player.pos.z);
  titleScreen.classList.add('leaving');
  setTimeout(() => { titleScreen.hidden = true; }, 600);
  hud.hidden = false;
  state = 'play';
  if (!loadSave()) {
    setTimeout(() => toast('踏入未知的山野', '追隨金色靈光 · 攀上群峰 · 乘風滑翔 · 尋找古碑', 4800), 900);
  }
}
$('btn-start').addEventListener('click', startGame);
$('btn-reset').addEventListener('click', () => {
  localStorage.removeItem(SAVE_KEY);
  allDoneShown = false;
  everythingShown = false;
  startGame();
});
window.addEventListener('keydown', () => { if (state !== 'title') audio.unlock(); }, { passive: true });

frame();

if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__game = {
    player, towers, terrain, activate, startVista, openMap, audio, orbs, updrafts, courses, world,
    setYaw: (y: number) => { camYaw = y; },
    setPitch: (p: number) => { camPitch = p; },
    getState: () => state,
    /** Deterministically step the player (dev testing only). */
    sim: (n: number, mx: number, my: number, jumpAt = -1, sprint = false) => {
      const log: string[] = [];
      for (let i = 0; i < n; i++) {
        player.update(1 / 60, { move: { x: mx, y: my }, jump: i === jumpAt, sprint }, camYaw, world);
        chest.set(player.pos.x, player.pos.y + 1.0, player.pos.z);
        for (const c of courses) { const ev = c.update(elapsed, 1 / 60, chest); if (ev) log.push(`${c.name}:${ev.type}${ev.index}`); }
        const got = orbs.update(elapsed, 1 / 60, chest, true);
        if (got.length) log.push(`orb${got.join(',')}`);
      }
      return { mode: player.mode, pos: player.pos.toArray().map((v) => +v.toFixed(2)), st: +player.stamina.toFixed(1), ex: player.exhausted, log };
    },
  };
}

// Keep the glide hint copy in sync with the platform
glideHint.textContent = `再按${JUMP_KEY}展開滑翔翼 · 按住${SPRINT_KEY}俯衝`;
