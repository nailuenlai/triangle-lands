import * as THREE from 'three';
import { Terrain, WATER_LEVEL, type Flatten } from './terrain';
import { createCelMaterial, celUniforms } from './cel';
import type { BiomeId } from './biomes';

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

export interface MomentDef {
  id: string;
  name: string;
  biomeIndex: number;
  desc: string;
  /** Check whether player is currently witnessing this temporal vista. */
  matches: (ctx: {
    biomeIndex: number;
    biomeWeight: number;
    x: number;
    y: number;
    z: number;
    timeOfDay: number;
    nightFactor: number;
    sunsetFactor: number;
    lookDir: THREE.Vector3;
  }) => boolean;
}

export const MOMENT_DEFS: MomentDef[] = [
  {
    id: 'aurora',
    name: '極光漫北境',
    biomeIndex: 5,
    desc: '靜立雪原夜空下，見翡翠極光垂天搖曳',
    matches: (c) => c.biomeIndex === 5 && c.biomeWeight > 0.35 && c.nightFactor > 0.52 && c.lookDir.z < 0.25,
  },
  {
    id: 'glowforest',
    name: '螢光之森',
    biomeIndex: 4,
    desc: '夜色浸染深林，菌光孢子在霧間悄然甦醒',
    matches: (c) => c.biomeIndex === 4 && c.biomeWeight > 0.38 && c.nightFactor > 0.52,
  },
  {
    id: 'cloudsea',
    name: '石林雲海',
    biomeIndex: 1,
    desc: '登高俯瞰石峰如島，玉色雲浪在腳下流轉',
    matches: (c) => c.biomeIndex === 1 && c.biomeWeight > 0.35 && c.y > 18.5 && c.nightFactor < 0.38,
  },
  {
    id: 'redsunset',
    name: '赤谷夕照',
    biomeIndex: 2,
    desc: '落日餘暉灑滿丹崖，整座峽谷如熔金燃燒',
    matches: (c) => c.biomeIndex === 2 && c.biomeWeight > 0.35 && c.sunsetFactor > 0.40 && c.timeOfDay > 0.60,
  },
  {
    id: 'moonlake',
    name: '楓湖月影',
    biomeIndex: 3,
    desc: '明月倒映平湖秋水，楓渚寂靜無聲',
    matches: (c) =>
      c.biomeIndex === 3
      && c.biomeWeight > 0.32
      && c.nightFactor > 0.52
      && Math.hypot(c.x - 98, c.z - 138) < 105,
  },
];

export interface Collider {
  x: number;
  z: number;
  r: number;
}

export class Wonder {
  readonly group = new THREE.Group();
  readonly baseY: number;
  readonly sightPos: THREE.Vector3;
  readonly colliders: Collider[] = [];
  discovered = false;

  private animatedMats: { mat: THREE.MeshBasicMaterial; base: THREE.Color; dayMul: number; nightMul: number }[] = [];
  private floaters: { obj: THREE.Object3D; baseY: number; phase: number; amp: number }[] = [];

  constructor(public readonly def: WonderDef, terrain: Terrain) {
    this.baseY = def.id === 'gate' || def.id === 'arch' ? WATER_LEVEL : terrain.height(def.x, def.z);
    this.group.position.set(def.x, this.baseY, def.z);
    this.sightPos = new THREE.Vector3(def.x, this.baseY + def.sightY, def.z);

    switch (def.id) {
      case 'sakura': this.buildSakura(); break;
      case 'arch': this.buildArch(); break;
      case 'bones': this.buildBones(); break;
      case 'gate': this.buildSunkenGate(); break;
      case 'spirittree': this.buildSpiritTree(); break;
      case 'ice_spire': this.buildIceSpire(); break;
    }
  }

  private addCollider(lx: number, lz: number, r: number) {
    this.colliders.push({ x: this.def.x + lx, z: this.def.z + lz, r });
  }

