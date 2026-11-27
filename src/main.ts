import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import './style.css';
import { Terrain, WATER_LEVEL, smoothstep, type Flatten } from './terrain';
import {
  createSky, createTerrainMesh, createWater, createVegetation, createClouds,
  createAurora, createKarstCloudSea, BirdFlocks,
  DynamicGrassField, Tower, TOWER_DEFS, REVEAL_RADIUS, START_POS, COLORS,
} from './world';
import { Player, type WorldQuery } from './player';
import { Input } from './input';
import { GameMap } from './map';
import { NatureAudio } from './audio';
import { Particles, AmbientMotes } from './fx';
import { createWilds, RingCourse, type Updraft, type CourseEvent } from './collectibles';
import { updateCelTime, updateDayNight, updateBiomeAtmosphere, celUniforms, DAY_PRESETS } from './cel';
import { BIOMES, BIOME_COUNT, sampleBiomeWeights, sampleDominantBiome } from './biomes';
import { WONDER_DEFS, MOMENT_DEFS, Wonder } from './landmarks';
import type { DevGame, GameState, PoiFocusKind } from './dev-harness';

// ------------------------------------------------------------ DOM
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('scene');
const hud = $('hud');
const hudLeft = $('hud-left');
const titleScreen = $('title-screen');
const titleProgress = $('title-progress');
const mapOverlay = $('map-overlay');
const mapCanvas = $<HTMLCanvasElement>('map-canvas');
const btnInteract = $('btn-interact');
const iconResonate = $('icon-resonate');
const iconVista = $('icon-vista');
const iconReturn = $('icon-return');
const btnJump = $('btn-jump');
const iconJump = $('icon-jump');
const iconGlide = $('icon-glide');
const iconLeap = $('icon-leap');
const btnSprint = $('btn-sprint');
const iconSprint = $('icon-sprint');
const iconDive = $('icon-dive');
const btnTime = $('btn-time');
const timeIcons = {
  morning: $('icon-time-morning'),
  sunset: $('icon-time-sunset'),
  night: $('icon-time-night'),
  dawn: $('icon-time-dawn'),
};
const btnAudio = $('btn-audio');
const iconAudioOn = $('icon-audio-on');
const iconAudioOff = $('icon-audio-off');
const btnMap = $('btn-map');
const btnMapLocate = $<HTMLButtonElement>('btn-map-locate');
const btnMapZoomIn = $<HTMLButtonElement>('btn-map-zoom-in');
const btnMapZoomOut = $<HTMLButtonElement>('btn-map-zoom-out');
const towerPill = $('tower-count');
const towerNum = $('tower-count-num');
const orbNum = $('orb-count-num');
const orbTotal = $('orb-count-total');
const orbPill = $('orb-count');
const orbRingSegs = document.getElementById('orb-ring-segs') as unknown as SVGGElement;
const compassStrip = $('compass-strip');
const onboardHint = $('onboard-hint');
const staminaEl = $('stamina');
const staminaFg = document.getElementById('stamina-fg') as unknown as SVGCircleElement;
const staminaBg = document.getElementById('stamina-bg') as unknown as SVGCircleElement;
const speedlines = $('speedlines');
const exhaustVignette = $('exhaust-vignette');
const poiFocusEl = $('poi-focus');
const letterboxEl = $('letterbox');
const momentFrameEl = $('moment-frame');
const trialEl = $('trial');
const trialDotsEl = $('trial-dots');
const trialCount = $('trial-count');
const trialBar = $('trial-bar');
const fxLayer = $('fx-layer');
const actionCueEl = $('action-cue');
const cueGlideSvg = $('cue-glide');
const cueUpdraftSvg = $('cue-updraft');

