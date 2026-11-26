import * as THREE from 'three';
import { celUniforms } from './cel';
import { mulberry32 } from './noise';
import { BIOMES, BIOME_COUNT } from './biomes';

/**
 * Pooled soft-sprite particle system (one draw call): sparkles, dust,
 * splashes, wind trails. Per-particle size, colour, alpha, gravity, drag.
 */
export class Particles {
  readonly points: THREE.Points;
  private readonly max: number;
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private alpha: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private size0: Float32Array;
  private grav: Float32Array;
  private drag: Float32Array;
  private grow: Float32Array;
  private cursor = 0;
  private mat: THREE.ShaderMaterial;
  private readonly tmpC = new THREE.Color();

  constructor(max = 900, additive = true) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.size0 = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.grow = new Float32Array(max);
    for (let i = 0; i < max; i++) this.pos[i * 3 + 1] = -9999;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      premultipliedAlpha: true,
      uniforms: { uScale: { value: 400 } },
      vertexShader: /* glsl */ `
        attribute float aSize; attribute float aAlpha;
        varying vec3 vColor; varying float vAlpha;
        uniform float uScale;
        void main() {
          vColor = color; vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uScale / max(0.5, -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        varying vec3 vColor; varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          float a = smoothstep(1.0, 0.0, d);
          a = a * a * vAlpha;
          if (a < 0.003) discard;
          gl_FragColor = vec4(vColor * a, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      vertexColors: true,
    });
    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
  }

  setViewport(heightPx: number, fovDeg: number) {
    this.mat.uniforms.uScale.value = (heightPx * 0.5) / Math.tan((fovDeg * Math.PI) / 360);
  }

  spawn(
    x: number, y: number, z: number,
    vx: number, vy: number, vz: number,
    color: THREE.ColorRepresentation, size: number, life: number,
    gravity = 0, drag = 0, grow = 0,
  ) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.tmpC.set(color);
    this.col[i * 3] = this.tmpC.r; this.col[i * 3 + 1] = this.tmpC.g; this.col[i * 3 + 2] = this.tmpC.b;
    this.life[i] = life; this.maxLife[i] = life;
    this.size0[i] = size; this.size[i] = size;
    this.grav[i] = gravity; this.drag[i] = drag; this.grow[i] = grow;
    this.alpha[i] = 1;
  }

  /** Radial burst of sparkles. */
  burst(p: THREE.Vector3, count: number, color: THREE.ColorRepresentation, speed = 6, size = 0.5, life = 1.1, gravity = 3) {
    for (let k = 0; k < count; k++) {
      const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const s = speed * (0.4 + Math.random() * 0.6);
      this.spawn(p.x, p.y, p.z, r * Math.cos(th) * s, u * s + speed * 0.3, r * Math.sin(th) * s,
        color, size * (0.6 + Math.random() * 0.8), life * (0.6 + Math.random() * 0.6), gravity, 2.2);
    }
  }

  /** Low ring of dust kicked up on landing. */
  dust(p: THREE.Vector3, count: number, strength: number, color: THREE.ColorRepresentation = '#a08a68') {
    for (let k = 0; k < count; k++) {
      const th = Math.random() * Math.PI * 2;
      const s = strength * (0.5 + Math.random() * 0.7);
      this.spawn(p.x + Math.cos(th) * 0.3, p.y + 0.15, p.z + Math.sin(th) * 0.3,
        Math.cos(th) * s, 0.6 + Math.random() * 1.2, Math.sin(th) * s,
        color, 0.45 + Math.random() * 0.4, 0.55 + Math.random() * 0.35, -0.6, 3.2, 1.2);
    }
  }

  splash(p: THREE.Vector3, count: number, strength: number) {
    for (let k = 0; k < count; k++) {
      const th = Math.random() * Math.PI * 2;
      const s = strength * (0.3 + Math.random() * 0.7);
      this.spawn(p.x, p.y, p.z, Math.cos(th) * s * 0.5, 3 + Math.random() * strength, Math.sin(th) * s * 0.5,
        '#d8f4ff', 0.45 + Math.random() * 0.4, 0.8 + Math.random() * 0.4, 18, 0.6);
    }
  }

  update(dt: number) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.alpha[i] = 0; this.pos[i * 3 + 1] = -9999; continue; }
      const d = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i * 3] *= d; this.vel[i * 3 + 2] *= d;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d - this.grav[i] * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const k = this.life[i] / this.maxLife[i];
      this.alpha[i] = Math.min(1, k * 2.2) * Math.min(1, (1 - k) * 12 + 0.2);
      this.size[i] = this.size0[i] * (1 + (1 - k) * this.grow[i]);
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
    g.attributes.aSize.needsUpdate = true;
    g.attributes.aAlpha.needsUpdate = true;
  }
}

/**
 * GPU-driven toroidal atmospheric motes following the player (1 draw call, zero per-frame particle loop):
 * Smoothly adapts color, drift velocity, size, and glow across the six biomes and day/night cycle:
 * - 翠野: sunlit pollen (day) / fireflies (night)
 * - 西嶺石林: jade mountain mist motes
 * - 東崖赤谷: windblown warm ochre sand & dust
 * - 南湖楓渚: falling crimson & amber maple leaves (day) / golden fireflies (night)
 * - 霧林: floating emerald-cyan & lavender glowing spores
 * - 北境雪原: gently falling snowflakes
 */
export class AmbientMotes {
  readonly points: THREE.Points;
  private readonly mat: THREE.ShaderMaterial;
  private readonly curDayA = new THREE.Color(1.18, 1.14, 0.90);
  private readonly curDayB = new THREE.Color(1.12, 1.20, 0.88);
  private readonly curNightA = new THREE.Color(1.35, 1.95, 0.58);
  private readonly curNightB = new THREE.Color(1.85, 1.65, 0.52);
  private readonly curDrift = new THREE.Vector3(0.75, 0.14, 0.35);
  private curSize = 0.36;
  private curDayAlpha = 0.54;
  private curNightAlpha = 0.92;
  private readonly driftOffset = new THREE.Vector3();

  private readonly tmpDayA = new THREE.Color();
  private readonly tmpDayB = new THREE.Color();
  private readonly tmpNightA = new THREE.Color();
  private readonly tmpNightB = new THREE.Color();
  private readonly tmpDrift = new THREE.Vector3();

  constructor(count = 320) {
    const rand = mulberry32(808);
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count * 3); // x: phase, y: size, z: speed
    const boxXZ = 54;
    const boxY = 18;

    for (let i = 0; i < count; i++) {
      pos[i * 3] = rand() * boxXZ;
      pos[i * 3 + 1] = rand() * boxY;
      pos[i * 3 + 2] = rand() * boxXZ;
      seed[i * 3] = rand() * Math.PI * 2;
      seed[i * 3 + 1] = 0.68 + rand() * 0.68; // multiplier around biome size
      seed[i * 3 + 2] = 0.65 + rand() * 0.9;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 3));

    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      uniforms: {
        uTime: celUniforms.uTime,
        uNightFactor: celUniforms.uNightFactor,
        uSunsetFactor: celUniforms.uSunsetFactor,
        uCenter: { value: new THREE.Vector3() },
        uDriftOffset: { value: this.driftOffset },
        uScale: { value: 400 },
        uBox: { value: new THREE.Vector3(boxXZ, boxY, boxXZ) },
        uDayColA: { value: this.curDayA },
        uDayColB: { value: this.curDayB },
        uNightColA: { value: this.curNightA },
        uNightColB: { value: this.curNightB },
        uMoteSize: { value: this.curSize },
        uDayAlpha: { value: this.curDayAlpha },
        uNightAlpha: { value: this.curNightAlpha },
      },
      vertexShader: /* glsl */ `
        attribute vec3 aSeed;
        uniform float uTime;
        uniform float uNightFactor;
        uniform vec3 uCenter;
        uniform vec3 uDriftOffset;
        uniform float uScale;
        uniform vec3 uBox;
        uniform float uMoteSize;
        uniform float uDayAlpha;
        uniform float uNightAlpha;
        varying float vAlpha;
        varying float vPulse;
        varying float vPhase;

