import type * as THREE from 'three';
import type { NatureAudio } from './audio';
import type { BiomeDef } from './biomes';
import type { Orbs, RingCourse, Updraft } from './collectibles';
import type { Wonder } from './landmarks';
import type { GameMap } from './map';
import type { Mode, Player, WorldQuery } from './player';
import type { Terrain } from './terrain';
import type { QualityMode } from './ultra-quality';
import type { Tower } from './world';

export type GameState = 'title' | 'play' | 'cinematic' | 'vista' | 'map';
export type PoiFocusKind = 'none' | 'wonder';

export interface SimResult {
  mode: Mode;
  pos: number[];
  st: number;
  ex: boolean;
  log: string[];
}

/**
 * Typed contract for the DEV-only `window.__game` harness bound at the bottom of `src/main.ts`.
 * Shared between `src/main.ts` and Playwright tests so signature drift fails at typecheck time.
 */
export interface DevGame {
  player: Player;
  towers: Tower[];
  wonders: Wonder[];
  terrain: Terrain;
  gameMap: GameMap;
  activate: (t: Tower) => void;
  startVista: (t: Tower) => void;
  openMap: (animate?: boolean) => void;
  closeMap: () => void;
  audio: NatureAudio;
  orbs: Orbs;
  updrafts: Updraft[];
  courses: RingCourse[];
  world: WorldQuery;
  camera: THREE.PerspectiveCamera;
  BIOMES: readonly BiomeDef[];
  visitedBiomes: Set<number>;
  capturedMoments: Set<string>;
  getPoiFocus: () => { focus: number; kind: PoiFocusKind };
  getFov: () => number;
  getBaseFov: () => number;
  getQuality: () => QualityMode;
  setQuality: (mode: QualityMode) => void;
  setYaw: (y: number) => void;
  setPitch: (p: number) => void;
  setTime: (tod: number) => void;
  setCamOverride: (pos: [number, number, number] | null, look?: [number, number, number]) => void;
  snapAt: (x: number, z: number, yaw: number, pitch: number, tod: number) => void;
  stepDiscovery: (dt?: number) => boolean[];
  getState: () => GameState;
  sim: (n: number, mx: number, my: number, jumpAt?: number, sprint?: boolean) => SimResult;
  stepSystems: (n: number, dt?: number) => void;
}

declare global {
  interface Window {
    __game?: DevGame;
  }
}