  private buildSakura() {
    const bark = createCelMaterial({
      color: '#523b34', shadowTint: '#444b75', rimStrength: 0.24, cacheKey: 'cel_wonder_bark_v1',
    });
    const blossomMain = createCelMaterial({
      color: '#ffb7cc', shadowTint: '#8b6e9e', rimStrength: 0.52, highlight: 0.24,
      wind: { amp: 0.22, freq: 1.4, heightOffset: 6.0 },
      cacheKey: 'cel_wonder_sakura_v1',
    });
    const blossomLight = createCelMaterial({
      color: '#ffe4ee', shadowTint: '#9a7dab', rimStrength: 0.56, highlight: 0.28,
      wind: { amp: 0.26, freq: 1.6, heightOffset: 6.0 },
      cacheKey: 'cel_wonder_sakura_hi_v1',
    });
    const stone = createCelMaterial({
      color: '#9c9689', flatShading: true, shadowTint: '#62789c', mossTop: 0.4, cacheKey: 'cel_wonder_stone_v1',
    });

    // Sweeping gnarled trunk + thick roots
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 2.35, 9.5, 8), bark);
    trunk.position.y = 4.6;
    trunk.rotation.z = 0.08;
    trunk.castShadow = true;
    trunk.receiveShadow = true;
    this.group.add(trunk);

    const boughs: [number, number, number, number, number, number][] = [
      [2.6, 8.8, 0.8, 0.52, -0.58, 0.2],
      [-2.8, 9.2, -0.7, 0.48, 0.62, -0.18],
      [0.4, 9.4, -2.5, 0.46, 0.1, -0.56],
      [-0.8, 8.6, 2.4, 0.44, -0.15, 0.55],
    ];
    for (const [x, y, z, r, rz, rx] of boughs) {
      const b = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.55, r, 6.2, 6), bark);
      b.position.set(x, y, z);
      b.rotation.set(rx, 0, rz);
      b.castShadow = true;
      this.group.add(b);
    }

    // Lush layered cloud-like sakura blossom domes
    const puffs: [number, number, number, number, number, boolean][] = [
      [0, 14.5, 0, 5.8, 3.2, false],
      [4.8, 12.2, 1.4, 4.4, 2.6, true],
      [-4.9, 12.6, -1.2, 4.6, 2.7, false],
      [0.9, 12.8, -4.6, 4.3, 2.5, true],
      [-1.5, 11.8, 4.4, 4.2, 2.4, false],
      [2.8, 15.6, -2.1, 3.6, 2.2, true],
      [-2.6, 15.4, 2.0, 3.5, 2.1, true],
      [6.8, 10.6, -0.8, 3.0, 1.8, false],
      [-6.6, 11.0, 1.6, 3.1, 1.9, true],
    ];
    for (const [x, y, z, rx, ry, isLight] of puffs) {
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), isLight ? blossomLight : blossomMain);
      m.scale.set(rx, ry, rx * 0.94);
      m.position.set(x, y, z);
      m.castShadow = true;
      m.receiveShadow = true;
      this.group.add(m);
    }

    // Mossy stone ring around the ancient roots
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + 0.2;
      const st = new THREE.Mesh(new THREE.DodecahedronGeometry(0.85, 0), stone);
      st.position.set(Math.cos(a) * 4.5, 0.3, Math.sin(a) * 4.5);
      st.scale.set(1.2, 0.55, 0.9);
      st.rotation.y = a;
      this.group.add(st);
    }
    this.addCollider(0, 0, 2.5);
  }

  private buildArch() {
    const limestone = createCelMaterial({
      color: '#a3b8b0', flatShading: true, shadowTint: '#3e6e7a', rimStrength: 0.34, mossTop: 0.62,
      cacheKey: 'cel_wonder_karst_v1',
    });
    const limestoneDark = createCelMaterial({
      color: '#7c948e', flatShading: true, shadowTint: '#355f6b', rimStrength: 0.28, mossTop: 0.45,
      cacheKey: 'cel_wonder_karst_dark_v1',
    });

    // Dramatic natural stone arch spanning 28m across turquoise lagoon water
    const segs = 13;
    const span = 29;
    const archH = 22;
    for (let i = 0; i < segs; i++) {
      const t = i / (segs - 1); // 0..1
      const ang = t * Math.PI;
      const x = -Math.cos(ang) * (span * 0.5);
      const y = Math.sin(ang) * archH - 2.5;
      // Thicker piers at the water base, graceful sculptural span at the crown
      const pier = 1 - Math.sin(ang) * 0.42;
      const rx = 3.6 * pier;
      const ry = 3.2 * pier;
      const rz = 4.2 * pier;
      const block = new THREE.Mesh(new THREE.DodecahedronGeometry(1, 0), i % 2 === 0 ? limestone : limestoneDark);
      block.scale.set(rx, ry, rz);
      block.position.set(x, y, Math.sin(t * Math.PI * 2) * 1.4);
      block.rotation.set(0.15 * i, 0.3 * i, ang - Math.PI * 0.5);
      block.castShadow = true;
      block.receiveShadow = true;
      this.group.add(block);
    }

    // Two anchored limestone base cliffs plunging into the lagoon
    for (const side of [-1, 1]) {
      const base = new THREE.Mesh(new THREE.CylinderGeometry(3.8, 5.8, 8.5, 7), limestoneDark);
      base.position.set(side * (span * 0.5 + 1.2), 1.4, 0);
      base.castShadow = true;
      base.receiveShadow = true;
      this.group.add(base);
      this.addCollider(side * (span * 0.5 + 1.2), 0, 5.2);
    }
  }

  private buildBones() {
    const bone = createCelMaterial({
      color: '#eee2c8', flatShading: true, shadowTint: '#7a5c72', rimStrength: 0.40,
      cacheKey: 'cel_wonder_bone_v1',
    });
    const boneShade = createCelMaterial({
      color: '#d4c2a3', flatShading: true, shadowTint: '#6b4e63', rimStrength: 0.32,
      cacheKey: 'cel_wonder_bone_dark_v1',
    });

    // Colossal ancient leviathan spine & 7 pairs of sweeping curved ribs emerging from red sands
    const count = 7;
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1); // 0..1
      const z = (t - 0.5) * 24;
      const curveX = Math.sin(t * Math.PI) * 3.0;
      const archSize = 0.62 + Math.sin(t * Math.PI) * 0.55; // tallest in the middle (~12m high)

      // Vertebra block along the desert floor
      const vert = new THREE.Mesh(new THREE.CylinderGeometry(1.1 * archSize, 1.35 * archSize, 2.2, 6), boneShade);
      vert.rotation.x = Math.PI / 2;
      vert.position.set(curveX, 0.75 * archSize, z);
      vert.castShadow = true;
      vert.receiveShadow = true;
      this.group.add(vert);

      // Left & right sweeping curved ribs (tapered segments curving gracefully inward at crown)
      for (const side of [-1, 1]) {
        const ribGroup = new THREE.Group();
        ribGroup.position.set(curveX + side * 1.1 * archSize, 0.3, z);
        let px = 0, py = 0;
        const segLen = 3.2 * archSize;
        for (let s = 0; s < 4; s++) {
          const ang = (0.42 - s * 0.38) * side;
          const rThick = (0.62 - s * 0.12) * archSize;
          const geo = s === 3
            ? new THREE.ConeGeometry(rThick, segLen * 1.1, 6)
            : new THREE.CylinderGeometry(rThick * 0.78, rThick, segLen, 6);
          const seg = new THREE.Mesh(geo, bone);
          const nx = px + Math.sin(ang) * segLen * 0.5;
          const ny = py + Math.cos(ang) * segLen * 0.5;
          seg.position.set(nx, ny, 0);
          seg.rotation.z = -ang;
          seg.castShadow = true;
          seg.receiveShadow = true;
          ribGroup.add(seg);
          px += Math.sin(ang) * segLen * 0.90;
          py += Math.cos(ang) * segLen * 0.90;
        }
        this.group.add(ribGroup);
      }
    }

    // Weathered horned skull half-buried at the north end
    const skull = new THREE.Mesh(new THREE.ConeGeometry(3.4, 8.2, 5), bone);
    skull.rotation.x = -Math.PI * 0.44;
    skull.position.set(0.4, 1.8, -14.5);
    skull.scale.set(1.15, 1, 0.65);
    skull.castShadow = true;
    this.group.add(skull);
    this.addCollider(0.4, -14.5, 3.2);
  }

  private buildSunkenGate() {
    const stone = createCelMaterial({
      color: '#7d857e', flatShading: true, shadowTint: '#48607d', rimStrength: 0.34, mossTop: 0.55,
      cacheKey: 'cel_wonder_gate_stone_v1',
    });
    const runeBase = new THREE.Color('#4be5ff');
    const runeMat = new THREE.MeshBasicMaterial({
      color: runeBase.clone().multiplyScalar(1.35),
      transparent: true,
      opacity: 0.88,
      side: THREE.DoubleSide,
      fog: false,
    });
    this.animatedMats.push({ mat: runeMat, base: runeBase, dayMul: 1.25, nightMul: 2.1 });

    // Monumental half-submerged triangular stone gate (2 leaning monoliths joined by a carved apex)
    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.88, 1.85, 18.8, 5), stone);
      leg.position.set(side * 4.2, 6.2, 0);
      leg.rotation.z = side * 0.34;
      leg.castShadow = true;
      leg.receiveShadow = true;
      this.group.add(leg);

      // Glowing inlaid rune ribbon along the inner edge
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.22, 13.5, 0.22), runeMat);
      strip.position.set(side * 3.3, 6.6, 0);
      strip.rotation.z = side * 0.34;
      this.group.add(strip);
      this.addCollider(side * 6.4, 0, 2.2);
    }

    // Carved triangular stone apex joining the twin pillars cleanly at the summit
    const apex = new THREE.Mesh(new THREE.ConeGeometry(2.45, 3.8, 4), stone);
    apex.position.set(0, 15.6, 0);
    apex.rotation.y = Math.PI / 4;
    apex.scale.set(1.15, 1, 0.68);
    apex.castShadow = true;
    this.group.add(apex);

    // Floating sacred triangular keystone suspended inside the portal
    const capstone = new THREE.Mesh(new THREE.OctahedronGeometry(1.45, 0), runeMat);
    capstone.position.set(0, 7.2, 0);
    capstone.scale.set(1.0, 1.55, 1.0);
    this.group.add(capstone);
    this.floaters.push({ obj: capstone, baseY: 7.2, phase: 0.4, amp: 0.55 });

    // Half-submerged weathered outer stepping stones
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.4;
      const st = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.4, 2.2, 6), stone);
      st.position.set(Math.cos(a) * 9.5, -0.35 + (i % 2) * 0.45, Math.sin(a) * 9.5);
      st.rotation.set(0.08 * (i % 3 - 1), a, 0.06);
      this.group.add(st);
    }
  }

  private buildSpiritTree() {
    const bark = createCelMaterial({
      color: '#433e3a', shadowTint: '#284d5c', rimStrength: 0.30, mossTop: 0.48,
      cacheKey: 'cel_wonder_spirit_bark_v1',
    });
    const canopy = createCelMaterial({
      color: '#217865', shadowTint: '#2b5c6e', rimStrength: 0.46, highlight: 0.18,
      wind: { amp: 0.20, freq: 1.0, heightOffset: 14.0 },
      cacheKey: 'cel_wonder_spirit_canopy_v1',
    });
    const glowBase = new THREE.Color('#42f5d8');
    const glowMat = new THREE.MeshBasicMaterial({
      color: glowBase.clone().multiplyScalar(1.35),
      fog: false,
    });
    this.animatedMats.push({ mat: glowMat, base: glowBase, dayMul: 1.15, nightMul: 2.35 });

    // Colossal millennial trunk + 5 graceful sweeping buttress roots flaring outward into the earth
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 4.4, 22, 8), bark);
    trunk.position.y = 10.5;
    trunk.castShadow = true;
    trunk.receiveShadow = true;
    this.group.add(trunk);

    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      const root = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 1.75, 8.2, 6), bark);
      // Tilt inward toward the trunk at the top so the wide base flares naturally out into the hill
      root.position.set(Math.cos(a) * 3.5, 2.5, Math.sin(a) * 3.5);
      root.rotation.set(-Math.sin(a) * 0.44, 0, Math.cos(a) * 0.44);
      root.castShadow = true;
      root.receiveShadow = true;
      this.group.add(root);

      // Luminous sap vein climbing the ancient trunk
      const vein = new THREE.Mesh(new THREE.BoxGeometry(0.24, 15.5, 0.24), glowMat);
      vein.position.set(Math.cos(a) * 2.55, 9.8, Math.sin(a) * 2.55);
      vein.rotation.y = -a;
      this.group.add(vein);
    }

    // Vast tiered canopy piercing above the Mistwood fog
    const tiers: [number, number, number, number, number][] = [
      [0, 23.5, 0, 10.4, 4.4],
      [6.6, 20.5, 2.8, 6.6, 3.3],
      [-6.4, 21.0, 2.4, 6.8, 3.5],
      [1.2, 20.8, -6.4, 6.7, 3.2],
      [-1.5, 27.6, -0.5, 7.2, 3.6],
      [0, 31.2, 0, 4.9, 2.9],
    ];
    for (const [x, y, z, rx, ry] of tiers) {
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), canopy);
      m.scale.set(rx, ry, rx);
      m.position.set(x, y, z);
      m.castShadow = true;
      m.receiveShadow = false;
      this.group.add(m);
    }

    // Floating bioluminescent spirit lanterns hanging beneath the great boughs
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + 0.3;
      const r = 5.5 + (i % 2) * 2.4;
      const y = 13.5 + (i % 3) * 2.2;
      const orb = new THREE.Mesh(new THREE.OctahedronGeometry(0.45, 0), glowMat);
      orb.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
      this.group.add(orb);
      this.floaters.push({ obj: orb, baseY: y, phase: i * 1.1, amp: 0.45 });
    }
    this.addCollider(0, 0, 4.4);
  }

  private buildIceSpire() {
    const iceBody = createCelMaterial({
      color: '#a8e2ff', flatShading: true, shadowTint: '#3a6aa8', rimStrength: 0.68, rimPower: 2.0, highlight: 0.35,
      cacheKey: 'cel_wonder_ice_v1',
    });
    const iceCoreBase = new THREE.Color('#7ee8ff');
    const iceCoreMat = new THREE.MeshBasicMaterial({
      color: iceCoreBase.clone().multiplyScalar(1.3),
      transparent: true,
      opacity: 0.85,
      fog: false,
    });
    this.animatedMats.push({ mat: iceCoreMat, base: iceCoreBase, dayMul: 1.15, nightMul: 2.0 });

    // Central soaring hexagonal glacier spire + 6 angled crystal shards
    const main = new THREE.Mesh(new THREE.ConeGeometry(3.4, 24.5, 6), iceBody);
    main.position.y = 11.8;
    main.castShadow = true;
    main.receiveShadow = true;
    this.group.add(main);

    const shards: [number, number, number, number, number, number][] = [
      [3.6, 7.2, 1.2, 2.0, 15.5, -0.22],
      [-3.4, 6.8, -1.5, 1.9, 14.5, 0.24],
      [0.8, 6.0, -3.8, 1.7, 13.0, 0.18],
      [-1.4, 5.5, 3.6, 1.8, 12.2, -0.20],
      [4.5, 3.8, -2.8, 1.4, 8.8, -0.35],
      [-4.2, 3.6, 2.5, 1.3, 8.2, 0.34],
    ];
    for (const [x, y, z, r, h, tilt] of shards) {
      const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, 5), iceBody);
      m.position.set(x, y, z);
      m.rotation.set(tilt * 0.7, x, tilt);
      m.castShadow = true;
      m.receiveShadow = true;
      this.group.add(m);
    }

    // Floating crystalline resonance shard hovering above the glacier crown
    const crown = new THREE.Mesh(new THREE.OctahedronGeometry(1.15, 0), iceCoreMat);
    crown.position.set(0, 26.2, 0);
    crown.scale.set(0.8, 1.8, 0.8);
    this.group.add(crown);
    this.floaters.push({ obj: crown, baseY: 26.2, phase: 0, amp: 0.65 });
    this.addCollider(0, 0, 4.2);
  }

  update(t: number) {
    const night = celUniforms.uNightFactor.value;
    for (const a of this.animatedMats) {
      const pulse = 0.92 + 0.08 * Math.sin(t * 2.2 + this.def.biomeIndex);
      const mul = (a.dayMul + (a.nightMul - a.dayMul) * night) * pulse;
      a.mat.color.copy(a.base).multiplyScalar(mul);
    }
    for (const f of this.floaters) {
      f.obj.position.y = f.baseY + Math.sin(t * 1.5 + f.phase) * f.amp;
      f.obj.rotation.y = t * 0.55 + f.phase;
    }
  }
}