        void main() {
          float ph = aSeed.x;
          float sz = aSeed.y * uMoteSize;
          float sp = aSeed.z;
          vPhase = ph;

          // Integrated biome drift + gentle organic flutter
          vec3 drift = uDriftOffset * (0.72 + 0.42 * sp) + vec3(
            sin(uTime * 0.85 * sp + ph) * 1.45,
            sin(uTime * 1.05 * sp + ph * 1.7) * 0.85,
            cos(uTime * 0.72 * sp + ph * 1.3) * 1.45
          );

          // Toroidally wrap around the viewer so motes surround the player everywhere
          vec3 rel = mod(position + drift - uCenter + uBox * 0.5, uBox) - uBox * 0.5;
          vec3 wp = uCenter + rel;

          // Keep motes gracefully above water level
          wp.y = max(wp.y, 1.9 + fract(ph * 3.17) * 2.5);

          // Smooth fade near volume bounds & very close to camera lens
          vec3 edge = 1.0 - smoothstep(uBox * 0.34, uBox * 0.5, abs(rel));
          float boxFade = edge.x * edge.y * edge.z;
          vec4 mv = modelViewMatrix * vec4(wp, 1.0);
          float camDist = max(0.5, -mv.z);
          float nearFade = smoothstep(1.2, 4.2, camDist);

          float pulseBase = clamp(0.5 + 0.5 * sin(uTime * (1.6 + sp * 1.1) + ph * 3.0), 0.0, 1.0);
          float fireflyPulse = 0.28 + 0.72 * (pulseBase > 1e-6 ? pow(pulseBase, 2.0) : 0.0);
          float dayTwinkle = 0.62 + 0.38 * sin(uTime * 1.8 + ph * 2.0);
          vPulse = mix(dayTwinkle, fireflyPulse, uNightFactor);

          vAlpha = boxFade * nearFade * vPulse * mix(uDayAlpha, uNightAlpha, uNightFactor);

          float finalSize = sz * mix(0.88, 1.22, uNightFactor) * (0.76 + 0.34 * vPulse);
          gl_PointSize = clamp(finalSize * uScale / camDist, 1.6, 24.0);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uNightFactor;
        uniform float uSunsetFactor;
        uniform vec3 uDayColA;
        uniform vec3 uDayColB;
        uniform vec3 uNightColA;
        uniform vec3 uNightColB;
        varying float vAlpha;
        varying float vPulse;
        varying float vPhase;

        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          if (d > 1.0) discard;
          float core = smoothstep(0.58, 0.0, d);
          float haloBase = clamp(1.0 - d, 0.0, 1.0);
          float halo = haloBase > 1e-6 ? pow(haloBase, 2.1) : 0.0;
          float a = (halo * 0.62 + core * 0.88) * vAlpha;
          if (a < 0.004) discard;

          float mixF = fract(vPhase * 2.71);
          vec3 dayCol = mix(uDayColA, uDayColB, mixF);
          vec3 sunsetCol = mix(dayCol, vec3(1.42, 0.98, 0.52), 0.55);
          vec3 nightCol = mix(uNightColA, uNightColB, mixF);

          vec3 col = mix(dayCol, sunsetCol, uSunsetFactor * 0.72);
          col = mix(col, nightCol, uNightFactor);

          gl_FragColor = vec4(col * a, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });

