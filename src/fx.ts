import * as THREE from 'three';
import { celUniforms } from './cel';
import { mulberry32 } from './noise';

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
 * GPU-driven toroidal atmospheric motes following the player (zero per-frame CPU loop):
 * - Daytime: airy sunlit pollen & dandelion fluff drifting on mountain breezes
 * - Sunset: warm golden dust glinting in low sunlight
 * - Nighttime: gently pulsing emerald-gold fireflies (螢火蟲)
 */
export class AmbientMotes {
  readonly points: THREE.Points;
  private readonly mat: THREE.ShaderMaterial;

  constructor(count = 260) {
    const rand = mulberry32(808);
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count * 3); // x: phase, y: size, z: speed
    const boxXZ = 54;
    const boxY = 16;

    for (let i = 0; i < count; i++) {
      pos[i * 3] = rand() * boxXZ;
      pos[i * 3 + 1] = rand() * boxY;
      pos[i * 3 + 2] = rand() * boxXZ;
      seed[i * 3] = rand() * Math.PI * 2;
      seed[i * 3 + 1] = 0.22 + rand() * 0.34;
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
        uScale: { value: 400 },
        uBox: { value: new THREE.Vector3(boxXZ, boxY, boxXZ) },
      },
      vertexShader: /* glsl */ `
        attribute vec3 aSeed;
        uniform float uTime;
        uniform float uNightFactor;
        uniform vec3 uCenter;
        uniform float uScale;
        uniform vec3 uBox;
        varying float vAlpha;
        varying float vPulse;
        varying float vPhase;

        void main() {
          float ph = aSeed.x;
          float sz = aSeed.y;
          float sp = aSeed.z;
          vPhase = ph;

          // Gentle breeze drift + organic wandering
          vec3 drift = vec3(
            uTime * (0.65 + 0.45 * sp) + sin(uTime * 0.7 * sp + ph) * 1.4,
            sin(uTime * 0.9 * sp + ph * 1.7) * 0.9 + uTime * 0.14 * (1.0 - 0.6 * uNightFactor),
            uTime * (0.32 + 0.25 * sp) + cos(uTime * 0.6 * sp + ph * 1.3) * 1.4
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

          // Night fireflies pulse slowly & luminously; daytime pollen twinkles softly
          float fireflyPulse = 0.25 + 0.75 * pow(0.5 + 0.5 * sin(uTime * (1.6 + sp * 1.1) + ph * 3.0), 2.2);
          float dayTwinkle = 0.55 + 0.45 * sin(uTime * 1.8 + ph * 2.0);
          vPulse = mix(dayTwinkle, fireflyPulse, uNightFactor);

          vAlpha = boxFade * nearFade * vPulse * mix(0.52, 0.92, uNightFactor);

          float finalSize = sz * mix(0.75, 1.25, uNightFactor) * (0.7 + 0.4 * vPulse);
          gl_PointSize = clamp(finalSize * uScale / camDist, 1.5, 22.0);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uNightFactor;
        uniform float uSunsetFactor;
        varying float vAlpha;
        varying float vPulse;
        varying float vPhase;

        void main() {
          float d = length(gl_PointCoord - 0.5) * 2.0;
          if (d > 1.0) discard;
          float core = smoothstep(0.55, 0.0, d);
          float halo = pow(1.0 - d, 2.2);
          float a = (halo * 0.65 + core * 0.85) * vAlpha;
          if (a < 0.004) discard;

          // Daytime sunlit cream pollen -> Sunset honey-gold -> Night emerald-gold fireflies (HDR for soft bloom)
          vec3 dayCol = vec3(1.18, 1.14, 0.92);
          vec3 sunsetCol = vec3(1.45, 1.05, 0.52);
          vec3 fireflyA = vec3(1.35, 1.95, 0.58);
          vec3 fireflyB = vec3(1.85, 1.65, 0.52);
          vec3 nightCol = mix(fireflyA, fireflyB, fract(vPhase * 2.7));

          vec3 col = mix(dayCol, sunsetCol, uSunsetFactor * 0.85);
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

  update(center: THREE.Vector3) {
    (this.mat.uniforms.uCenter.value as THREE.Vector3).set(center.x, center.y + 4.5, center.z);
  }
}

