import * as THREE from 'three';
import './style.css';
import { Terrain, WATER_LEVEL, type Flatten } from './terrain';
import {
  createSky, createTerrainMesh, createWater, createVegetation, createClouds,
  Tower, TOWER_DEFS, REVEAL_RADIUS, START_POS, COLORS,
} from './world';
import { Player, type WorldQuery } from './player';
import { Input } from './input';
import { GameMap } from './map';

// ------------------------------------------------------------ DOM
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('scene');
const hud = $('hud');
const titleScreen = $('title-screen');
const mapOverlay = $('map-overlay');
const mapCanvas = $<HTMLCanvasElement>('map-canvas');
const btnClimb = $('btn-climb');
const toastEl = $('toast');
const towerNum = $('tower-count-num');
const compassStrip = $('compass-strip');
const hintEl = $('hint');

// ------------------------------------------------------------ Save
const SAVE_KEY = 'triangle-explorer-v1';
interface SaveData { discovered: number[]; activated: number[]; pos?: [number, number, number]; }
const loadSave = (): SaveData | null => {
  try { return JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch { return null; }
};

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
  ...TOWER_DEFS.map((d) => ({ x: d.x, z: d.z, r: 18 })),
  { ...START_POS, r: 16 },
];
const terrain = new Terrain(flats);
const sky = createSky(sunDir);
scene.add(sky, createTerrainMesh(terrain), createWater());
scene.add(createVegetation(terrain, flats.map((f) => ({ x: f.x, z: f.z, r: f.r * 0.8 }))));
const clouds = createClouds();
scene.add(clouds);

const towers = TOWER_DEFS.map((d, i) => new Tower(d, i, terrain.height(d.x, d.z)));
towers.forEach((t) => scene.add(t.group));

const player = new Player();
scene.add(player.model, player.shadow);

const gameMap = new GameMap(terrain);

// ------------------------------------------------------------ World physics queries
const world: WorldQuery = {
  ground(x, z, y) {
    let h = terrain.height(x, z);
    for (const t of towers) {
      const d = Math.hypot(x - t.def.x, z - t.def.z);
      if (d < 7) h = Math.max(h, t.base + 1.5);
      if (d < 4.4 && y >= t.top - 1.2) h = Math.max(h, t.top);
    }
    return h;
  },
  collide(p) {
    for (const t of towers) {
      if (p.y >= t.top - 1.2) continue;
      const dx = p.x - t.def.x, dz = p.z - t.def.z;
      const d = Math.hypot(dx, dz);
      const R = 4.4;
      if (d < R && d > 1e-4) { p.x = t.def.x + (dx / d) * R; p.z = t.def.z + (dz / d) * R; }
    }
  },
};

// ------------------------------------------------------------ Input
const input = new Input($('touch-layer'), $('joystick'), $('joy-knob'));
input.bindButton($('btn-jump'), () => { input.jump = true; });
input.bindButton(btnClimb, () => { input.action = true; });
input.bindButton($('btn-map'), () => { input.map = true; });
input.bindButton($('btn-map-close'), () => closeMap());
input.onFirstMove = () => hintEl.classList.add('gone');

// ------------------------------------------------------------ State
type State = 'title' | 'play' | 'climb' | 'cinematic' | 'map';
let state: State = 'title';
let camYaw = Math.PI;     // camera behind player looking toward -z (north)
let camPitch = 0.32;
let camDist = 10;
let camDistTarget = 10;
const camTarget = new THREE.Vector3();
let nearTower: Tower | null = null;
let climb: { tower: Tower; t: number; fromY: number; r0: number; ang: number } | null = null;
let cine: { tower: Tower; t: number } | null = null;
let mapAnimating = false;
let elapsed = 0;

function resetPlayer() {
  player.pos.set(START_POS.x, terrain.height(START_POS.x, START_POS.z), START_POS.z);
  player.vel.set(0, 0, 0);
  player.facing = Math.PI;
  camYaw = 0; // look north toward the first tower
}

function applySave() {
  const s = loadSave();
  gameMap.reset();
  towers.forEach((t) => { t.discovered = false; t.setActivated(false); });
  resetPlayer();
  if (!s) return;
  s.discovered.forEach((i) => towers[i] && (towers[i].discovered = true));
  s.activated.forEach((i) => {
    const t = towers[i];
    if (!t) return;
    t.setActivated(true);
    t.discovered = true;
    gameMap.addReveal(t.def.x, t.def.z, REVEAL_RADIUS, 1);
  });
  if (s.pos) player.pos.set(...s.pos);
}

function save() {
  const data: SaveData = {
    discovered: towers.filter((t) => t.discovered).map((t) => t.index),
    activated: towers.filter((t) => t.activated).map((t) => t.index),
    pos: [player.pos.x, player.pos.y, player.pos.z],
  };
  localStorage.setItem(SAVE_KEY, JSON.stringify(data));
}

// ------------------------------------------------------------ UI helpers
let toastTimer = 0;
function toast(title: string, sub = '', ms = 3200) {
  toastEl.innerHTML = `<strong>${title}</strong>${sub ? `<span>${sub}</span>` : ''}`;
  toastEl.classList.remove('show');
  void toastEl.offsetWidth;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl.classList.remove('show'), ms);
}