// Build 5 circular arc segments around the orb icon (each 5 orbs = stamina upgrade)
const orbSegEls: SVGPathElement[] = [];
{
  const cx = 16, cy = 16, r = 13.4;
  const gap = 0.24;
  const step = (Math.PI * 2) / 5;
  for (let i = 0; i < 5; i++) {
    const a0 = i * step + gap / 2;
    const a1 = (i + 1) * step - gap / 2;
    const x0 = cx + Math.cos(a0) * r, y0 = cy + Math.sin(a0) * r;
    const x1 = cx + Math.cos(a1) * r, y1 = cy + Math.sin(a1) * r;
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`);
    p.setAttribute('class', 'orb-seg');
    orbRingSegs.appendChild(p);
    orbSegEls.push(p);
  }
}

// ------------------------------------------------------------ Save & Settings
const SAVE_KEY = 'triangle-explorer-v2';
const MUTE_KEY = 'triangle-explorer-muted';
interface SaveData {
  discovered: number[];
  activated: number[];
  pos?: [number, number, number];
  orbs?: number[];
  courses?: number[];
  tips?: string[];
  explored?: string;
  visitedBiomes?: number[];
  wonders?: string[];
  moments?: string[];
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

// ------------------------------------------------------------ Renderer / scene / post-processing
const isTouch = matchMedia('(pointer: coarse)').matches;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
renderer.toneMapping = THREE.AgXToneMapping;
renderer.toneMappingExposure = 1.08;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(COLORS.horizon, 70, 460);
const camera = new THREE.PerspectiveCamera(62, 1, 0.3, 1500);

// Selective Soft Bloom (HDR HalfFloat target + half-res bloom + AgX OutputPass)
const composerTarget = new THREE.WebGLRenderTarget(1, 1, {
  type: THREE.HalfFloatType,
});
const composer = new EffectComposer(renderer, composerTarget);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.32, 0.56, 0.98);
// Sanitize any stray NaN/Inf HDR texels before they enter the 5-mip separable Gaussian blur
// pyramid (where a single non-finite pixel otherwise spreads into a screen-sized white rectangle).
bloomPass.materialHighPassFilter.fragmentShader = bloomPass.materialHighPassFilter.fragmentShader.replace(
  'vec4 texel = texture2D( tDiffuse, vUv );',
  /* glsl */ `
  vec4 texel = texture2D( tDiffuse, vUv );
  texel.rgb = vec3(
    ( texel.r >= 0.0 && texel.r <= 65000.0 ) ? min( texel.r, 12.0 ) : 0.0,
    ( texel.g >= 0.0 && texel.g <= 65000.0 ) ? min( texel.g, 12.0 ) : 0.0,
    ( texel.b >= 0.0 && texel.b <= 65000.0 ) ? min( texel.b, 12.0 ) : 0.0
  );
  `,
);
bloomPass.materialHighPassFilter.needsUpdate = true;
composer.addPass(bloomPass);
const outputPass = new OutputPass();
outputPass.material.fragmentShader = outputPass.material.fragmentShader.replace(
  'gl_FragColor = texture2D( tDiffuse, vUv );',
  /* glsl */ `
  gl_FragColor = texture2D( tDiffuse, vUv );
  gl_FragColor.rgb = vec3(
    ( gl_FragColor.r >= 0.0 && gl_FragColor.r <= 65000.0 ) ? gl_FragColor.r : 0.0,
    ( gl_FragColor.g >= 0.0 && gl_FragColor.g <= 65000.0 ) ? gl_FragColor.g : 0.0,
    ( gl_FragColor.b >= 0.0 && gl_FragColor.b <= 65000.0 ) ? gl_FragColor.b : 0.0
  );
  `,
);
outputPass.material.needsUpdate = true;
composer.addPass(outputPass);

const sunDir = new THREE.Vector3(0.48, 0.58, 0.36).normalize();
const hemi = new THREE.HemisphereLight('#d6eeff', '#7b6d4a', 1.4);
scene.add(hemi);
const sun = new THREE.DirectionalLight('#fff3db', 2.4);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
const SHADOW_RANGE = 62;
const SHADOW_TEXEL = (SHADOW_RANGE * 2) / 1024;
sun.shadow.camera.left = -SHADOW_RANGE;
sun.shadow.camera.right = SHADOW_RANGE;
sun.shadow.camera.top = SHADOW_RANGE;
sun.shadow.camera.bottom = -SHADOW_RANGE;
sun.shadow.camera.near = 10;
sun.shadow.camera.far = 260;
sun.shadow.bias = -0.00045;
sun.shadow.normalBias = 0.08;
sun.position.copy(sunDir).multiplyScalar(120);
scene.add(sun, sun.target);

const shadowFocus = new THREE.Vector3();
function updateSunShadow(fx: number, fy: number, fz: number) {
  // Texel-snap to prevent shadow edge shimmer during movement
  const sx = Math.round(fx / SHADOW_TEXEL) * SHADOW_TEXEL;
  const sz = Math.round(fz / SHADOW_TEXEL) * SHADOW_TEXEL;
  shadowFocus.set(sx, fy, sz);
  sun.target.position.copy(shadowFocus);
  sun.position.copy(shadowFocus).addScaledVector(sunDir, 125);
  sun.target.updateMatrixWorld();
}

// Day / Night cycle (1 full day = 6 minutes; smooth manual glide via T / celestial button)
const DAY_DURATION = 360;
let timeOfDay = 0.39; // bright late-morning start
let timePresetIdx = 0;
let timeGlide: { from: number; delta: number; t: number; dur: number } | null = null;
let lastTimePhase: 'morning' | 'sunset' | 'night' | 'dawn' = 'morning';

function syncTimeIcon(phase: 'morning' | 'sunset' | 'night' | 'dawn') {
  timeIcons.morning.hidden = phase !== 'morning';
  timeIcons.sunset.hidden = phase !== 'sunset';
  timeIcons.night.hidden = phase !== 'night';
  timeIcons.dawn.hidden = phase !== 'dawn';
  if (phase !== lastTimePhase) {
    lastTimePhase = phase;
    btnTime.classList.remove('spin');
    void btnTime.offsetWidth;
    btnTime.classList.add('spin');
  }
}

function applyDayNight(tod: number) {
  const dn = updateDayNight(tod);
  sunDir.copy(dn.lightDir);
  hemi.color.copy(dn.hemiSky);
  hemi.groundColor.copy(dn.hemiGround);
  hemi.intensity = dn.hemiIntensity;
  bloomPass.strength = dn.bloomStrength;
  syncTimeIcon(dn.phase);
}
applyDayNight(timeOfDay);

const flats: Flatten[] = [
  ...TOWER_DEFS.map((d) => ({ x: d.x, z: d.z, r: 13 })),
  { ...START_POS, r: 16 },
  ...WONDER_DEFS.map((w) => w.flat),
];
const terrain = new Terrain(flats);
const sky = createSky(sunDir);
scene.add(sky, createTerrainMesh(terrain), createWater(terrain));

const vegAvoid = [
  ...TOWER_DEFS.map((d) => ({ x: d.x, z: d.z, r: 10.5 })),
  { x: START_POS.x, z: START_POS.z, r: 12 },
  ...WONDER_DEFS.map((w) => ({ x: w.x, z: w.z, r: w.avoidR })),
];
scene.add(createVegetation(terrain, vegAvoid));

const grassField = new DynamicGrassField(
  terrain,
  WONDER_DEFS.map((w) => ({ x: w.x, z: w.z, r: w.avoidR * 0.55 })),
);
scene.add(grassField.group);
const clouds = createClouds();
const aurora = createAurora();
const karstCloudSea = createKarstCloudSea();
const birdFlocks = new BirdFlocks();
scene.add(clouds, aurora, karstCloudSea, birdFlocks.mesh);

const towers = TOWER_DEFS.map((d, i) => new Tower(d, i, terrain.height(d.x, d.z)));
towers.forEach((t) => scene.add(t.group));

const wonders = WONDER_DEFS.map((d) => new Wonder(d, terrain));
wonders.forEach((w) => scene.add(w.group));

const wilds = createWilds(terrain, towers.map((t) => ({ x: t.def.x, z: t.def.z, base: t.base })), START_POS);
const { orbs, updrafts, courses } = wilds;
scene.add(orbs.group);
updrafts.forEach((u) => scene.add(u.group));
courses.forEach((c) => scene.add(c.group));

const sparkles = new Particles(900, true);
const dust = new Particles(400, false);
const ambientMotes = new AmbientMotes(320);
scene.add(sparkles.points, dust.points, ambientMotes.points);

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
    for (const w of wonders) {
      if (Math.hypot(p.x - w.def.x, p.z - w.def.z) > 26) continue;
      for (const col of w.colliders) {
        const dx = p.x - col.x, dz = p.z - col.z;
        const d = Math.hypot(dx, dz);
        if (d < col.r && d > 1e-4) {
          p.x = col.x + (dx / d) * col.r;
          p.z = col.z + (dz / d) * col.r;
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
input.bindButton(btnJump, () => { audio.unlock(); input.jump = true; });
input.bindHold(btnSprint, () => audio.unlock());
input.bindButton(btnInteract, () => { audio.unlock(); input.action = true; });
input.bindButton(btnMap, () => { audio.unlock(); input.map = true; });
input.bindButton($('btn-map-close'), () => closeMap());
input.bindButton(btnMapZoomIn, () => {
  if (state !== 'map') return;
  const cur = gameMap.getTargetView();
  if (!gameMap.isZoomed()) {
    gameMap.focusOn(player.pos.x, player.pos.z, GameMap.REGIONAL_ZOOM);
  } else {
    gameMap.setView(Math.min(GameMap.MAX_ZOOM, cur.zoom * 1.45), cur.centerX, cur.centerZ);
  }
  syncMapControls();
});
input.bindButton(btnMapZoomOut, () => {
  if (state !== 'map') return;
  const cur = gameMap.getTargetView();
  if (cur.zoom <= 2.0) {
    gameMap.resetView(false);
  } else {
    gameMap.setView(cur.zoom / 1.45, cur.centerX, cur.centerZ);
  }
  syncMapControls();
});
input.bindButton(btnMapLocate, () => {
  if (state !== 'map') return;
  const cur = gameMap.getTargetView();
  if (!gameMap.isZoomed()) {
    gameMap.focusOn(player.pos.x, player.pos.z, GameMap.REGIONAL_ZOOM);
  } else if (Math.hypot(cur.centerX - player.pos.x, cur.centerZ - player.pos.z) < 12) {
    gameMap.resetView(false);
  } else {
    gameMap.focusOn(player.pos.x, player.pos.z, cur.zoom);
  }
  syncMapControls();
});
mapOverlay.addEventListener('pointerdown', (e) => {
  if (e.target === mapOverlay) closeMap();
});

// Direct touch & mouse gestures on the parchment map: pinch-to-zoom, drag-to-pan, double-tap & wheel zoom
{
  const pointers = new Map<number, { x: number; y: number }>();
  let pinchStartDist = 0;
  let pinchStartZoom = 1;
  let pinchLastMid = { x: 0, y: 0 };
  let panLast = { x: 0, y: 0 };
  let tapStart = { x: 0, y: 0, t: 0, moved: false };
  let lastTap = { x: 0, y: 0, t: 0 };

  const preventMapTouch = (e: Event) => e.preventDefault();
  mapCanvas.addEventListener('touchstart', preventMapTouch, { passive: false });
  mapCanvas.addEventListener('touchmove', preventMapTouch, { passive: false });
  mapCanvas.addEventListener('touchend', preventMapTouch, { passive: false });

  mapCanvas.addEventListener('pointerdown', (e) => {
    if (state !== 'map') return;
    e.preventDefault();
    e.stopPropagation();
    try { mapCanvas.setPointerCapture(e.pointerId); } catch { /* synthetic or ended pointer */ }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 1) {
      panLast = { x: e.clientX, y: e.clientY };
      tapStart = { x: e.clientX, y: e.clientY, t: performance.now(), moved: false };
      if (gameMap.isZoomed()) mapCanvas.classList.add('panning');
    } else if (pointers.size === 2) {
      const pts = [...pointers.values()];
      pinchStartDist = Math.max(12, Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y));
      pinchStartZoom = gameMap.getView().zoom;
      pinchLastMid = { x: (pts[0].x + pts[1].x) * 0.5, y: (pts[0].y + pts[1].y) * 0.5 };
      tapStart.moved = true;
      mapCanvas.classList.add('panning');
    }
  });

  mapCanvas.addEventListener('pointermove', (e) => {
    if (state !== 'map' || !pointers.has(e.pointerId)) return;
    e.preventDefault();
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 1) {
      const dx = e.clientX - panLast.x;
      const dy = e.clientY - panLast.y;
      panLast = { x: e.clientX, y: e.clientY };
      if (Math.hypot(e.clientX - tapStart.x, e.clientY - tapStart.y) > 8) {
        tapStart.moved = true;
      }
      if (gameMap.getView().zoom > 1.01) {
        gameMap.panByCanvasDelta(mapCanvas, dx, dy);
      }
    } else if (pointers.size === 2) {
      const pts = [...pointers.values()];
      const dist = Math.max(12, Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y));
      const midX = (pts[0].x + pts[1].x) * 0.5;
      const midY = (pts[0].y + pts[1].y) * 0.5;
      gameMap.panByCanvasDelta(mapCanvas, midX - pinchLastMid.x, midY - pinchLastMid.y);
      pinchLastMid = { x: midX, y: midY };
      const nextZoom = pinchStartZoom * (dist / pinchStartDist);
      gameMap.zoomAroundClientPoint(mapCanvas, midX, midY, nextZoom, true);
      syncMapControls();
    }
  });

  const endMapPointer = (e: PointerEvent) => {
    if (!pointers.has(e.pointerId)) return;
    const wasSingle = pointers.size === 1;
    pointers.delete(e.pointerId);
    if (pointers.size === 1) {
      const [rem] = pointers.values();
      panLast = { x: rem.x, y: rem.y };
      tapStart.moved = true;
    } else if (pointers.size === 0) {
      mapCanvas.classList.remove('panning');
      const now = performance.now();
      if (wasSingle && !tapStart.moved && now - tapStart.t < 280 && state === 'map') {
        if (now - lastTap.t < 360 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 36) {
          if (gameMap.isZoomed()) {
            gameMap.resetView(false);
          } else {
            gameMap.zoomAroundClientPoint(mapCanvas, e.clientX, e.clientY, GameMap.REGIONAL_ZOOM, false);
          }
          syncMapControls();
          lastTap.t = 0;
        } else {
          lastTap = { x: e.clientX, y: e.clientY, t: now };
        }
      }
    }
  };
  mapCanvas.addEventListener('pointerup', endMapPointer);
  mapCanvas.addEventListener('pointercancel', endMapPointer);

  mapCanvas.addEventListener('wheel', (e) => {
    if (state !== 'map') return;
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.25 : 1 / 1.25;
    gameMap.zoomAroundClientPoint(mapCanvas, e.clientX, e.clientY, gameMap.getTargetView().zoom * factor, false);
    syncMapControls();
  }, { passive: false });
}

hudLeft.addEventListener('pointerdown', (e) => {
  e.stopPropagation();
  wakeHud(4500);
});

function cycleTimeOfDay() {
  timePresetIdx = (timePresetIdx + 1) % DAY_PRESETS.length;
  const preset = DAY_PRESETS[timePresetIdx];
  const delta = ((preset.t - timeOfDay) % 1 + 1) % 1;
  timeGlide = { from: timeOfDay, delta: delta < 0.02 ? delta + 1 : delta, t: 0, dur: 1.5 };
  syncTimeIcon(preset.phase);
  audio.playTimeShift(preset.phase);
}
input.bindButton(btnTime, () => {
  audio.unlock();
  if (state === 'play' || state === 'vista') cycleTimeOfDay();
});
input.bindButton(btnAudio, () => {
  const m = audio.toggleMute();
  localStorage.setItem(MUTE_KEY, m ? '1' : '0');
  syncAudioUI();
});
input.onFirstMove = () => {
  audio.unlock();
  dismissOnboardHint();
};
document.body.classList.toggle('touch', isTouch);

// ------------------------------------------------------------ State
let state: GameState = 'title';
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
const camLook = new THREE.Vector3();
let nearTower: Tower | null = null;
let lastNearShrineIdx = -1;
let cine: {
  tower: Tower;
  updraft: Updraft | undefined;
  t: number;
  upgradePlayed: boolean;
  updraftPlayed: boolean;
} | null = null;
let introSwoop: {
  fromPos: THREE.Vector3;
  fromLook: THREE.Vector3;
  t: number;
  dur: number;
} | null = null;
let vistaBreath = 0; // brief horizon swell when grabbing a mountain-peak orb
let momentFocus = 0; // 0..1 gentle camera focus while dwelling in a Temporal Moment
let poiFocus = 0; // 0..1 one-time camera zoom, gaze focus & framing pulse on first-sight Wonder discovery
let poiKind: PoiFocusKind = 'none';
const poiFocusPos = new THREE.Vector3();
let poiFocusHasPos = false;
let poiPulse: { pos: THREE.Vector3; t: number; dur: number; color: string; kind: 'wonder' } | null = null;
let poiSparkleAcc = 0;
let mapAnimating = false;
let elapsed = 0;
let allDoneShown = false;
let everythingShown = false;
const tipsShown = new Set<string>();
const visitedBiomes = new Set<number>();
const capturedMoments = new Set<string>();
const momentDwell = new Map<string, number>();
const curBiomeWeights = new Float32Array(BIOME_COUNT);
let currentBiome = 0;
let pendingBiome = 0;
let pendingBiomeT = 0;
const regionLastShown = new Map<number, number>();
let hudQuietTimer = 0;
let letterboxTimer = 0;
let onboardShowTimer = 0;
let staminaForceT = 0;
let staminaUpgradeT = 0;
let glideCuePlayed = false;

// ------------------------------------------------------------ Wordless UI & FX helpers
function wakeHud(ms = 4800) {
  hudLeft.classList.remove('quiet');
  clearTimeout(hudQuietTimer);
  hudQuietTimer = window.setTimeout(() => {
    if (state === 'play') hudLeft.classList.add('quiet');
  }, ms);
}

function dismissOnboardHint() {
  clearTimeout(onboardShowTimer);
  onboardHint.classList.remove('show');
  onboardHint.classList.add('gone');
}

function triggerLetterbox(ms = 2400) {
  clearTimeout(letterboxTimer);
  letterboxEl.classList.add('show');
  letterboxTimer = window.setTimeout(() => {
    letterboxEl.classList.remove('show');
  }, ms);
}

function updateRegionTracking(dt: number) {
  const { index, weight } = sampleDominantBiome(player.pos.x, player.pos.z);
  if (index === currentBiome) {
    pendingBiome = currentBiome;
    pendingBiomeT = 0;
    return;
  }
  if (weight < 0.42) return;
  if (index !== pendingBiome) {
    pendingBiome = index;
    pendingBiomeT = 0;
  } else {
    pendingBiomeT += dt;
    if (pendingBiomeT >= 0.75) {
      currentBiome = index;
      pendingBiomeT = 0;
      const isFirst = !visitedBiomes.has(index);
      const lastT = regionLastShown.get(index) ?? -999;
      if (isFirst) {
        visitedBiomes.add(index);
        regionLastShown.set(index, elapsed);
        audio.playRegionEnter(index, true);
        save();
      } else if (elapsed - lastT > 28) {
        regionLastShown.set(index, elapsed);
        audio.playRegionEnter(index, false);
      }
    }
  }
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

function spawnPickupRipple(p: THREE.Vector3, color: string, scale = 3.2) {
  const s = toScreen(p);
  if (!s.ok) return;
  const el = document.createElement('div');
  el.className = 'pickup-ripple';
  el.style.left = `${s.x}px`;
  el.style.top = `${s.y}px`;
  el.style.color = color;
  el.style.setProperty('--s', String(scale));
  fxLayer.appendChild(el);
  window.setTimeout(() => el.remove(), 700);
}

/** Smoothly flies glowing screen-space light-motes along a curved arc to a HUD element. */
function spawnFlyMotes(
  fromX: number, fromY: number,
  targetEl: HTMLElement,
  color: string,
  opts: { count?: number; star?: boolean; dur?: number; onArrive?: () => void } = {},
) {
  const rect = targetEl.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) {
    opts.onArrive?.();
    return;
  }
  const tx = rect.left + rect.width * 0.5;
  const ty = rect.top + rect.height * 0.5;
  const count = opts.count ?? 1;
  const dur = opts.dur ?? 680;
  let arrived = false;

  for (let i = 0; i < count; i++) {
    const el = document.createElement('div');
    el.className = opts.star ? 'fly-mote star' : 'fly-mote';
    el.style.background = color;
    el.style.boxShadow = `0 0 12px ${color}, 0 0 4px #ffffff`;
    fxLayer.appendChild(el);

    const delay = i * 65;
    const spread = (i - (count - 1) * 0.5) * 44;
    const mx = (fromX + tx) * 0.5 + spread + (Math.random() - 0.5) * 32;
    const my = Math.min(fromY, ty) - 48 - Math.random() * 44;
    const start = performance.now() + delay;

    const tick = (now: number) => {
      const raw = (now - start) / dur;
      if (raw < 0) {
        el.style.opacity = '0';
        requestAnimationFrame(tick);
        return;
      }
      if (raw >= 1) {
        el.remove();
        if (!arrived) {
          arrived = true;
          opts.onArrive?.();
        }
        return;
      }
      const t = raw * raw * (3 - 2 * raw);
      const u = 1 - t;
      const x = u * u * fromX + 2 * u * t * mx + t * t * tx;
      const y = u * u * fromY + 2 * u * t * my + t * t * ty;
      const sc = 0.7 + Math.sin(t * Math.PI) * 0.65;
      el.style.opacity = String(Math.min(1, (1 - raw) * 3.5));
      el.style.transform = `translate(${x}px, ${y}px) scale(${sc})`;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
}

function pingEl(el: HTMLElement, cls: string) {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

function updateOrbRing(justUpgraded = false) {
  const rem = orbs.count % 5;
  const lit = justUpgraded ? 5 : rem;
  for (let i = 0; i < 5; i++) {
    orbSegEls[i].classList.toggle('lit', i < lit);
  }
}

function updateCounter() {
  const n = towers.filter((t) => t.activated).length;
  towerNum.textContent = String(n);
  towerPill.classList.toggle('complete', n >= towers.length);
  orbNum.textContent = String(orbs.count);
  orbTotal.textContent = `/ ${orbs.total}`;
  updateOrbRing();
}

function triggerStaminaUpgradeVisual(fromOrbPill = false) {
  staminaForceT = 2.9;
  staminaUpgradeT = 1.3;
  staminaEl.classList.remove('upgraded');
  void staminaEl.offsetWidth;
  staminaEl.classList.add('upgraded');
  if (fromOrbPill) {
    const r = orbPill.getBoundingClientRect();
    spawnFlyMotes(r.left + r.width * 0.5, r.top + r.height * 0.5, staminaEl, '#8dff9a', {
      count: 3,
      dur: 560,
    });
  }
}

// ------------------------------------------------------------ Progress & Save
function staminaMaxFor() {
  const act = towers.filter((t) => t.activated).length;
  return 100 + act * 15 + Math.floor(orbs.count / 5) * 10;
}

function resetPlayer() {
  player.staminaMax = staminaMaxFor();
  player.place(START_POS.x, terrain.height(START_POS.x, START_POS.z), START_POS.z);
  player.facing = Math.PI;
  camYaw = 0; // face north across the valley toward breadcrumb orb trail
}

function applySave() {
  const s = loadSave();
  gameMap.reset();
  towers.forEach((t) => { t.discovered = false; t.setActivated(false); });
  wonders.forEach((w) => { w.discovered = false; });
  updrafts.forEach((u) => { if (u.towerIndex >= 0) u.active = false; });
  orbs.defs.forEach((d, i) => { orbs.setCollected(i, false); if (d.kind === 'reward') orbs.hide(i); });
  courses.forEach((c) => c.setDone(false));
  tipsShown.clear();
  visitedBiomes.clear();
  capturedMoments.clear();
  momentDwell.clear();
  regionLastShown.clear();
  poiPulse = null;
  poiFocus = 0;
  poiKind = 'none';
  poiFocusHasPos = false;
  poiSparkleAcc = 0;
  poiFocusEl.style.setProperty('--poi', '0');
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
    (s.visitedBiomes ?? []).forEach((b) => b >= 0 && b < BIOME_COUNT && visitedBiomes.add(b));
    (s.wonders ?? []).forEach((id) => {
      const w = wonders.find((x) => x.def.id === id);
      if (w) w.discovered = true;
    });
    (s.moments ?? []).forEach((id) => capturedMoments.add(id));
    gameMap.loadTrail(s.explored);
  }
  resetPlayer();
  if (s?.pos) {
    const gx = s.pos[0], gz = s.pos[2];
    const gy = Math.max(world.ground(gx, gz, 0), WATER_LEVEL - 1.1);
    player.place(gx, gy, gz);
  }
  const startBio = sampleDominantBiome(player.pos.x, player.pos.z).index;
  currentBiome = startBio;
  pendingBiome = startBio;
  visitedBiomes.add(startBio);
  sampleBiomeWeights(player.pos.x, player.pos.z, curBiomeWeights);
  updateBiomeAtmosphere(curBiomeWeights, 1, true);
  gameMap.explore(player.pos.x, player.pos.z);
}

function save() {
  const data: SaveData = {
    discovered: towers.filter((t) => t.discovered).map((t) => t.index),
    activated: towers.filter((t) => t.activated).map((t) => t.index),
    pos: [player.pos.x, player.pos.y, player.pos.z],
    orbs: orbs.collected.flatMap((c, i) => (c ? [i] : [])),
    courses: courses.filter((c) => c.done).map((c) => c.id),
    tips: [...tipsShown],
    explored: gameMap.serializeTrail(),
    visitedBiomes: [...visitedBiomes],
    wonders: wonders.filter((w) => w.discovered).map((w) => w.def.id),
    moments: [...capturedMoments],
  };
  localStorage.setItem(SAVE_KEY, JSON.stringify(data));
}

// ------------------------------------------------------------ Compass (Wordless Geometric)
const compassItems: { el: HTMLElement; bearing: () => number; alpha: () => number }[] = [];
const towerCompassEls: HTMLElement[] = [];

// Cardinal markers: coral North triangle, tall E/W ticks, diamond South
for (let i = 0; i < 4; i++) {
  const el = document.createElement('span');
  el.className = i === 0 ? 'c-north' : i === 2 ? 'c-south' : 'c-cardinal';
  compassStrip.appendChild(el);
  compassItems.push({ el, bearing: () => (i * Math.PI) / 2, alpha: () => 1 });
}
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
  towerCompassEls.push(el);
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
  if (staminaForceT > 0) staminaForceT = Math.max(0, staminaForceT - dt);
  if (staminaUpgradeT > 0) {
    staminaUpgradeT = Math.max(0, staminaUpgradeT - dt);
    if (staminaUpgradeT === 0) staminaEl.classList.remove('upgraded');
  }
  const full = player.stamina >= player.staminaMax - 0.01 && !player.exhausted;
  const busy = player.climbing || player.gliding || player.sprinting;
  staminaShowT = full && !busy ? Math.max(0, staminaShowT - dt) : 1.0;
  const visible = (state === 'play' || state === 'cinematic') && (staminaShowT > 0 || staminaForceT > 0);
  staminaEl.classList.toggle('show', visible);
  exhaustVignette.classList.toggle('show', state === 'play' && player.exhausted);
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
function playerMapPose() {
  return {
    x: player.pos.x,
    z: player.pos.z,
    facing: player.facing,
    camYaw,
  };
}

function syncMapControls() {
  const tv = gameMap.getTargetView();
  btnMapZoomIn.disabled = tv.zoom >= GameMap.MAX_ZOOM - 0.05;
  btnMapZoomOut.disabled = tv.zoom <= GameMap.MIN_ZOOM + 0.05;
  btnMapLocate.classList.toggle('active', gameMap.isZoomed());
}

function updateMapStats() {
  const n = towers.filter((t) => t.activated).length;
  const w = wonders.filter((x) => x.discovered).length;
  const m = capturedMoments.size;
  const c = courses.filter((c) => c.done).length;
  $('ms-tower').textContent = `${n}/${towers.length}`;
  $('ms-orb').textContent = `${orbs.count}/${orbs.total}`;
  $('ms-wonder').textContent = `${w}/${wonders.length}`;
  $('ms-moment').textContent = `${m}/${MOMENT_DEFS.length}`;
  $('ms-trial').textContent = `${c}/${courses.length}`;
}

function openMap(animate = false) {
  clearTimeout(mapHideTimer);
  state = 'map';
  mapAnimating = animate;
  gameMap.resetView(true);
  syncMapControls();
  audio.updateMomentDwell(0);
  momentFrameEl.style.setProperty('--dwell', '0');
  poiFocusEl.style.setProperty('--poi', '0');
  audio.playMap(true);
  updateMapStats();
  mapOverlay.hidden = false;
  gameMap.draw(mapCanvas, towers, elapsed, visitedBiomes, wonders, playerMapPose());
  void mapOverlay.offsetWidth;
  mapOverlay.classList.add('open');
}

function closeMap() {
  if (state !== 'map') return;
  if (mapAnimating) {
    gameMap.finishReveals();
    mapAnimating = false;
  }
  audio.playMap(false);
  mapOverlay.classList.remove('open');
  clearTimeout(mapHideTimer);
  mapHideTimer = window.setTimeout(() => { mapOverlay.hidden = true; }, 250);
  state = 'play';
  camDistTarget = 10;
  camLiftTarget = 0;
  wakeHud(4200);
  if (towers.every((t) => t.activated) && !allDoneShown) {
    allDoneShown = true;
    audio.playAllDone();
    pingEl(towerPill, 'bump');
    const p = new THREE.Vector3(player.pos.x, player.pos.y + 1.8, player.pos.z);
    sparkles.burst(p, 90, '#ffe27a', 12, 0.75, 2.2, 0.5);
    sparkles.burst(p, 55, '#7ff0ff', 10, 0.65, 2.0, 0.2);
  }
}

// ------------------------------------------------------------ Proximity & Sight Discovery
const ndc = new THREE.Vector3();
const losPt = new THREE.Vector3();
const lookDirV = new THREE.Vector3();
function lineOfSight(from: THREE.Vector3, to: THREE.Vector3): boolean {
  const steps = 44;
  for (let i = 2; i < steps; i++) {
    losPt.lerpVectors(from, to, i / steps);
    if (terrain.height(losPt.x, losPt.z) > losPt.y) return false;
  }
  return true;
}

const WONDER_SHIMMER_COLORS: Record<string, string> = {
  sakura: '#ffc4da',
  arch: '#8ff5e8',
  bones: '#ffe0a8',
  gate: '#6beeff',
  spirittree: '#6cffdd',
  ice_spire: '#b6eeff',
};

let discoverTimer = 0;
function checkDiscovery(dt: number) {
  if (introSwoop) return;
  discoverTimer -= dt;
  if (discoverTimer > 0) return;
  discoverTimer = 0.25;
  const inViewAndVisible = (pt: THREE.Vector3): boolean => {
    ndc.copy(pt).project(camera);
    if (Math.abs(ndc.x) > 0.88 || Math.abs(ndc.y) > 0.88 || ndc.z <= 0 || ndc.z > 1) return false;
    return lineOfSight(camera.position, pt);
  };
  for (const t of towers) {
    if (t.discovered) continue;
    const playerDist = Math.hypot(t.def.x - player.pos.x, t.def.z - player.pos.z);
    if (playerDist > 210) continue;
    const altarPt = new THREE.Vector3(t.def.x, t.base + 3.6, t.def.z);
    const plumePt = new THREE.Vector3(t.def.x, t.base + 16.0, t.def.z);
    const seenPt = inViewAndVisible(altarPt)
      ? altarPt
      : (!t.activated && inViewAndVisible(plumePt))
        ? plumePt
        : null;
    if (!seenPt) continue;
    t.discovered = true;
    audio.playDiscover();
    sparkles.burst(seenPt, 32, '#ffc966', 6, 0.55, 1.2, 0.5);
    spawnPickupRipple(seenPt, '#ffc966', 4.0);
    const marker = towerCompassEls[t.index];
    if (marker) pingEl(marker, 'ping');
    wakeHud(4200);
    save();
  }
  // Six regional Wonders: simply seeing the landmark with an unobstructed view discovers it
  for (const w of wonders) {
    if (w.discovered) continue;
    const dist = Math.hypot(w.def.x - player.pos.x, w.def.z - player.pos.z);
    if (dist > w.def.sightDist) continue;
    ndc.copy(w.sightPos).project(camera);
    if (Math.abs(ndc.x) > 0.86 || Math.abs(ndc.y) > 0.86 || ndc.z <= 0 || ndc.z > 1) continue;
    if (!lineOfSight(camera.position, w.sightPos)) continue;
    w.discovered = true;
    audio.playWonderDiscover();
    triggerLetterbox(3900);
    if (state === 'play') {
      poiPulse = {
        pos: w.sightPos.clone(),
        t: 0,
        dur: 4.0,
        color: WONDER_SHIMMER_COLORS[w.def.id] ?? '#ffd685',
        kind: 'wonder',
      };
    }
    sparkles.burst(w.sightPos, 65, '#ffe27a', 11, 0.8, 1.8, 0.4);
    spawnPickupRipple(w.sightPos, '#ff7d63', 5.2);
    const sc = toScreen(w.sightPos);
    if (sc.ok) {
      spawnFlyMotes(sc.x, sc.y, btnMap, '#ef6a52', {
        count: 1,
        star: true,
        dur: 860,
        onArrive: () => pingEl(btnMap, 'ping-red'),
      });
    } else {
      pingEl(btnMap, 'ping-red');
    }
    save();
  }
}

const tmpPoiCandidate = new THREE.Vector3();

/** Drives the one-time first-sight Wonder camera emphasis pulse and ambient Wonder shimmer motes. */
function updatePoiFocus(dt: number) {
  if (state !== 'play' || introSwoop) {
    poiPulse = null;
    poiFocus = Math.max(0, poiFocus - dt * 4.5);
    if (poiFocus < 0.002) {
      poiFocus = 0;
      poiKind = 'none';
      poiFocusHasPos = false;
    }
    poiFocusEl.style.setProperty('--poi', poiFocus.toFixed(3));
    return;
  }

  // One-time discovery emphasis pulse when a Wonder first enters the frame (~4s smooth swell & release)
  let targetFocus = 0;
  if (poiPulse) {
    poiPulse.t += dt;
    if (poiPulse.t >= poiPulse.dur) {
      poiPulse = null;
    } else {
      const pulseEase = Math.sin((poiPulse.t / poiPulse.dur) * Math.PI);
      targetFocus = pulseEase * 0.95;
      poiKind = poiPulse.kind;
      tmpPoiCandidate.copy(poiPulse.pos);
      if (!poiFocusHasPos) {
        poiFocusPos.copy(tmpPoiCandidate);
        poiFocusHasPos = true;
      } else {
        poiFocusPos.lerp(tmpPoiCandidate, Math.min(1, dt * 6));
      }
      poiFocusEl.style.setProperty('--poi-color', poiPulse.color);
    }
  }

  const focusRate = targetFocus > poiFocus ? 5.0 : 4.5;
  poiFocus += (targetFocus - poiFocus) * Math.min(1, dt * focusRate);
  if (targetFocus <= 0 && poiFocus < 0.005) {
    poiFocus = 0;
    poiKind = 'none';
    poiFocusHasPos = false;
  }

  poiFocusEl.style.setProperty('--poi', poiFocus.toFixed(3));

  // Living ambient shimmer motes around a nearby Wonder (purely visual; no camera effect)
  let nearWonder: Wonder | null = null;
  let nearWonderProx = 0;
  for (const w of wonders) {
    const d = Math.hypot(w.def.x - player.pos.x, w.def.z - player.pos.z);
    if (d > 70) continue;
    const prox = smoothstep(70, 20, d);
    if (prox > nearWonderProx) {
      nearWonderProx = prox;
      nearWonder = w;
    }
  }
  if (nearWonder && nearWonderProx > 0.15) {
    poiSparkleAcc += dt * (4 + nearWonderProx * 10);
    const col = WONDER_SHIMMER_COLORS[nearWonder.def.id] ?? '#ffe27a';
    while (poiSparkleAcc >= 1) {
      poiSparkleAcc -= 1;
      const a = Math.random() * Math.PI * 2;
      const rr = 3 + Math.random() * Math.max(8, nearWonder.def.avoidR * 0.85);
      sparkles.spawn(
        nearWonder.def.x + Math.cos(a) * rr,
        nearWonder.baseY + 1.2 + Math.random() * nearWonder.def.sightY * 1.15,
        nearWonder.def.z + Math.sin(a) * rr,
        (Math.random() - 0.5) * 0.8,
        0.9 + Math.random() * 1.5,
        (Math.random() - 0.5) * 0.8,
        col,
        0.38 + Math.random() * 0.35,
        1.5 + Math.random() * 0.9,
        0,
        0.2,
      );
    }
  } else {
    poiSparkleAcc = 0;
  }
}

/** Five Temporal Vistas: pause calmly in the right place & time of day to capture. */
function checkMoments(dt: number) {
  if (capturedMoments.size >= MOMENT_DEFS.length) {
    momentFocus = Math.max(0, momentFocus - dt * 2);
    momentFrameEl.style.setProperty('--dwell', '0');
    audio.updateMomentDwell(0);
    return;
  }
  const { index: biomeIndex, weight: biomeWeight } = sampleDominantBiome(player.pos.x, player.pos.z);
  camera.getWorldDirection(lookDirV);
  const calm = state === 'vista' || player.speedXZ < 6.5;
  const ctx = {
    biomeIndex,
    biomeWeight,
    x: player.pos.x,
    y: player.pos.y,
    z: player.pos.z,
    timeOfDay,
    nightFactor: celUniforms.uNightFactor.value,
    sunsetFactor: celUniforms.uSunsetFactor.value,
    lookDir: lookDirV,
  };
  let maxProgress = 0;
  for (const m of MOMENT_DEFS) {
    if (capturedMoments.has(m.id)) continue;
    const prev = momentDwell.get(m.id) ?? 0;
    if (calm && m.matches(ctx)) {
      const next = prev + dt;
      if (next >= 2.2) {
        capturedMoments.add(m.id);
        momentDwell.delete(m.id);
        audio.updateMomentDwell(0);
        audio.playMomentCapture();
        momentFrameEl.style.setProperty('--dwell', '0');
        momentFrameEl.classList.remove('flash');
        void momentFrameEl.offsetWidth;
        momentFrameEl.classList.add('flash');
        const p = new THREE.Vector3(player.pos.x, player.pos.y + 2.0, player.pos.z);
        sparkles.burst(p, 55, '#ffe8a3', 8, 0.65, 1.8, -0.4);
        spawnFlyMotes(window.innerWidth * 0.5, window.innerHeight * 0.44, btnMap, '#ffe27a', {
          count: 3,
          star: true,
          dur: 820,
          onArrive: () => pingEl(btnMap, 'ping-gold'),
        });
        save();
      } else {
        momentDwell.set(m.id, next);
        maxProgress = Math.max(maxProgress, next / 2.2);
      }
    } else if (prev > 0) {
      const decayed = Math.max(0, prev - dt * 0.7);
      if (decayed <= 0) momentDwell.delete(m.id);
      else {
        momentDwell.set(m.id, decayed);
        maxProgress = Math.max(maxProgress, decayed / 2.2);
      }
    }
  }
  momentFocus += (maxProgress - momentFocus) * Math.min(1, dt * 4);
  momentFrameEl.style.setProperty('--dwell', maxProgress.toFixed(3));
  audio.updateMomentDwell(maxProgress);
}

// ------------------------------------------------------------ Resonance & Aerial Vista
function faceShrine(t: Tower) {
  const dx = t.def.x - player.pos.x, dz = t.def.z - player.pos.z;
  if (Math.hypot(dx, dz) > 0.2) player.facing = Math.atan2(dx, dz);
  player.vel.set(0, 0, 0);
  player.syncModel(0, world.ground(player.pos.x, player.pos.z, player.pos.y));
}

function setInteractIcon(mode: 'resonate' | 'vista' | 'return') {
  iconResonate.hidden = mode !== 'resonate';
  iconVista.hidden = mode !== 'vista';
  iconReturn.hidden = mode !== 'return';
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
  wakeHud(6000);
  pingEl(towerPill, 'bump');
  save();
  btnInteract.hidden = true;
  sparkles.burst(new THREE.Vector3(t.def.x, t.base + 3.6, t.def.z), 85, '#7ff0ff', 12, 0.8, 1.9, 2);
  cine = { tower: t, updraft: u, t: 0, upgradePlayed: false, updraftPlayed: false };
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
  setInteractIcon('return');
  btnInteract.classList.add('revisit');
  btnInteract.hidden = false;
}

function exitVista() {
  state = 'play';
  camLiftTarget = 0;
  camDistTarget = 10;
}

/**
 * 3-phase wordless resonance choreography:
 * 1) Stamina wheel visibly expands right beside the player with emerald sparkles.
 * 2) Camera lifts & orbits while softly framing the newly erupting updraft column.
 * 3) Sweeps back over the valley and opens the map to clear the fog.
 */
function updateCinematic(dt: number) {
  if (!cine) return;
  cine.t += dt;
  camLiftTarget = 24;
  camDistTarget = 40;
  camPitch += (0.36 - camPitch) * Math.min(1, dt * 1.5);
  camYaw += dt * 0.34;

  // Phase 1: Stamina upgrade visual beside player
  if (!cine.upgradePlayed && cine.t >= 0.55) {
    cine.upgradePlayed = true;
    audio.playUpgrade();
    triggerStaminaUpgradeVisual(false);
    sparkles.burst(new THREE.Vector3(player.pos.x, player.pos.y + 1.4, player.pos.z), 46, '#8dff9a', 7.5, 0.55, 1.4, 0.5);
  }

  // Phase 2: Newly awakened updraft erupts with audible wind rush & sparkle plume
  if (!cine.updraftPlayed && cine.updraft && cine.t >= 1.5) {
    cine.updraftPlayed = true;
    audio.playUpdraft();
    const u = cine.updraft;
    for (let k = 0; k < 48; k++) {
      const a = Math.random() * Math.PI * 2;
      const rr = Math.random() * u.r * 0.9;
      sparkles.spawn(
        u.x + Math.cos(a) * rr,
        u.base + Math.random() * 14,
        u.z + Math.sin(a) * rr,
        -Math.sin(a) * 2.5,
        12 + Math.random() * 10,
        Math.cos(a) * 2.5,
        '#c6fbff',
        0.55 + Math.random() * 0.4,
        2.1,
        0,
        0.15,
      );
    }
  }

  if (cine.t > 4.4) {
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
    if (!tipsShown.has('glide')) {
      tipsShown.add('glide');
      save();
    }
    actionCueEl.classList.remove('show');
  },
  glideClose: () => audio.playGlideClose(),
  climbStart: () => {
    audio.playGrab();
  },
  climbLeap: () => audio.playLeap(),
  mantle: () => { audio.playGrab(); dust.dust(feet(), 6, 1.6); },
  exhausted: () => {
    audio.playExhausted();
  },
  recovered: () => {
    audio.playRecovered();
    staminaForceT = 0.85;
    sparkles.burst(new THREE.Vector3(player.pos.x, player.pos.y + 1.4, player.pos.z), 18, '#8dff9a', 4.5, 0.4, 0.8, 0.2);
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
    spawnPickupRipple(p, '#ffe27a', 2.8 + Math.min(2.2, orbCombo * 0.45));

    wakeHud(5000);
    const n = orbs.count;
    const upgraded = n % 5 === 0;
    const sc = toScreen(p);
    if (sc.ok) {
      spawnFlyMotes(sc.x, sc.y, orbPill, '#ffe27a', {
        count: Math.min(4, 1 + Math.floor(orbCombo / 2)),
        dur: 540,
        onArrive: () => pingEl(orbPill, upgraded ? 'upgraded' : 'bump'),
      });
    } else {
      pingEl(orbPill, upgraded ? 'upgraded' : 'bump');
    }

    updateCounter();
    if (upgraded) {
      updateOrbRing(true);
      player.staminaMax = staminaMaxFor();
      player.stamina = player.staminaMax;
      player.exhausted = false;
      window.setTimeout(() => {
        audio.playUpgrade();
        triggerStaminaUpgradeVisual(true);
        sparkles.burst(new THREE.Vector3(player.pos.x, player.pos.y + 1.3, player.pos.z), 54, '#8dff9a', 9, 0.6, 1.4, 1);
      }, 260);
      window.setTimeout(() => updateOrbRing(false), 1200);
    } else if (d.kind === 'peak') {
      // Summit orb: soft vista camera breath + downhill breeze ribbons inviting a glide
      vistaBreath = 1.0;
      audio.playPeakVista();
      const fx = Math.sin(player.facing), fz = Math.cos(player.facing);
      for (let k = 0; k < 22; k++) {
        sparkles.spawn(
          p.x + (Math.random() - 0.5) * 4,
          p.y + Math.random() * 2,
          p.z + (Math.random() - 0.5) * 4,
          fx * (6 + Math.random() * 6),
          -0.6 + Math.random() * 1.4,
          fz * (6 + Math.random() * 6),
          '#e8fbff',
          0.35 + Math.random() * 0.3,
          1.4,
          0,
          0.2,
        );
      }
    }
    checkEverything();
  }
  if (got.length) save();
}

// ------------------------------------------------------------ Wind Trials
let activeCourse: RingCourse | null = null;
let trialDotCourseId = -1;
let trialTickAcc = 0;

/** Shoots a luminous wind stream from the ring just passed toward the next ring. */
function spawnRingGuideTrail(from: THREE.Vector3, to: THREE.Vector3) {
  const dir = to.clone().sub(from);
  const len = dir.length();
  if (len < 0.5) return;
  dir.divideScalar(len);
  for (let k = 0; k < 18; k++) {
    const f = k / 18;
    const speed = 10 + f * 12;
    sparkles.spawn(
      from.x + dir.x * (f * 3) + (Math.random() - 0.5) * 0.9,
      from.y + dir.y * (f * 3) + (Math.random() - 0.5) * 0.9,
      from.z + dir.z * (f * 3) + (Math.random() - 0.5) * 0.9,
      dir.x * speed,
      dir.y * speed,
      dir.z * speed,
      k % 3 === 0 ? '#ffe27a' : '#bff8ff',
      0.42 + Math.random() * 0.28,
      0.85 + f * 0.35,
      0,
      0.4,
    );
  }
}

function onCourse(c: RingCourse, ev: CourseEvent) {
  if (!ev) return;
  if (ev.type === 'start' || ev.type === 'pass') {
    activeCourse = c;
    trialTickAcc = 0;
    audio.playRing(ev.index - 1);
    const passed = c.rings[ev.index - 1];
    sparkles.burst(passed.p, 26, '#bff8ff', 7, 0.6, 0.9, 0);
    const nextRing = c.rings[ev.index];
    if (nextRing) spawnRingGuideTrail(passed.p, nextRing.p);
  } else if (ev.type === 'fail') {
    if (activeCourse === c) activeCourse = null;
    audio.playCourseFail();
    sparkles.burst(c.start, 28, '#ffd36a', 5, 0.6, 1.4, -0.5);
  } else if (ev.type === 'complete') {
    activeCourse = null;
    audio.playRing(ev.index - 1);
    window.setTimeout(() => audio.playCourseDone(), 180);
    sparkles.burst(c.end, 95, '#ffe27a', 14, 0.8, 1.8, 1);
    // Vertical golden beacon shimmer highlighting the revealed reward orb
    for (let k = 0; k < 24; k++) {
      sparkles.spawn(
        c.end.x + (Math.random() - 0.5) * 1.4,
        c.end.y + k * 0.5,
        c.end.z + (Math.random() - 0.5) * 1.4,
        0, 5 + Math.random() * 4, 0,
        '#fff0a6', 0.55, 1.6, 0, 0.2,
      );
    }
    orbs.reveal(c.rewardOrb);
    wakeHud(5000);
    save();
  }
}

function updateTrialHud(dt: number) {
  const c = activeCourse;
  const show = !!c && state === 'play';
  trialEl.classList.toggle('show', show);
  if (!c) return;
  if (trialDotCourseId !== c.id || trialDotsEl.childElementCount !== c.rings.length) {
    trialDotCourseId = c.id;
    trialDotsEl.innerHTML = '';
    for (let i = 0; i < c.rings.length; i++) {
      const dot = document.createElement('span');
      dot.className = 't-dot';
      trialDotsEl.appendChild(dot);
    }
  }
  const dots = trialDotsEl.children;
  for (let i = 0; i < dots.length; i++) {
    dots[i].classList.toggle('done', i < c.next);
    dots[i].classList.toggle('next', i === c.next);
  }
  trialCount.textContent = `${c.next} / ${c.rings.length}`;
  trialBar.style.transform = `scaleX(${Math.max(0, c.timer / RingCourse.WINDOW)})`;
  const urgent = c.timer < 2.2 && c.timer > 0;
  trialEl.classList.toggle('urgent', urgent);
  if (show && urgent) {
    trialTickAcc += dt;
    const interval = c.timer < 1.1 ? 0.34 : 0.52;
    if (trialTickAcc >= interval) {
      trialTickAcc = 0;
      audio.playTrialTick(c.timer < 1.1);
    }
  } else {
    trialTickAcc = 0;
  }
}

function checkEverything() {
  if (everythingShown) return;
  if (orbs.count === orbs.total && courses.every((c) => c.done) && towers.every((t) => t.activated)) {
    everythingShown = true;
    window.setTimeout(() => {
      audio.playAllDone();
      wakeHud(7000);
      const p = new THREE.Vector3(player.pos.x, player.pos.y + 2, player.pos.z);
      sparkles.burst(p, 120, '#ffe27a', 14, 0.85, 2.4, 0.4);
      sparkles.burst(p, 70, '#7ff0ff', 11, 0.7, 2.2, -0.2);
    }, 900);
  }
}

// Continuous effects: wind trails, sprint dust, swim ripples, morphing buttons & wordless cues
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
    audio.playUpdraft();
    if (player.gliding && !tipsShown.has('updraft')) {
      tipsShown.add('updraft');
      save();
    }
  } else if (up <= 0.01) {
    inUpdraft = false;
  }

  // Morph touch jump / sprint buttons contextually so actions are self-evident
  const canOpenGlide = player.mode === 'air' && player.airHeight > 2.0 && !player.exhausted && state === 'play';
  const isClimb = player.climbing && state === 'play';
  const isGlide = player.gliding && state === 'play';
  iconJump.hidden = canOpenGlide || isClimb;
  iconGlide.hidden = !canOpenGlide;
  iconLeap.hidden = !isClimb;
  btnJump.classList.toggle('glide-ready', canOpenGlide && player.airHeight > 5.0 && player.vel.y < -2);

  iconSprint.hidden = isGlide;
  iconDive.hidden = !isGlide;

  // Wordless floating action silhouette cue (first-time high fall or standing in updraft on foot)
  const fallingHigh = player.mode === 'air' && player.airHeight > 6 && player.vel.y < -3 && state === 'play';
  const showGlideCue = fallingHigh && !tipsShown.has('glide');
  const showUpdraftCue = !showGlideCue && inUpdraft && !player.gliding && !tipsShown.has('updraft') && state === 'play';
  if (showGlideCue && !glideCuePlayed) {
    glideCuePlayed = true;
    audio.playGlideCue();
  }
  if (!fallingHigh) glideCuePlayed = false;

  cueGlideSvg.hidden = !showGlideCue;
  cueUpdraftSvg.hidden = !showUpdraftCue;
  actionCueEl.classList.toggle('updraft', showUpdraftCue);
  actionCueEl.classList.toggle('show', showGlideCue || showUpdraftCue);
}

