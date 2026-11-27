import type { BiomeId } from './biome-field.ts';
import { Terrain, WATER_LEVEL, type Flatten } from './terrain.ts';

/**
 * Pure island layout definitions (zero Three.js dependency) so both the game
 * runtime and standalone Node sightline/terrain scripts inspect the exact same
 * shrines, wonders, start clearing, and terrain plateaus.
 */

export const START_POS = { x: 10, z: 70 };

export interface TowerDef {
  name: string;
  x: number;
  z: number;
}

/** Hand-placed ancient shrines nestled across distinct regions of the island. */
export const TOWER_DEFS: TowerDef[] = [
  { name: '初始之碑', x: 0, z: -95 },
  { name: '西嶺之碑', x: -195, z: -40 },
  { name: '東崖之碑', x: 175, z: -140 },
  { name: '南湖之碑', x: 150, z: 150 },
  { name: '霧林之碑', x: -130, z: 185 },
  { name: '北境之碑', x: -20, z: -235 },
];

export interface WonderDef {
  id: string;
  name: string;
  biome: BiomeId;
  biomeIndex: number;
  x: number;
  z: number;
  /** Height offset above base for line-of-sight discovery check. */
  sightY: number;
  /** Max viewing distance for "seeing = discovering". */
  sightDist: number;
  /** Poetic 1-line discovery description. */
  desc: string;
  /** Terrain flatten specification around this landmark. */
  flat: Flatten;
  /** Vegetation keep-out radius. */
  avoidR: number;
}

export const WONDER_DEFS: WonderDef[] = [
  {
    id: 'sakura',
    name: '千年古櫻',
    biome: 'meadow',
    biomeIndex: 0,
    x: -36,
    z: 22,
    sightY: 11,
    sightDist: 145,
    desc: '繁花如雲覆青丘，落英隨風滿山野',
    flat: { x: -36, z: 22, r: 15, lift: 5, minH: 18 },
    avoidR: 13,
  },
  {
    id: 'arch',
    name: '天生橋',
    biome: 'karst',
    biomeIndex: 1,
    x: -148,
    z: -58,
    sightY: 16,
    sightDist: 165,
    desc: '巨岩成拱跨碧水，流雲穿橋過石林',
    flat: { x: -148, z: -58, r: 15, targetH: WATER_LEVEL - 1.6 },
    avoidR: 18,
  },
  {
    id: 'bones',
    name: '古獸遺骨',
    biome: 'canyon',
    biomeIndex: 2,
    x: 158,
    z: -55,
    sightY: 8,
    sightDist: 155,
    desc: '蒼白巨肋破紅沙，荒谷長風訴太古',
    flat: { x: 158, z: -55, r: 18, minH: 13 },
    avoidR: 16,
  },
  {
    id: 'gate',
    name: '沉水古門',
    biome: 'maple',
    biomeIndex: 3,
    x: 92,
    z: 136,
    sightY: 9,
    sightDist: 155,
    desc: '三角石門半沒碧湖，古紋微光映秋波',
    flat: { x: 92, z: 136, r: 16, targetH: WATER_LEVEL - 2.2 },
    avoidR: 15,
  },
  {
    id: 'spirittree',
    name: '千年神木',
    biome: 'mistwood',
    biomeIndex: 4,
    x: -118,
    z: 128,
    sightY: 19,
    sightDist: 140,
    desc: '參天古幹吐幽光，萬頃濃霧繞靈根',
    flat: { x: -118, z: 128, r: 16, lift: 4, minH: 20 },
    avoidR: 15,
  },
  {
    id: 'ice_spire',
    name: '冰晶尖塔',
    biome: 'snow',
    biomeIndex: 5,
    x: 24,
    z: -198,
    sightY: 15,
    sightDist: 175,
    desc: '玄冰削玉指蒼穹，寒嶺孤峰映星河',
    flat: { x: 24, z: -198, r: 13, lift: 4, minH: 38 },
    avoidR: 13,
  },
];

/** Canonical plateau/basin flatten specs used to generate the island heightfield. */
export const ISLAND_FLATS: Flatten[] = [
  ...TOWER_DEFS.map((d) => ({ x: d.x, z: d.z, r: 13 })),
  { ...START_POS, r: 16 },
  ...WONDER_DEFS.map((w) => w.flat),
];

/** Builds the canonical island Terrain using ISLAND_FLATS (directly usable in Node scripts). */
export function createIslandTerrain(): Terrain {
  return new Terrain(ISLAND_FLATS);
}
