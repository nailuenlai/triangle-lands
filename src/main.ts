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
const compassStrip = $('compass-strip');
const hintEl = $('hint');

// ------------------------------------------------------------ Save & Settings
const SAVE_KEY = 'triangle-explorer-v1';
const MUTE_KEY = 'triangle-explorer-muted';
interface SaveData { discovered: number[]; activated: number[]; pos?: [number, number, number]; }
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
};

// ------------------------------------------------------------ Input
const input = new Input($('touch-layer'), $('joystick'), $('joy-knob'));
input.bindButton($('btn-jump'), () => { audio.unlock(); input.jump = true; });
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

// ------------------------------------------------------------ State
type State = 'title' | 'play' | 'cinematic' | 'vista' | 'map';
let state: State = 'title';
let camYaw = Math.PI;
let camPitch = 0.32;
let camDist = 10;
let camDistTarget = 10;
let camLift = 0;
let camLiftTarget = 0;
const camTarget = new THREE.Vector3();
let nearTower: Tower | null = null;
let cine: { tower: Tower; t: number } | null = null;
let mapAnimating = false;
let elapsed = 0;
let allDoneShown = false;

function resetPlayer() {
  player.pos.set(START_POS.x, terrain.height(START_POS.x, START_POS.z), START_POS.z);
  player.vel.set(0, 0, 0);
  player.facing = Math.PI;
  camYaw = 0; // face north across the valley
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
  if (s.pos) {
    const gx = s.pos[0], gz = s.pos[2];
    const gy = Math.max(world.ground(gx, gz, 0), WATER_LEVEL - 1.1);
    player.pos.set(gx, gy, gz);
  }
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
function toast(title: string, sub = '', ms = 3400) {
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

// ------------------------------------------------------------ Map overlay
let mapHideTimer = 0;
function openMap(animate = false) {
  clearTimeout(mapHideTimer);
  state = 'map';
  mapAnimating = animate;
  audio.playMap(true);
  const n = towers.filter((t) => t.activated).length;
  $('map-progress').textContent = `已共鳴 ${n} / ${towers.length} 座古碑`;
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
  updateCounter();
  save();
  btnInteract.hidden = true;
  toast(`${t.def.name} 已共鳴`, '隨風俯瞰四方 · 周遭地貌已繪入地圖');
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

// ------------------------------------------------------------ Camera
function updateCamera(dt: number) {
  const look = input.consumeLook();
  if (state === 'play' || state === 'vista') {
    camYaw -= look.x * 0.0055;
    camPitch = Math.min(1.25, Math.max(-0.32, camPitch + look.y * 0.0045));
  }
  camDist += (camDistTarget - camDist) * Math.min(1, dt * 2.6);
  camLift += (camLiftTarget - camLift) * Math.min(1, dt * 2.2);
  const target = new THREE.Vector3(player.pos.x, player.pos.y + 1.6 + camLift, player.pos.z);
  camTarget.lerp(target, Math.min(1, dt * 10));
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
      player.update(dt, input.move, input.jump, camYaw, world);
      moveSpeed = Math.min(1, Math.hypot(input.move.x, input.move.y));

      nearTower = null;
      for (const t of towers) {
        const d = Math.hypot(player.pos.x - t.def.x, player.pos.z - t.def.z);
        if (d < 6.2) onStone = true;
        if (d < 6.0) { nearTower = t; break; }
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
      saveTimer += dt;
      if (saveTimer > 5) { saveTimer = 0; save(); }
    } else if (state === 'vista') {
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
    updateCamera(dt);
    updateCompass();
  }

  audio.update(dt, {
    altitude: state === 'title' ? 22 : player.pos.y,
    waterProximity: state === 'title' ? 0.25 : sampleWaterProximity(player.pos.x, player.pos.z),
    swimming: player.swimming,
    speed: moveSpeed,
    grounded: player.grounded,
    onStone,
    aerial: state === 'cinematic' || state === 'vista',
  });

  towers.forEach((t) => t.update(elapsed, dt, player.pos, state === 'title'));
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
  camera.fov = w < h ? 72 : 62;
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
    setTimeout(() => toast('踏入未知的山野', '漫步探索，尋找隱於山谷與林間的古碑', 4500), 900);
  }
}
$('btn-start').addEventListener('click', startGame);
$('btn-reset').addEventListener('click', () => {
  localStorage.removeItem(SAVE_KEY);
  allDoneShown = false;
  startGame();
});
window.addEventListener('keydown', () => { if (state !== 'title') audio.unlock(); }, { passive: true });

frame();

if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__game = {
    player, towers, terrain, activate, startVista, openMap, audio,
    setYaw: (y: number) => { camYaw = y; },
    getState: () => state,
  };
}