// ------------------------------------------------------------ Camera
const tmpCamPos = new THREE.Vector3();
const tmpCineFocus = new THREE.Vector3();
const tmpPoiLook = new THREE.Vector3();

function updateCamera(dt: number) {
  const look = input.consumeLook();
  const hasLook = Math.abs(look.x) + Math.abs(look.y) > 0.5;
  if (state === 'play' || state === 'vista') {
    camYaw -= look.x * 0.0055;
    camPitch = Math.min(1.25, Math.max(-0.32, camPitch + look.y * 0.0045));
  }
  if (hasLook && state === 'play') dismissOnboardHint();
  lookIdle = hasLook ? 0 : lookIdle + dt;

  if (vistaBreath > 0) vistaBreath = Math.max(0, vistaBreath - dt * 0.42);
  const breathEase = Math.sin(Math.min(1, vistaBreath) * Math.PI);

  if (state === 'play') {
    // Dynamic framing per movement mode + summit vista breath + one-time Wonder discovery zoom-in
    const baseDist = player.gliding ? (player.diving ? 14.5 : 12.5) : player.climbing ? 9 : player.sprinting ? 11 : 10;
    const poiDistPull = poiFocus * 1.1;
    camDistTarget = Math.max(6.8, baseDist + breathEase * 2.6 - poiDistPull);
    // While gliding, ease the camera behind the flight direction
    if (player.gliding && lookIdle > 1.2) {
      const behind = player.facing + Math.PI;
      camYaw += wrap(behind - camYaw) * Math.min(1, dt * 0.9);
    } else if (!player.gliding && poiFocus > 0.14 && poiFocusHasPos && lookIdle > 0.45) {
      // Softly guide camera framing toward a newly discovered Wonder when the player isn't actively turning
      const dx = poiFocusPos.x - player.pos.x;
      const dz = poiFocusPos.z - player.pos.z;
      if (Math.hypot(dx, dz) > 4.5) {
        const targetYaw = Math.atan2(-dx, -dz);
        camYaw += wrap(targetYaw - camYaw) * Math.min(1, dt * 0.55 * poiFocus);
      }
    }
  }
  const kick = state === 'play'
    ? (player.sprinting ? 6 : 0)
      + (player.gliding ? 5 + Math.min(10, player.speedXZ * 0.35) + (player.diving ? 8 : 0) : 0)
      + breathEase * 4.5
      - momentFocus * 4.5
      - poiFocus * 11.5
    : state === 'vista'
      ? -momentFocus * 4.5
      : 0;
  fovKick += (kick - fovKick) * Math.min(1, dt * 3.4);
  const fov = baseFov + fovKick;
  if (Math.abs(camera.fov - fov) > 0.05) { camera.fov = fov; camera.updateProjectionMatrix(); }

  camDist += (camDistTarget - camDist) * Math.min(1, dt * 2.6);
  camLift += (camLiftTarget - camLift) * Math.min(1, dt * 2.2);
  const target = new THREE.Vector3(player.pos.x, player.pos.y + 1.6 + camLift, player.pos.z);
  camTarget.lerp(target, Math.min(1, dt * (player.gliding ? 14 : 10)));

  // During shrine resonance Phase 2, smoothly swing gaze briefly toward the newly awakened updraft;
  // during a one-time Wonder discovery pulse, shift focus toward the Wonder while keeping the explorer framed.
  if (state === 'cinematic' && cine?.updraft) {
    const u = cine.updraft;
    const w = smoothstep(1.3, 2.0, cine.t) * (1 - smoothstep(3.3, 4.1, cine.t));
    tmpCineFocus.set(u.x, u.base + 14, u.z);
    camLook.copy(camTarget).lerp(tmpCineFocus, w * 0.68);
  } else if (state === 'play' && poiFocus > 0.005 && poiFocusHasPos) {
    tmpPoiLook.subVectors(poiFocusPos, camTarget);
    const dist = tmpPoiLook.length();
    if (dist > 24) tmpPoiLook.multiplyScalar(24 / dist);
    tmpPoiLook.add(camTarget);
    camLook.copy(camTarget).lerp(tmpPoiLook, poiFocus * 0.46);
  } else {
    camLook.copy(camTarget);
  }

  const cp = Math.cos(camPitch);
  tmpCamPos.set(
    camTarget.x + Math.sin(camYaw) * cp * camDist,
    camTarget.y + Math.sin(camPitch) * camDist,
    camTarget.z + Math.cos(camYaw) * cp * camDist,
  );
  const floor = Math.max(terrain.height(tmpCamPos.x, tmpCamPos.z), WATER_LEVEL) + 0.8;
  if (tmpCamPos.y < floor) tmpCamPos.y = floor;

  // Smooth opening swoop from title orbit down to the player (yields faster when player moves/looks)
  if (introSwoop && state === 'play') {
    const activeInput = hasLook || Math.hypot(input.move.x, input.move.y) > 0.12 || input.jump;
    introSwoop.t += dt * (activeInput ? 2.6 : 1.0);
    const p = Math.min(1, introSwoop.t / introSwoop.dur);
    const e = 1 - Math.pow(1 - p, 3);
    camera.position.lerpVectors(introSwoop.fromPos, tmpCamPos, e);
    const lookPt = tmpCineFocus.lerpVectors(introSwoop.fromLook, camLook, e);
    camera.lookAt(lookPt);
    if (p >= 1) introSwoop = null;
  } else {
    camera.position.copy(tmpCamPos);
    camera.lookAt(camLook);
  }

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

// Optional dev-only camera override for clean visual verification shots
let camOverride: { pos: THREE.Vector3; look: THREE.Vector3 } | null = null;
const titleBiomeWeights = new Float32Array([1, 0, 0, 0, 0, 0]);

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
      gameMap.explore(player.pos.x, player.pos.z);
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
      if (nearTower) {
        if (!nearTower.activated && lastNearShrineIdx !== nearTower.index) {
          audio.playShrineProximity();
        }
        lastNearShrineIdx = nearTower.index;
        setInteractIcon(nearTower.activated ? 'vista' : 'resonate');
        btnInteract.classList.toggle('revisit', nearTower.activated);
      } else {
        lastNearShrineIdx = -1;
      }
      btnInteract.hidden = !nearTower;
      if (input.action && nearTower) {
        if (!nearTower.activated) activate(nearTower);
        else startVista(nearTower);
      }
      if (input.map) openMap();
      updateRegionTracking(dt);
      checkDiscovery(dt);
      checkMoments(dt);
      updatePoiFocus(dt);

      chest.set(player.pos.x, player.pos.y + 1.0, player.pos.z);
      onOrbs(orbs.update(elapsed, dt, chest, true));
      for (const c of courses) onCourse(c, c.update(elapsed, dt, chest));
      orbComboT -= dt;
      updatePlayerFx(dt);

      saveTimer += dt;
      if (saveTimer > 5) { saveTimer = 0; save(); }
    } else {
      updatePoiFocus(dt);
      chest.set(player.pos.x, player.pos.y + 1.0, player.pos.z);
      orbs.update(elapsed, dt, chest, false);
      for (const c of courses) c.update(elapsed, dt, new THREE.Vector3(0, -9999, 0));
      actionCueEl.classList.remove('show');
      if (state === 'vista') {
        checkDiscovery(dt);
        checkMoments(dt);
        if (input.action || input.jump || Math.hypot(input.move.x, input.move.y) > 0.18) {
          exitVista();
        } else if (input.map) {
          openMap();
        }
      } else if (state === 'cinematic') {
        audio.updateMomentDwell(0);
        momentFrameEl.style.setProperty('--dwell', '0');
        updateCinematic(dt);
      } else if (state === 'map') {
        if (input.map) {
          closeMap();
        } else {
          if (mapAnimating) mapAnimating = gameMap.advance(dt);
          gameMap.stepView(dt);
          syncMapControls();
          gameMap.draw(mapCanvas, towers, elapsed, visitedBiomes, wonders, playerMapPose());
        }
      }
    }
    if (camOverride) {
      camera.position.copy(camOverride.pos);
      camera.lookAt(camOverride.look);
    } else {
      updateCamera(dt);
    }
    updateCompass();
    updateStamina(dt);
    updateTrialHud(dt);
  }

  // Smooth regional atmosphere blending (clear meadow baseline on title overview)
  if (state === 'title') {
    updateBiomeAtmosphere(titleBiomeWeights, dt, false);
  } else {
    const focusX = camOverride ? camOverride.pos.x : player.pos.x;
    const focusZ = camOverride ? camOverride.pos.z : player.pos.z;
    sampleBiomeWeights(focusX, focusZ, curBiomeWeights);
    updateBiomeAtmosphere(curBiomeWeights, dt, false);
  }

  audio.update(dt, {
    altitude: state === 'title' ? 22 : player.pos.y,
    waterProximity: state === 'title' ? 0.25 : sampleWaterProximity(player.pos.x, player.pos.z),
    swimming: player.swimming,
    speed: moveSpeed,
    grounded: player.grounded,
    onStone,
    aerial: state === 'cinematic' || state === 'vista' || player.gliding,
    glide: player.gliding ? Math.max(0.08, Math.min(1, (player.speedXZ + Math.abs(player.vel.y)) / 22)) : 0,
    climbing: player.climbing,
    biomeIndex: state === 'title' ? 0 : currentBiome,
    nightFactor: celUniforms.uNightFactor.value,
  });

  updateCelTime(elapsed);

  // Advance day/night cycle naturally during gameplay (or glide smoothly on manual skip)
  if (timeGlide) {
    timeGlide.t += dt;
    const p = Math.min(1, timeGlide.t / timeGlide.dur);
    const e = p * p * (3 - 2 * p);
    timeOfDay = (timeGlide.from + timeGlide.delta * e) % 1;
    if (p >= 1) timeGlide = null;
    applyDayNight(timeOfDay);
  } else if (state !== 'title' && state !== 'map') {
    timeOfDay = (timeOfDay + dt / DAY_DURATION) % 1;
    applyDayNight(timeOfDay);
  }

  if (state === 'title') {
    updateSunShadow(0, 20, 0);
    grassField.group.visible = false;
    ambientMotes.points.visible = false;
  } else {
    const focusPos = camOverride ? camOverride.pos : player.pos;
    updateSunShadow(focusPos.x, focusPos.y, focusPos.z);
    grassField.group.visible = true;
    grassField.update(focusPos);
    ambientMotes.points.visible = true;
    ambientMotes.update(focusPos, dt, curBiomeWeights);
  }

  const viewerPos = camOverride ? camOverride.pos : player.pos;
  towers.forEach((t) => t.update(elapsed, dt, viewerPos, state === 'title'));
  wonders.forEach((w) => w.update(elapsed));
  updrafts.forEach((u) => u.update(elapsed, dt, sparkles, state === 'title' ? camera.position : player.pos));
  birdFlocks.update(elapsed);
  sparkles.update(dt);
  dust.update(dt);
  clouds.children.forEach((c) => {
    c.position.x += c.userData.speed * dt;
    if (c.position.x > 480) c.position.x = -480;
  });
  sky.position.copy(camera.position);
  input.clearPresses();
  composer.render();
  requestAnimationFrame(frame);
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  const pr = renderer.getPixelRatio();
  renderer.setSize(w, h, false);
  composer.setPixelRatio(pr);
  composer.setSize(w, h);
  bloomPass.resolution.set(Math.max(1, Math.floor(w * 0.5)), Math.max(1, Math.floor(h * 0.5)));
  camera.aspect = w / h;
  baseFov = w < h ? 72 : 62;
  camera.fov = baseFov + fovKick;
  camera.updateProjectionMatrix();
  const ph = h * pr;
  sparkles.setViewport(ph, baseFov);
  dust.setViewport(ph, baseFov);
  ambientMotes.setViewport(ph, baseFov);
}
window.addEventListener('resize', resize);
resize();

