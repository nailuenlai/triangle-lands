import * as THREE from 'three';
import { HALF, WATER_LEVEL } from './terrain';
import { createCelMaterial, createSubtleOutlineMaterial } from './cel';

export interface WorldQuery {
  ground(x: number, z: number, y: number): number;
  collide(p: THREE.Vector3): void;
  /** 0..1 upward wind strength at a point (rising air columns). */
  updraft(x: number, y: number, z: number): number;
}

export type Mode = 'ground' | 'air' | 'glide' | 'climb' | 'swim';

export interface PlayerControls {
  move: { x: number; y: number };
  jump: boolean;   // pressed this frame
  sprint: boolean; // held
}

export interface PlayerEvents {
  jump?(): void;
  land?(impact: number): void;
  glideOpen?(): void;
  glideClose?(): void;
  climbStart?(): void;
  climbLeap?(): void;
  mantle?(): void;
  exhausted?(): void;
  recovered?(): void;
  splash?(impact: number): void;
}

const GRAVITY = 28;
const JUMP_V = 10.5;
const RUN = 8.5;
const SPRINT = 13.5;
const SWIM = 4.2;
const SWIM_DASH = 8;
const CLIMB = 3.6;
const GLIDE_SPEED = 11.5;
const GLIDE_SINK = 2.0;
const DIVE_SPEED = 21;
const DIVE_SINK = 11;
const UPDRAFT_RISE = 14;
const MAX_CLIMB_RATIO = 1.35; // rise/run above this blocks walking (cliffs)
const MANTLE_SLOPE = 0.9;     // gradient below this = you can stand here again
const SWIM_FLOOR = WATER_LEVEL - 1.1;

// Stamina costs (per second unless noted)
const COST_SPRINT = 15;
const COST_SWIM_DASH = 17;
const COST_CLIMB = 8;
const COST_HANG = 0.8;
const COST_LEAP = 20; // one-off
const COST_GLIDE = 4.2;