    this.points = new THREE.Points(geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
  }

  setViewport(heightPx: number, fovDeg: number) {
    this.mat.uniforms.uScale.value = (heightPx * 0.5) / Math.tan((fovDeg * Math.PI) / 360);
  }

  update(center: THREE.Vector3, dt = 0.016, weights?: Float32Array) {
    (this.mat.uniforms.uCenter.value as THREE.Vector3).set(center.x, center.y + 4.8, center.z);

    if (weights) {
      this.tmpDayA.setRGB(0, 0, 0);
      this.tmpDayB.setRGB(0, 0, 0);
      this.tmpNightA.setRGB(0, 0, 0);
      this.tmpNightB.setRGB(0, 0, 0);
      this.tmpDrift.set(0, 0, 0);
      let tSize = 0;
      let tDayA = 0;
      let tNightA = 0;

      for (let i = 0; i < BIOME_COUNT; i++) {
        const w = weights[i];
        if (w <= 0.0001) continue;
        const m = BIOMES[i].motes;
        this.tmpDayA.r += m.dayColA.r * w; this.tmpDayA.g += m.dayColA.g * w; this.tmpDayA.b += m.dayColA.b * w;
        this.tmpDayB.r += m.dayColB.r * w; this.tmpDayB.g += m.dayColB.g * w; this.tmpDayB.b += m.dayColB.b * w;
        this.tmpNightA.r += m.nightColA.r * w; this.tmpNightA.g += m.nightColA.g * w; this.tmpNightA.b += m.nightColA.b * w;
        this.tmpNightB.r += m.nightColB.r * w; this.tmpNightB.g += m.nightColB.g * w; this.tmpNightB.b += m.nightColB.b * w;
        this.tmpDrift.addScaledVector(m.drift, w);
        tSize += m.size * w;
        tDayA += m.dayAlpha * w;
        tNightA += m.nightAlpha * w;
      }

      const k = Math.min(1, dt * 1.8);
      this.curDayA.lerp(this.tmpDayA, k);
      this.curDayB.lerp(this.tmpDayB, k);
      this.curNightA.lerp(this.tmpNightA, k);
      this.curNightB.lerp(this.tmpNightB, k);
      this.curDrift.lerp(this.tmpDrift, k);
      this.curSize += (tSize - this.curSize) * k;
      this.curDayAlpha += (tDayA - this.curDayAlpha) * k;
      this.curNightAlpha += (tNightA - this.curNightAlpha) * k;
      this.mat.uniforms.uMoteSize.value = this.curSize;
      this.mat.uniforms.uDayAlpha.value = this.curDayAlpha;
      this.mat.uniforms.uNightAlpha.value = this.curNightAlpha;
    }

    this.driftOffset.addScaledVector(this.curDrift, dt);
    // Keep offset bounded to prevent float precision drift over long sessions
    const box = this.mat.uniforms.uBox.value as THREE.Vector3;
    this.driftOffset.x = ((this.driftOffset.x % box.x) + box.x) % box.x;
    this.driftOffset.y = ((this.driftOffset.y % box.y) + box.y) % box.y;
    this.driftOffset.z = ((this.driftOffset.z % box.z) + box.z) % box.z;
  }
}