// ------------------------------------------------------------ Title
const existingSave = loadSave();
const btnReset = $('btn-reset');
const resetIdleIcon = btnReset.querySelector('.icon-reset-idle') as HTMLElement;
const resetConfirmIcon = btnReset.querySelector('.icon-reset-confirm') as HTMLElement;
btnReset.hidden = !existingSave;

// Subtle 6-crystal progress bar under the title emblem when returning with a save
if (existingSave) {
  const actSet = new Set(existingSave.activated ?? []);
  titleProgress.innerHTML = '';
  for (let i = 0; i < TOWER_DEFS.length; i++) {
    const pip = document.createElement('span');
    pip.className = actSet.has(i) ? 'tp-pip on' : 'tp-pip';
    titleProgress.appendChild(pip);
  }
  titleProgress.hidden = false;
}

function startGame() {
  const hadSave = !!loadSave();
  audio.unlock();
  applySave();
  updateCounter();

  // Capture title orbit camera for a smooth swoop down behind the player
  const fromPos = camera.position.clone();
  const fromLook = new THREE.Vector3(0, 20, 0);
  camLift = 0;
  camLiftTarget = 0;
  camDist = 10;
  camDistTarget = 10;
  camPitch = 0.24;
  camTarget.set(player.pos.x, player.pos.y + 1.6, player.pos.z);
  introSwoop = { fromPos, fromLook, t: 0, dur: 2.1 };

  titleScreen.classList.add('leaving');
  window.setTimeout(() => { titleScreen.hidden = true; }, 650);
  hud.hidden = false;
  state = 'play';
  wakeHud(5000);

  if (!hadSave) {
    onboardShowTimer = window.setTimeout(() => {
      if (state === 'play' && !onboardHint.classList.contains('gone')) {
        onboardHint.classList.add('show');
      }
    }, 900);
  } else {
    onboardHint.classList.add('gone');
  }
}