function updateCounter() {
  const n = towers.filter((t) => t.activated).length;
  towerNum.textContent = String(n);
}

// Compass: cardinal labels + markers for discovered towers.
const compassItems: { el: HTMLElement; bearing: () => number; visible: () => boolean }[] = [];
(['北', '東', '南', '西'] as const).forEach((label, i) => {
  const el = document.createElement('span');
  el.className = 'c-label' + (i === 0 ? ' north' : '');
  el.textContent = label;
  compassStrip.appendChild(el);
  compassItems.push({ el, bearing: () => (i * Math.PI) / 2, visible: () => true });
});
for (let i = 0; i < 8; i++) {
  if (i % 2 === 0) continue;
  const el = document.createElement('span');
  el.className = 'c-tick';
  compassStrip.appendChild(el);
  compassItems.push({ el, bearing: () => (i * Math.PI) / 4, visible: () => true });
}
towers.forEach((t) => {
  const el = document.createElement('span');
  el.className = 'c-tower';
  compassStrip.appendChild(el);
  compassItems.push({
    el,
    bearing: () => Math.atan2(t.def.x - player.pos.x, -(t.def.z - player.pos.z)),
    visible: () => {
      el.classList.toggle('active', t.activated);
      return t.discovered;
    },
  });
});
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
function updateCompass() {
  const heading = -camYaw; // bearing the camera faces
  const span = Math.PI * 0.55;
  for (const it of compassItems) {
    const rel = wrap(it.bearing() - heading);
    const show = it.visible() && Math.abs(rel) < span;
    it.el.style.opacity = show ? String(1 - Math.pow(Math.abs(rel) / span, 3)) : '0';
    it.el.style.left = `${50 + (rel / span) * 50}%`;
  }
}

// ------------------------------------------------------------ Map overlay
function openMap(animate = false) {
  state = 'map';
  mapAnimating = animate;
  mapOverlay.hidden = false;
  requestAnimationFrame(() => mapOverlay.classList.add('open'));
  const n = towers.filter((t) => t.activated).length;
  $('map-progress').textContent = `已點亮 ${n} / ${towers.length} 座高塔`;
}
function closeMap() {
  if (state !== 'map') return;
  mapOverlay.classList.remove('open');
  setTimeout(() => { mapOverlay.hidden = true; }, 250);
  state = 'play';
  camDistTarget = 10;
  if (towers.every((t) => t.activated) && !allDoneShown) {
    allDoneShown = true;
    toast('整片大地盡收眼底', '所有高塔皆已點亮。繼續漫遊吧。', 6000);
  }
}
let allDoneShown = false;

// ------------------------------------------------------------ Discovery (the "triangle" payoff)
const ndc = new THREE.Vector3();
const losPt = new THREE.Vector3();
function lineOfSight(from: THREE.Vector3, to: THREE.Vector3): boolean {
  const steps = 56;
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
    // Check both the crystal and a point up the beam.
    for (const yOff of [3.5, 30]) {
      const p = new THREE.Vector3(t.def.x, t.top + yOff, t.def.z);
      if (p.distanceTo(camera.position) > 520) continue;
      ndc.copy(p).project(camera);
      if (Math.abs(ndc.x) > 0.95 || Math.abs(ndc.y) > 0.95 || ndc.z > 1) continue;
      if (!lineOfSight(camera.position, p)) continue;
      t.discovered = true;
      toast('遠方出現了光芒', `發現「${t.def.name}」 · 已標記於指南針`);
      save();
      break;
    }
  }
}

// ------------------------------------------------------------ Climb & activation
function startClimb(t: Tower) {
  const dx = player.pos.x - t.def.x, dz = player.pos.z - t.def.z;
  climb = { tower: t, t: 0, fromY: player.pos.y, r0: Math.max(4.6, Math.hypot(dx, dz)), ang: Math.atan2(dx, dz) };
  state = 'climb';
  btnClimb.hidden = true;
}

function updateClimb(dt: number) {
  if (!climb) return;
  const c = climb;
  c.t = Math.min(1, c.t + dt / 3.2);
  const k = c.t < 0.5 ? 2 * c.t * c.t : 1 - Math.pow(-2 * c.t + 2, 2) / 2;
  const t = c.tower;
  // Climb along the leg slope: radius shrinks as we rise, then step onto the platform.
  const rise = Math.min(1, k / 0.9);
  let r = c.r0 + (2.6 - c.r0) * rise;
  if (k > 0.9) r = 2.6 + (1.8 - 2.6) * ((k - 0.9) / 0.1);
  player.pos.set(t.def.x + Math.sin(c.ang) * r, c.fromY + (t.top - c.fromY) * rise, t.def.z + Math.cos(c.ang) * r);
  player.facing = c.ang + Math.PI;
  player.vel.set(0, 0, 0);
  player.syncModel(0, world.ground(player.pos.x, player.pos.z, player.pos.y));
  camDistTarget = 14;
  if (c.t >= 1) {
    climb = null;
    player.grounded = true;
    player.facing = c.ang; // turn around to face the view
    camYaw = c.ang + Math.PI;
    if (!t.activated) activate(t);
    else { state = 'play'; camDistTarget = 10; }
  }
}

