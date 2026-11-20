import * as THREE from 'three';
import { HALF, WATER_LEVEL } from './terrain';

export interface WorldQuery {
  ground(x: number, z: number, y: number): number;
  collide(p: THREE.Vector3): void;
}

const GRAVITY = 28;
const JUMP_V = 10;
const RUN = 9;
const SWIM = 4;
const MAX_CLIMB_RATIO = 1.35; // rise/run above this blocks walking (cliffs)

export class Player {
  readonly pos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  readonly model = new THREE.Group();
  readonly shadow: THREE.Mesh;
  grounded = false;
  swimming = false;
  facing = 0;
  private body: THREE.Group;
  private bob = 0;

  constructor() {
    const cloak = new THREE.MeshLambertMaterial({ color: '#2f6fa3', flatShading: true });
    const skin = new THREE.MeshLambertMaterial({ color: '#f1c9a5', flatShading: true });
    const hair = new THREE.MeshLambertMaterial({ color: '#3b2a1e', flatShading: true });
    const scarf = new THREE.MeshLambertMaterial({ color: '#e0663d', flatShading: true });
    const eye = new THREE.MeshBasicMaterial({ color: '#1b1b1b' });

    this.body = new THREE.Group();
    const torso = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.25, 6), cloak);
    torso.position.y = 0.72;
    const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.33, 0), skin);
    head.position.y = 1.55;
    const hairM = new THREE.Mesh(new THREE.IcosahedronGeometry(0.35, 0), hair);
    hairM.position.set(0, 1.63, -0.06);
    hairM.scale.set(1, 0.8, 1);
    const sc = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.38, 0.18, 6), scarf);
    sc.position.y = 1.25;
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.5, 0.06), scarf);
    tail.position.set(0.12, 1.0, -0.32);
    tail.rotation.x = 0.35;
    const e1 = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.02), eye);
    e1.position.set(0.11, 1.57, 0.31);
    const e2 = e1.clone(); e2.position.x = -0.11;
    this.body.add(torso, head, hairM, sc, tail, e1, e2);
    this.model.add(this.body);

    const cv = document.createElement('canvas');
    cv.width = cv.height = 64;
    const ctx = cv.getContext('2d')!;
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(0,0,0,0.45)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
    this.shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1.8, 1.8).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
    );
  }

  update(dt: number, move: { x: number; y: number }, jump: boolean, camYaw: number, world: WorldQuery) {
    const sinY = Math.sin(camYaw), cosY = Math.cos(camYaw);
    const dx = -sinY * move.y + cosY * move.x;
    const dz = -cosY * move.y - sinY * move.x;
    const mag = Math.min(1, Math.hypot(dx, dz));

    if (mag > 0.05) {
      let speed = (this.swimming ? SWIM : RUN) * mag;
      const nx = dx / mag, nz = dz / mag;
      const stepLen = speed * dt;
      // Slope check: cliffs block, gentle slopes just slow you down.
      const tryMove = (mx: number, mz: number): boolean => {
        const tx = this.pos.x + mx * stepLen, tz = this.pos.z + mz * stepLen;
        const g = world.ground(tx, tz, this.pos.y);
        const rise = g - this.pos.y;
        if (this.grounded && !this.swimming && rise / Math.max(stepLen, 1e-4) > MAX_CLIMB_RATIO && rise > 0.05) return false;
        if (rise > 0 && this.grounded) {
          const slow = 1 - Math.min(0.55, (rise / stepLen) * 0.4);
          this.pos.x += mx * stepLen * slow; this.pos.z += mz * stepLen * slow;
        } else { this.pos.x = tx; this.pos.z = tz; }
        return true;
      };
      if (!tryMove(nx, nz)) {
        // Slide along the cliff on whichever axis works.
        if (!tryMove(nx, 0)) tryMove(0, nz);
      }
      const target = Math.atan2(nx, nz);
      let diff = target - this.facing;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      this.facing += diff * Math.min(1, dt * 12);
      this.bob += dt * speed * 1.6;
    }

    world.collide(this.pos);
    const r = Math.hypot(this.pos.x, this.pos.z);
    const maxR = HALF - 12;
    if (r > maxR) { this.pos.x *= maxR / r; this.pos.z *= maxR / r; }

    if (jump && (this.grounded || this.swimming)) { this.vel.y = JUMP_V; this.grounded = false; }
    this.vel.y -= GRAVITY * dt;
    this.pos.y += this.vel.y * dt;

    const g = world.ground(this.pos.x, this.pos.z, this.pos.y);
    const swimFloor = WATER_LEVEL - 1.1;
    this.swimming = g < swimFloor;
    const floor = Math.max(g, this.swimming ? swimFloor : -Infinity);
    if (this.pos.y <= floor || (this.grounded && this.vel.y <= 0 && this.pos.y - floor < 0.7)) {
      this.pos.y = floor; this.vel.y = 0; this.grounded = true;
    } else this.grounded = false;

    this.syncModel(mag, g);
  }

  syncModel(mag: number, groundY: number) {
    this.model.position.copy(this.pos);
    this.model.rotation.y = this.facing;
    const moving = mag > 0.05 && this.grounded;
    this.body.position.y = moving ? Math.abs(Math.sin(this.bob)) * 0.12 : 0;
    this.body.rotation.x = moving ? 0.12 * mag : 0;
    this.shadow.position.set(this.pos.x, Math.max(groundY, WATER_LEVEL) + 0.06, this.pos.z);
    const h = Math.max(0, this.pos.y - groundY);
    this.shadow.scale.setScalar(Math.max(0.3, 1 - h * 0.05));
    this.shadow.visible = !this.swimming;
  }
}