$('btn-start').addEventListener('click', startGame);

// 2-step safe wordless reset (1st tap arms red checkmark for 3.5s; 2nd tap clears save)
let resetArmed = false;
let resetArmTimer = 0;
function disarmReset() {
  resetArmed = false;
  clearTimeout(resetArmTimer);
  btnReset.classList.remove('armed');
  resetIdleIcon.hidden = false;
  resetConfirmIcon.hidden = true;
}
btnReset.addEventListener('click', () => {
  if (!resetArmed) {
    resetArmed = true;
    btnReset.classList.add('armed');
    resetIdleIcon.hidden = true;
    resetConfirmIcon.hidden = false;
    resetArmTimer = window.setTimeout(disarmReset, 3500);
    return;
  }
  disarmReset();
  localStorage.removeItem(SAVE_KEY);
  allDoneShown = false;
  everythingShown = false;
  startGame();
});

window.addEventListener('keydown', (e) => {
  if (state !== 'title') audio.unlock();
  if (e.code === 'KeyT' && !e.repeat && (state === 'play' || state === 'vista')) {
    cycleTimeOfDay();
  } else if (e.code === 'Escape' && state === 'map') {
    closeMap();
  }
}, { passive: true });

frame();

if (import.meta.env.DEV) {
  const devGame: DevGame = {
    player, towers, wonders, terrain, gameMap, activate, startVista, openMap, closeMap, audio, orbs, updrafts, courses, world,
    camera, BIOMES, visitedBiomes, capturedMoments,
    getPoiFocus: () => ({ focus: poiFocus, kind: poiKind }),
    getFov: () => camera.fov,
    getBaseFov: () => baseFov,
    setYaw: (y: number) => { camYaw = y; },
    setPitch: (p: number) => { camPitch = p; },
    setTime: (tod: number) => { timeGlide = null; timeOfDay = ((tod % 1) + 1) % 1; applyDayNight(timeOfDay); },
    setCamOverride: (pos: [number, number, number] | null, look?: [number, number, number]) => {
      if (!pos || !look) { camOverride = null; return; }
      camOverride = { pos: new THREE.Vector3(...pos), look: new THREE.Vector3(...look) };
      sampleBiomeWeights(pos[0], pos[2], curBiomeWeights);
      updateBiomeAtmosphere(curBiomeWeights, 1, true);
    },
    snapAt: (x: number, z: number, yaw: number, pitch: number, tod: number) => {
      camOverride = null;
      introSwoop = null;
      const h = Math.max(world.ground(x, z, 0), WATER_LEVEL);
      player.place(x, h, z);
      camYaw = yaw;
      camPitch = pitch;
      camTarget.set(x, h + 1.6, z);
      updateCamera(1 / 60);
      camera.updateMatrixWorld();
      timeGlide = null;
      timeOfDay = ((tod % 1) + 1) % 1;
      applyDayNight(timeOfDay);
      sampleBiomeWeights(x, z, curBiomeWeights);
      updateBiomeAtmosphere(curBiomeWeights, 1, true);
    },
    /** Deterministically run sightline discovery (dev testing only). */
    stepDiscovery: (dt = 0.3) => {
      if (state === 'play' || state === 'vista') {
        if (camOverride) {
          camera.position.copy(camOverride.pos);
          camera.lookAt(camOverride.look);
        } else {
          updateCamera(1 / 60);
        }
        camera.updateMatrixWorld();
        discoverTimer = 0;
        checkDiscovery(dt);
      }
      return towers.map((t) => t.discovered);
    },
    getState: () => state,
    /** Deterministically step the player (dev testing only). */
    sim: (n: number, mx: number, my: number, jumpAt = -1, sprint = false) => {
      const log: string[] = [];
      for (let i = 0; i < n; i++) {
        player.update(1 / 60, { move: { x: mx, y: my }, jump: i === jumpAt, sprint }, camYaw, world);
        gameMap.explore(player.pos.x, player.pos.z);
        chest.set(player.pos.x, player.pos.y + 1.0, player.pos.z);
        for (const c of courses) { const ev = c.update(elapsed, 1 / 60, chest); if (ev) log.push(`${c.name}:${ev.type}${ev.index}`); }
        const got = orbs.update(elapsed, 1 / 60, chest, true);
        if (got.length) log.push(`orb${got.join(',')}`);
        checkDiscovery(1 / 60);
      }
      return { mode: player.mode, pos: player.pos.toArray().map((v) => +v.toFixed(2)), st: +player.stamina.toFixed(1), ex: player.exhausted, log };
    },
    /** Deterministically step region tracking, POI focus, camera, and map view (dev testing only). */
    stepSystems: (n: number, dt = 1 / 60) => {
      for (let i = 0; i < n; i++) {
        elapsed += dt;
        if (state === 'play') {
          updateRegionTracking(dt);
          updatePoiFocus(dt);
          updateCamera(dt);
        } else if (state === 'map') {
          gameMap.stepView(dt);
          syncMapControls();
          gameMap.draw(mapCanvas, towers, elapsed, visitedBiomes, wonders, playerMapPose());
        }
      }
    },
  };
  window.__game = devGame;
}