function activate(t: Tower) {
  t.discovered = true;
  t.setActivated(true);
  t.pulse();
  gameMap.addReveal(t.def.x, t.def.z, REVEAL_RADIUS, 0);
  updateCounter();
  save();
  toast(`${t.def.name} 已啟動`, '區域地圖已更新');
  cine = { tower: t, t: 0 };
  state = 'cinematic';
}

function updateCinematic(dt: number) {
  if (!cine) return;
  cine.t += dt;
  camDistTarget = 46;
  camPitch += (0.42 - camPitch) * Math.min(1, dt * 1.5);
  camYaw += dt * 0.35;
  if (cine.t > 3.6) { cine = null; openMap(true); }
}

// ------------------------------------------------------------ Camera
function updateCamera(dt: number) {
  const look = input.consumeLook();
  if (state === 'play' || state === 'climb') {
    camYaw -= look.x * 0.0055;
    camPitch = Math.min(1.25, Math.max(-0.35, camPitch + look.y * 0.0045));
  }
  camDist += (camDistTarget - camDist) * Math.min(1, dt * 3);
  const target = new THREE.Vector3(player.pos.x, player.pos.y + 1.6, player.pos.z);
  camTarget.lerp(target, Math.min(1, dt * 12));
  const cp = Math.cos(camPitch);
  camera.position.set(
    camTarget.x + Math.sin(camYaw) * cp * camDist,
    camTarget.y + Math.sin(camPitch) * camDist,
    camTarget.z + Math.cos(camYaw) * cp * camDist,
  );
  const floor = Math.max(terrain.height(camera.position.x, camera.position.z), WATER_LEVEL) + 0.8;
  if (camera.position.y < floor) camera.position.y = floor;
  camera.lookAt(camTarget);
}

function updateTitleCamera(t: number) {
  const a = t * 0.04;
  camera.position.set(Math.sin(a) * 250, 125, Math.cos(a) * 250);
  camera.lookAt(0, 20, 0);
}

// ------------------------------------------------------------ Loop
let lastT = performance.now();
let saveTimer = 0;

function frame() {
  const now = performance.now();
  const dt = Math.min((now - lastT) / 1000, 0.05);
  lastT = now;
  elapsed += dt;
  input.update();

  if (state === 'title') {
    updateTitleCamera(elapsed);
  } else {
    if (state === 'play') {
      player.update(dt, input.move, input.jump, camYaw, world);
      // Contextual climb prompt
      nearTower = null;
      for (const t of towers) {
        const d = Math.hypot(player.pos.x - t.def.x, player.pos.z - t.def.z);
        if (d < 8.5 && player.pos.y < t.top - 5) { nearTower = t; break; }
      }
      btnClimb.hidden = !nearTower;
      if (nearTower) $('btn-climb-label').textContent = nearTower.activated ? '登頂' : '攀爬';
      if (input.action && nearTower) startClimb(nearTower);
      if (input.map) openMap();
      checkDiscovery(dt);
      saveTimer += dt;
      if (saveTimer > 5) { saveTimer = 0; save(); }
    } else if (state === 'climb') updateClimb(dt);
    else if (state === 'cinematic') updateCinematic(dt);
    else if (state === 'map') {
      if (input.map) closeMap();
      if (mapAnimating) mapAnimating = gameMap.advance(dt);
      gameMap.draw(mapCanvas, player.pos, -camYaw, towers, elapsed);
    }
    updateCamera(dt);
    updateCompass();
  }

  towers.forEach((t) => t.update(elapsed, dt, camera.position));
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
  camera.fov = w < h ? 72 : 62; // wider FOV in portrait so the horizon still reads
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ------------------------------------------------------------ Title
const hasSave = !!loadSave();
$('btn-reset').hidden = !hasSave;
$('btn-start').textContent = hasSave ? '繼續探索' : '開始探索';
const isTouch = matchMedia('(pointer: coarse)').matches;
document.body.classList.toggle('touch', isTouch);

function startGame() {
  applySave();
  updateCounter();
  camTarget.set(player.pos.x, player.pos.y + 1.6, player.pos.z);
  titleScreen.classList.add('leaving');
  setTimeout(() => { titleScreen.hidden = true; }, 600);
  hud.hidden = false;
  state = 'play';
  if (!loadSave()) {
    setTimeout(() => toast('看見北方的光柱了嗎？', '登上高塔，揭開這片土地的地圖', 4500), 900);
  }
}
$('btn-start').addEventListener('click', startGame);
$('btn-reset').addEventListener('click', () => {
  localStorage.removeItem(SAVE_KEY);
  startGame();
});

frame();

if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__game = {
    player, towers, terrain, startClimb, openMap,
    setYaw: (y: number) => { camYaw = y; },
    getState: () => state,
  };
}