const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export class Player {
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  readonly model = new THREE.Group();
  readonly shadow: THREE.Mesh;
  mode: Mode = 'ground';
  facing = 0;
  events: PlayerEvents = {};

  stamina = 100;
  staminaMax = 100;
  exhausted = false;
  sprinting = false;
  diving = false;
  /** Height above the terrain (0 when standing). */
  airHeight = 0;
  /** Uphill direction while climbing (wall normal, flattened & inverted). */
  readonly wallDir = new THREE.Vector2(0, 1);

  private regenDelay = 0;
  private airTime = 0;
  private jumpBuffer = 0;
  private usedAirJump = false;
  private leapT = 0;
  private climbAnim = 0;
  private bob = 0;
  private squash = 0;
  private squashV = 0;
  private gliderS = 0;
  private gliderV = 0;
  private roll = 0;
  private lastFacing = 0;
  private climbSlope = 1.5;

  private body: THREE.Group;
  private armL: THREE.Group;
  private armR: THREE.Group;
  private footL: THREE.Mesh;
  private footR: THREE.Mesh;
  private tail: THREE.Mesh;
  private glider: THREE.Group;

  constructor() {
    const cloak = createCelMaterial({
      color: '#2e78b5', shadowTint: '#5974a8', rimStrength: 0.46, rimPower: 2.5, cacheKey: 'cel_player_v1',
    });
    const cloakDark = createCelMaterial({
      color: '#235e91', shadowTint: '#526a9c', rimStrength: 0.4, rimPower: 2.6, cacheKey: 'cel_player_v1',
    });
    const skin = createCelMaterial({
      color: '#f5cfa9', shadowTint: '#9b87a8', rimStrength: 0.42, rimPower: 2.6, cacheKey: 'cel_player_v1',
    });
    const hair = createCelMaterial({
      color: '#473222', shadowTint: '#5c6687', rimStrength: 0.36, rimPower: 2.8, cacheKey: 'cel_player_v1',
    });
    const scarf = createCelMaterial({
      color: '#e8653c', shadowTint: '#8d6c96', rimStrength: 0.5, rimPower: 2.4, cacheKey: 'cel_player_v1',
    });
    const boot = createCelMaterial({
      color: '#543c2b', shadowTint: '#5c6a8a', rimStrength: 0.25, cacheKey: 'cel_player_v1',
    });
    const eye = new THREE.MeshBasicMaterial({ color: '#1b1b1b', fog: false });
    const outlineMat = createSubtleOutlineMaterial(0.02, '#2d354c');

    const withOutline = (mesh: THREE.Mesh) => {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const hull = new THREE.Mesh(mesh.geometry, outlineMat);
      hull.renderOrder = 2;
      mesh.add(hull);
      return mesh;
    };

    this.body = new THREE.Group();
    const torso = withOutline(new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.25, 12), cloak));
    torso.position.y = 0.72;
    const head = withOutline(new THREE.Mesh(new THREE.IcosahedronGeometry(0.33, 1), skin));
    head.position.y = 1.55;
    const hairM = withOutline(new THREE.Mesh(new THREE.IcosahedronGeometry(0.355, 1), hair));
    hairM.position.set(0, 1.63, -0.06);
    hairM.scale.set(1, 0.82, 1);
    const sc = withOutline(new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.38, 0.18, 12), scarf));
    sc.position.y = 1.25;
    const tailGeo = new THREE.BoxGeometry(0.14, 0.52, 0.06);
    tailGeo.translate(0, -0.26, 0);
    this.tail = withOutline(new THREE.Mesh(tailGeo, scarf));
    this.tail.position.set(0.12, 1.25, -0.3);
    this.tail.rotation.x = 0.35;
    const e1 = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.02), eye);
    e1.position.set(0.11, 1.57, 0.31);
    const e2 = e1.clone(); e2.position.x = -0.11;

    const armGeo = new THREE.CylinderGeometry(0.068, 0.075, 0.56, 8);
    armGeo.translate(0, -0.26, 0);
    const handGeo = new THREE.IcosahedronGeometry(0.09, 1);
    handGeo.translate(0, -0.56, 0);
    const mkArm = (x: number) => {
      const g = new THREE.Group();
      g.position.set(x, 1.2, 0);
      const sleeve = new THREE.Mesh(armGeo, cloakDark);
      const hand = new THREE.Mesh(handGeo, skin);
      sleeve.castShadow = true;
      hand.castShadow = true;
      g.add(sleeve, hand);
      return g;
    };
    this.armL = mkArm(0.36);
    this.armR = mkArm(-0.36);
    const footGeo = new THREE.BoxGeometry(0.17, 0.13, 0.3);
    footGeo.translate(0, 0.065, 0.04);
    this.footL = new THREE.Mesh(footGeo, boot);
    this.footR = new THREE.Mesh(footGeo, boot);
    this.footL.castShadow = true;
    this.footR.castShadow = true;
    this.footL.position.x = 0.17;
    this.footR.position.x = -0.17;

    // Triangle paraglider (fitting the land's motif)
    this.glider = new THREE.Group();
    const wing = new THREE.BufferGeometry();
    const nose = [0, 0.12, 1.15], lt = [-1.9, -0.2, -0.65], rt = [1.9, -0.2, -0.65], back = [0, 0.28, -0.4];
    wing.setAttribute('position', new THREE.Float32BufferAttribute([...nose, ...lt, ...back, ...nose, ...back, ...rt], 3));
    wing.computeVertexNormals();
    const cloth = createCelMaterial({
      color: '#fbf3e0', side: THREE.DoubleSide, shadowTint: '#8da3c4', rimStrength: 0.45, cacheKey: 'cel_glider_v1',
    });
    const stripe = createCelMaterial({
      color: '#e5653c', side: THREE.DoubleSide, shadowTint: '#8e6d94', rimStrength: 0.45, cacheKey: 'cel_glider_v1',
    });
    const wingMesh = new THREE.Mesh(wing, cloth);
    wingMesh.castShadow = true;
    const inner = new THREE.Mesh(wing, stripe);
    inner.scale.setScalar(0.5);
    inner.position.set(0, 0.03, 0.12);
    const strings = new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-1.85, -0.2, -0.62), new THREE.Vector3(-0.3, -1.3, 0),
        new THREE.Vector3(1.85, -0.2, -0.62), new THREE.Vector3(0.3, -1.3, 0),
        new THREE.Vector3(0, 0.1, 1.1), new THREE.Vector3(0, -1.3, 0.05),
      ]),
      new THREE.LineBasicMaterial({ color: '#5a4630', transparent: true, opacity: 0.72 }),
    );
    this.glider.add(wingMesh, inner, strings);
    this.glider.position.set(0, 2.55, 0);
    this.glider.scale.setScalar(0.001);
    this.glider.visible = false;

    this.body.add(torso, head, hairM, sc, this.tail, e1, e2, this.armL, this.armR, this.footL, this.footR);
    this.model.add(this.body, this.glider);

    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const ctx = cv.getContext('2d')!;
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(32,52,88,0.28)');
    g.addColorStop(1, 'rgba(32,52,88,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1.7, 1.7).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, fog: false }),
    );
  }

  get grounded() { return this.mode === 'ground'; }
  get swimming() { return this.mode === 'swim'; }
  get gliding() { return this.mode === 'glide'; }
  get climbing() { return this.mode === 'climb'; }
  get speedXZ() { return Math.hypot(this.vel.x, this.vel.z); }

  /** Reset to a standing state (used on load / respawn). */
  place(x: number, y: number, z: number) {
    this.pos.set(x, y, z);
    this.vel.set(0, 0, 0);
    this.mode = 'ground';
    this.leapT = 0;
    this.gliderS = 0;
    this.stamina = this.staminaMax;
    this.exhausted = false;
  }

  private canUseStamina() { return !this.exhausted && this.stamina > 0; }

  /** Spend stamina; returns false (and becomes exhausted) when it runs out. */
  private spend(amount: number): boolean {
    if (this.exhausted) return false;
    this.stamina -= amount;
    this.regenDelay = 0.6;
    if (this.stamina <= 0) {
      this.stamina = 0;
      this.exhausted = true;
      this.events.exhausted?.();
      return false;
    }
    return true;
  }

  private gradient(world: WorldQuery, x: number, z: number): [number, number] {
    const e = 0.6;
    const gx = (world.ground(x + e, z, this.pos.y) - world.ground(x - e, z, this.pos.y)) / (2 * e);
    const gz = (world.ground(x, z + e, this.pos.y) - world.ground(x, z - e, this.pos.y)) / (2 * e);
    return [gx, gz];
  }

  private enterClimb() {
    this.mode = 'climb';
    this.vel.set(0, 0, 0);
    this.leapT = 0;
    this.events.climbStart?.();
  }

  private toAir(vy = 0) {
    if (this.mode === 'glide') this.events.glideClose?.();
    this.mode = 'air';
    this.vel.y = vy;
    this.airTime = 0;
    this.usedAirJump = false;
  }

  update(dt: number, c: PlayerControls, camYaw: number, world: WorldQuery) {
    const sinY = Math.sin(camYaw), cosY = Math.cos(camYaw);
    const dx = -sinY * c.move.y + cosY * c.move.x;
    const dz = -cosY * c.move.y - sinY * c.move.x;
    const mag = Math.min(1, Math.hypot(dx, dz));
    const nx = mag > 1e-4 ? dx / mag : 0, nz = mag > 1e-4 ? dz / mag : 0;
    this.sprinting = false;
    this.diving = false;
    this.lastFacing = this.facing;

    if (c.jump) this.jumpBuffer = 0.14;
    else this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);

    switch (this.mode) {
      case 'ground': this.updateGround(dt, c, mag, nx, nz, world); break;
      case 'swim': this.updateSwim(dt, c, mag, nx, nz, world); break;
      case 'climb': this.updateClimb(dt, c, cosY, sinY, world); break;
      default: this.updateAir(dt, c, mag, nx, nz, world); break;
    }

    // Island boundary
    const r = Math.hypot(this.pos.x, this.pos.z);
    const maxR = HALF - 12;
    if (r > maxR) { this.pos.x *= maxR / r; this.pos.z *= maxR / r; }

    // Stamina regeneration (only when standing on solid ground)
    if (this.mode === 'ground' && !this.sprinting) {
      this.regenDelay -= dt;
      if (this.regenDelay <= 0) {
        this.stamina = Math.min(this.staminaMax, this.stamina + (this.exhausted ? 30 : 46) * dt);
        if (this.stamina >= this.staminaMax && this.exhausted) {
          this.exhausted = false;
          this.events.recovered?.();
        }
      }
    }

    const g = world.ground(this.pos.x, this.pos.z, this.pos.y);
    this.airHeight = Math.max(0, this.pos.y - Math.max(g, SWIM_FLOOR));
    this.syncModel(mag, g, dt);
  }

  // ---------------------------------------------------------------- Ground
  private updateGround(dt: number, c: PlayerControls, mag: number, nx: number, nz: number, world: WorldQuery) {
    let speed = RUN;
    if (this.exhausted) speed = RUN * 0.55;
    else if (c.sprint && mag > 0.2 && this.spend(COST_SPRINT * dt)) { speed = SPRINT; this.sprinting = true; }

    const k = Math.min(1, dt * (mag > 0.05 ? 12 : 16));
    this.vel.x += (nx * speed * mag - this.vel.x) * k;
    this.vel.z += (nz * speed * mag - this.vel.z) * k;

    const v = Math.hypot(this.vel.x, this.vel.z);
    if (v > 0.02) {
      const mx = this.vel.x / v, mz = this.vel.z / v;
      const stepLen = v * dt;
      let blocked = false;
      const tryMove = (ax: number, az: number): boolean => {
        const tx = this.pos.x + ax * stepLen, tz = this.pos.z + az * stepLen;
        const gT = world.ground(tx, tz, this.pos.y);
        const rise = gT - this.pos.y;
        if (rise / Math.max(stepLen, 1e-4) > MAX_CLIMB_RATIO && rise > 0.05) return false;
        if (rise > 0) {
          const slow = 1 - Math.min(0.55, (rise / stepLen) * 0.4);
          this.pos.x += ax * stepLen * slow; this.pos.z += az * stepLen * slow;
        } else { this.pos.x = tx; this.pos.z = tz; }
        return true;
      };
      if (!tryMove(mx, mz)) {
        blocked = true;
        if (!tryMove(mx, 0)) { this.vel.x *= 0.5; if (!tryMove(0, mz)) this.vel.z *= 0.5; }
      }
      if (mag > 0.05) {
        const diff = wrapAngle(Math.atan2(nx, nz) - this.facing);
        this.facing += diff * Math.min(1, dt * 12);
      }
      this.bob += dt * v * 1.6;

      // Pushing into a cliff -> grab on and climb
      if (blocked && mag > 0.3 && this.canUseStamina()) {
        const [gx, gz] = this.gradient(world, this.pos.x + mx * 0.5, this.pos.z + mz * 0.5);
        const slope = Math.hypot(gx, gz);
        const into = (gx * nx + gz * nz) / Math.max(slope, 1e-4);
        if (slope > MANTLE_SLOPE + 0.1 && into > 0.35) { this.enterClimb(); return; }
      }
    }

    world.collide(this.pos);

    if (this.jumpBuffer > 0) {
      this.jumpBuffer = 0;
      this.toAir(JUMP_V);
      this.usedAirJump = true;
      this.squash = -0.35; this.squashV = 0;
      this.events.jump?.();
      return;
    }

    const g = world.ground(this.pos.x, this.pos.z, this.pos.y);
    if (g < SWIM_FLOOR) { this.mode = 'swim'; this.pos.y = Math.max(g, SWIM_FLOOR); this.vel.y = 0; return; }
    if (this.pos.y - g > 0.7) { this.toAir(0); return; } // walked off a ledge
    this.pos.y = g;
    this.vel.y = 0;
  }

  // ---------------------------------------------------------------- Swim
  private updateSwim(dt: number, c: PlayerControls, mag: number, nx: number, nz: number, world: WorldQuery) {
    let speed = this.exhausted ? SWIM * 0.6 : SWIM;
    if (c.sprint && mag > 0.2 && !this.exhausted && this.spend(COST_SWIM_DASH * dt)) { speed = SWIM_DASH; this.sprinting = true; }
    const k = Math.min(1, dt * 5);
    this.vel.x += (nx * speed * mag - this.vel.x) * k;
    this.vel.z += (nz * speed * mag - this.vel.z) * k;
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    if (mag > 0.05) {
      const diff = wrapAngle(Math.atan2(nx, nz) - this.facing);
      this.facing += diff * Math.min(1, dt * 8);
      this.bob += dt * speed * 1.2;
    }
    world.collide(this.pos);
    // Gentle regen while floating still
    if (mag < 0.05 && !this.exhausted) this.stamina = Math.min(this.staminaMax, this.stamina + 8 * dt);

    if (this.jumpBuffer > 0) {
      this.jumpBuffer = 0;
      this.toAir(JUMP_V * 0.75);
      this.usedAirJump = true;
      this.events.jump?.();
      return;
    }
    const g = world.ground(this.pos.x, this.pos.z, this.pos.y);
    if (g >= SWIM_FLOOR) { this.mode = 'ground'; this.pos.y = g; return; }
    this.pos.y = SWIM_FLOOR;
    this.vel.y = 0;
  }

  // ---------------------------------------------------------------- Air & Glide
  private updateAir(dt: number, c: PlayerControls, mag: number, nx: number, nz: number, world: WorldQuery) {
    this.airTime += dt;
    const gHere = world.ground(this.pos.x, this.pos.z, this.pos.y);
    const height = this.pos.y - Math.max(gHere, SWIM_FLOOR);

    if (this.mode === 'glide') {
      const dive = c.sprint;
      this.diving = dive;
      const sp = dive ? DIVE_SPEED : GLIDE_SPEED;
      const fx = mag > 0.1 ? nx : Math.sin(this.facing);
      const fz = mag > 0.1 ? nz : Math.cos(this.facing);
      const amt = mag > 0.1 ? Math.max(0.55, mag) : 0.5;
      const k = Math.min(1, dt * (dive ? 1.6 : 2.2));
      this.vel.x += (fx * sp * amt - this.vel.x) * k;
      this.vel.z += (fz * sp * amt - this.vel.z) * k;
      const up = world.updraft(this.pos.x, this.pos.y, this.pos.z);
      let target = dive ? -DIVE_SINK : -GLIDE_SINK;
      if (up > 0.01 && !dive) target = Math.max(target, UPDRAFT_RISE * up);
      this.vel.y += (target - this.vel.y) * Math.min(1, dt * (up > 0.01 ? 2.4 : 3.2));
      const diff = wrapAngle(Math.atan2(fx, fz) - this.facing);
      this.facing += diff * Math.min(1, dt * 3.5);

      if (!dive && !this.spend(COST_GLIDE * dt)) this.toAir(this.vel.y);
      else if (c.jump) { this.jumpBuffer = 0; this.toAir(this.vel.y); }
    } else {
      // Air control keeps momentum
      if (mag > 0.1) {
        const cur = Math.hypot(this.vel.x, this.vel.z);
        const sp = Math.max(RUN, cur);
        const k = Math.min(1, dt * 3);
        this.vel.x += (nx * sp * mag - this.vel.x) * k;
        this.vel.z += (nz * sp * mag - this.vel.z) * k;
        const diff = wrapAngle(Math.atan2(nx, nz) - this.facing);
        this.facing += diff * Math.min(1, dt * 6);
      }
      this.vel.y -= GRAVITY * dt;
      if (this.vel.y < -40) this.vel.y = -40;

      if (c.jump) {
        if (!this.usedAirJump && this.airTime < 0.13) {
          // Coyote-time jump after walking off a ledge
          this.vel.y = JUMP_V; this.usedAirJump = true; this.jumpBuffer = 0;
          this.events.jump?.();
        } else if (height > 1.6 && this.canUseStamina()) {
          this.jumpBuffer = 0;
          this.mode = 'glide';
          this.vel.y = Math.max(this.vel.y, -3);
          this.gliderV = 6;
          this.events.glideOpen?.();
        }
      }
    }

    // Horizontal motion with wall handling
    const tx = this.pos.x + this.vel.x * dt, tz = this.pos.z + this.vel.z * dt;
    const gT = world.ground(tx, tz, this.pos.y);
    if (gT > this.pos.y + 0.45) {
      const [gx, gz] = this.gradient(world, tx, tz);
      const slope = Math.hypot(gx, gz);
      const v = Math.hypot(this.vel.x, this.vel.z);
      const into = v > 0.1 ? (gx * this.vel.x + gz * this.vel.z) / (v * Math.max(slope, 1e-4)) : 0;
      if (slope > MANTLE_SLOPE + 0.1 && into > 0.3 && this.canUseStamina() && this.vel.y < 6) {
        // Find the wall surface between here and the target (binary search)
        let a = 0, b = 1;
        for (let i = 0; i < 8; i++) {
          const m = (a + b) / 2;
          const h = world.ground(this.pos.x + this.vel.x * dt * m, this.pos.z + this.vel.z * dt * m, this.pos.y);
          if (h > this.pos.y) b = m; else a = m;
        }
        this.pos.x += this.vel.x * dt * a;
        this.pos.z += this.vel.z * dt * a;
        this.pos.y = world.ground(this.pos.x, this.pos.z, this.pos.y);
        if (this.mode === 'glide') this.events.glideClose?.();
        this.enterClimb();
        return;
      }
      // Bonk: slide along whichever axis is free
      const gX = world.ground(tx, this.pos.z, this.pos.y);
      const gZ = world.ground(this.pos.x, tz, this.pos.y);
      if (gX <= this.pos.y + 0.45) this.pos.x = tx; else this.vel.x *= -0.1;
      if (gZ <= this.pos.y + 0.45) this.pos.z = tz; else this.vel.z *= -0.1;
    } else {
      this.pos.x = tx; this.pos.z = tz;
    }
    world.collide(this.pos);

    this.pos.y += this.vel.y * dt;
    const g = world.ground(this.pos.x, this.pos.z, this.pos.y);
    if (g < SWIM_FLOOR && this.pos.y <= SWIM_FLOOR) {
      const impact = -this.vel.y;
      if (this.mode === 'glide') this.events.glideClose?.();
      this.mode = 'swim';
      this.pos.y = SWIM_FLOOR;
      this.vel.y = 0;
      this.vel.x *= 0.4; this.vel.z *= 0.4;
      this.events.splash?.(impact);
      return;
    }
    if (this.pos.y <= g) {
      const impact = -this.vel.y;
      if (this.mode === 'glide') this.events.glideClose?.();
      this.mode = 'ground';
      this.pos.y = g;
      this.vel.y = 0;
      this.squash = Math.min(0.55, impact / 38); this.squashV = 0;
      this.events.land?.(impact);
      if (this.jumpBuffer > 0 && impact < 30) {
        this.jumpBuffer = 0;
        this.toAir(JUMP_V);
        this.usedAirJump = true;
        this.events.jump?.();
      }
    }
  }

  // ---------------------------------------------------------------- Climb
  private updateClimb(dt: number, c: PlayerControls, cosY: number, sinY: number, world: WorldQuery) {
    const [gx, gz] = this.gradient(world, this.pos.x, this.pos.z);
    const slope = Math.hypot(gx, gz);
    if (slope < MANTLE_SLOPE) { this.mode = 'ground'; return; }
    const ux = gx / slope, uz = gz / slope;
    this.wallDir.set(ux, uz);
    this.climbSlope = slope;
    this.facing = Math.atan2(ux, uz);

    // Sideways along the contour, oriented to match the camera's right
    let cx = uz, cz = -ux;
    if (cx * cosY + cz * -sinY < 0) { cx = -cx; cz = -cz; }

    if (c.jump) {
      if (c.move.y < -0.5) {
        // Kick off the wall
        this.facing += Math.PI;
        this.toAir(7);
        this.vel.x = -ux * 6; this.vel.z = -uz * 6;
        this.events.jump?.();
        return;
      }
      if (this.leapT <= 0) {
        if (this.spend(COST_LEAP)) { this.leapT = 0.4; this.events.climbLeap?.(); }
      }
    }

    let up = c.move.y, side = c.move.x;
    if (this.leapT > 0) { this.leapT -= dt; up = 2.4; side *= 0.3; }
    const inten = Math.min(1, Math.hypot(up, side));
    if (this.leapT <= 0) {
      if (!this.spend((inten > 0.1 ? COST_CLIMB * inten : COST_HANG) * dt)) {
        // Exhausted: lose grip and fall
        this.toAir(0);
        this.vel.x = -ux * 2.5; this.vel.z = -uz * 2.5;
        return;
      }
    }

    const cs = CLIMB * dt;
    const upH = (up * cs) / Math.sqrt(1 + slope * slope);
    const sideH = side * cs;
    const oy = this.pos.y;
    const tx = this.pos.x + ux * upH + cx * sideH;
    const tz = this.pos.z + uz * upH + cz * sideH;
    const ty = world.ground(tx, tz, this.pos.y);
    this.pos.set(tx, ty, tz);
    this.climbAnim += dt * inten * 7;

    if (ty < SWIM_FLOOR) { this.mode = 'swim'; this.pos.y = SWIM_FLOOR; return; }

    // Reached a ledge / ridge top -> mantle up
    const [ngx, ngz] = this.gradient(world, tx, tz);
    const nslope = Math.hypot(ngx, ngz);
    const ridge = up > 0.1 && world.ground(tx + ux * 0.6, tz + uz * 0.6, ty) < ty + 0.05;
    if ((nslope < MANTLE_SLOPE || ridge) && up > 0.1) {
      this.mode = 'air';
      this.airTime = 0;
      this.usedAirJump = true;
      this.vel.set(ux * 3.5, 6, uz * 3.5);
      this.leapT = 0;
      this.events.mantle?.();
      return;
    }
    if (nslope < MANTLE_SLOPE && ty < oy) { this.mode = 'ground'; return; }
  }

  // ---------------------------------------------------------------- Visuals
  syncModel(mag: number, groundY: number, dt = 0.016) {
    const t = performance.now() / 1000;
    const climbing = this.mode === 'climb';
    const gliding = this.mode === 'glide';
    const swimming = this.mode === 'swim';
    const moving = mag > 0.05 && this.mode === 'ground';

    // Springs
    this.squashV += (-180 * this.squash - 13 * this.squashV) * dt;
    this.squash += this.squashV * dt;
    const gTarget = gliding ? 1 : 0;
    this.gliderV += ((gTarget - this.gliderS) * 160 - 16 * this.gliderV) * dt;
    this.gliderS = Math.max(0, this.gliderS + this.gliderV * dt);
    this.glider.visible = this.gliderS > 0.02;
    this.glider.scale.setScalar(Math.max(0.001, this.gliderS));

    // Bank into turns while gliding
    const turn = wrapAngle(this.facing - this.lastFacing) / Math.max(dt, 1e-3);
    const rollTarget = gliding ? Math.max(-0.6, Math.min(0.6, -turn * 0.35)) : 0;
    this.roll += (rollTarget - this.roll) * Math.min(1, dt * 5);

    this.model.position.copy(this.pos);
    if (climbing) {
      this.model.position.x -= this.wallDir.x * 0.32;
      this.model.position.z -= this.wallDir.y * 0.32;
    }
    if (swimming) this.model.position.y += 0.3 + Math.sin(t * 2.2) * 0.05;
    this.model.rotation.set(0, this.facing, this.roll);

    const sq = this.squash;
    this.body.scale.set(1 + sq * 0.35, 1 - sq * 0.5, 1 + sq * 0.35);

    let lean = 0, bodyY = 0;
    let aL = 0, aR = 0, aLz = 0, aRz = 0, fL = 0, fR = 0;
    if (moving) {
      const s = Math.sin(this.bob);
      bodyY = Math.abs(s) * (this.sprinting ? 0.16 : 0.12);
      lean = (this.sprinting ? 0.28 : 0.12) * mag;
      const sw = (this.sprinting ? 1.25 : 0.85) * mag;
      aL = s * sw; aR = -s * sw;
      fL = -s * 0.22 * mag; fR = s * 0.22 * mag;
    } else if (climbing) {
      // Lie parallel to the rock face
      lean = Math.max(0.1, Math.min(1.1, Math.PI / 2 - Math.atan(this.climbSlope)));
      const s = Math.sin(this.climbAnim);
      aL = -2.6 + s * 0.5; aR = -2.6 - s * 0.5;
      fL = s * 0.15; fR = -s * 0.15;
    } else if (gliding) {
      aL = -2.9; aR = -2.9; aLz = 0.25; aRz = -0.25;
      lean = this.diving ? 0.9 : 0.18;
    } else if (swimming) {
      const s = Math.sin(this.bob);
      lean = 0.75 * Math.max(0.3, mag);
      aL = -1.6 + s * 1.2; aR = -1.6 - s * 1.2;
    } else if (this.mode === 'air') {
      aL = -0.9; aR = -0.9; aLz = 0.5; aRz = -0.5;
      fL = 0.2; fR = -0.2;
      lean = this.vel.y > 0 ? -0.05 : 0.08;
    } else if (this.exhausted) {
      const pant = Math.sin(t * 5.8);
      lean = 0.28 + pant * 0.05;
      bodyY = -0.04 + pant * 0.025;
      aL = 0.22 + pant * 0.08; aR = 0.22 + pant * 0.08;
      aLz = 0.14; aRz = -0.14;
    } else {
      const br = Math.sin(t * 1.8) * 0.04;
      aL = br; aR = -br; aLz = 0.08; aRz = -0.08;
    }
    const k = Math.min(1, dt * 14);
    this.body.position.y += (bodyY - this.body.position.y) * k;
    this.body.rotation.x += (lean - this.body.rotation.x) * k;
    this.armL.rotation.x += (aL - this.armL.rotation.x) * k;
    this.armR.rotation.x += (aR - this.armR.rotation.x) * k;
    this.armL.rotation.z += (aLz - this.armL.rotation.z) * k;
    this.armR.rotation.z += (aRz - this.armR.rotation.z) * k;
    this.footL.position.z += (fL - this.footL.position.z) * k;
    this.footR.position.z += (fR - this.footR.position.z) * k;

    // Scarf flutters with speed
    const sp = this.speedXZ + Math.abs(this.vel.y) * 0.5;
    this.tail.rotation.x = 0.35 + Math.min(1.25, sp * 0.08) + Math.sin(t * (6 + sp)) * Math.min(0.25, sp * 0.02);

    this.shadow.position.set(this.pos.x, Math.max(groundY, WATER_LEVEL) + 0.06, this.pos.z);
    const h = Math.max(0, this.pos.y - groundY);
    this.shadow.scale.setScalar(Math.max(0.3, 1 - h * 0.03));
    this.shadow.visible = !swimming && !climbing;
  }
}
