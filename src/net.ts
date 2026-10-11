import * as THREE from 'three';
import { TUNING } from './config';
import { GOAL_DEPTH, GOAL_HEIGHT, GOAL_WIDTH, POST_RADIUS } from './constants';
import type { Vec3 } from './shooting/trajectory';

interface Panel {
  geometry: THREE.PlaneGeometry;
  /** Rest positions in the panel's local space, and the same points in world space. */
  rest: Float32Array;
  world: Float32Array;
  /** +1 if the panel's local +z points out of the goal, −1 if it points in. */
  outward: number;
}

export interface Ripple {
  x: number;
  y: number;
  z: number;
  strength: number;
  age: number;
}

/**
 * The goal net, drawn as wireframe panels (back, roof, two sides) that bulge out where the
 * ball hits and ripple outwards from there. Visual only: the physics net is rigid.
 */
export class Net {
  readonly object = new THREE.Group();
  private readonly panels: Panel[] = [];
  private ripples: Ripple[] = [];

  constructor() {
    const material = new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.35 });
    const halfW = GOAL_WIDTH / 2 + POST_RADIUS;
    const topY = GOAL_HEIGHT + POST_RADIUS;

    // Each panel: size, segments, position, rotation, and which world direction is "out".
    const add = (w: number, h: number, sx: number, sy: number, pos: THREE.Vector3, rot: THREE.Euler, out: THREE.Vector3) => {
      const geometry = new THREE.PlaneGeometry(w, h, sx, sy);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.copy(pos);
      mesh.rotation.copy(rot);
      mesh.updateMatrixWorld();
      this.object.add(mesh);

      const rest = Float32Array.from(geometry.attributes.position.array);
      const world = new Float32Array(rest.length);
      const v = new THREE.Vector3();
      for (let i = 0; i < rest.length; i += 3) {
        v.set(rest[i], rest[i + 1], rest[i + 2]).applyMatrix4(mesh.matrixWorld);
        world.set([v.x, v.y, v.z], i);
      }
      const localNormal = new THREE.Vector3(0, 0, 1).applyQuaternion(mesh.quaternion);
      this.panels.push({ geometry, rest, world, outward: Math.sign(localNormal.dot(out)) || 1 });
    };

    add(halfW * 2, topY, 36, 12, new THREE.Vector3(0, topY / 2, -GOAL_DEPTH), new THREE.Euler(), new THREE.Vector3(0, 0, -1));
    add(halfW * 2, GOAL_DEPTH, 36, 10, new THREE.Vector3(0, topY, -GOAL_DEPTH / 2), new THREE.Euler(Math.PI / 2, 0, 0), new THREE.Vector3(0, 1, 0));
    for (const side of [-1, 1]) {
      add(GOAL_DEPTH, topY, 10, 12, new THREE.Vector3(side * halfW, topY / 2, -GOAL_DEPTH / 2), new THREE.Euler(0, Math.PI / 2, 0), new THREE.Vector3(side, 0, 0));
    }
  }

  /** The ball hit the net at `point` (world) at `speed` m/s. */
  hit(point: Vec3, speed: number): void {
    const R = TUNING.net;
    const strength = Math.min(R.maxStrength, speed / R.referenceSpeed);
    if (strength < 0.05) return;
    this.ripples.push({ x: point.x, y: point.y, z: point.z, strength, age: 0 });
  }

  /** Advance the ripples by `dt` game seconds and reshape the net. */
  /** A copy of the current ripples, for replays. */
  snapshot(): Ripple[] {
    return this.ripples.map((r) => ({ ...r }));
  }

  /** Put back ripples from `snapshot()` and reshape the net to match. */
  restore(ripples: Ripple[]): void {
    this.ripples = ripples.map((r) => ({ ...r }));
    this.apply();
  }

  step(dt: number): void {
    if (this.ripples.length === 0) return;
    const R = TUNING.net;
    for (const r of this.ripples) r.age += dt;
    this.ripples = this.ripples.filter((r) => r.age < R.decay * 5);
    this.apply();
  }

  private apply(): void {
    const R = TUNING.net;
    for (const p of this.panels) {
      const pos = p.geometry.attributes.position as THREE.BufferAttribute;
      const arr = pos.array as Float32Array;
      for (let i = 0; i < arr.length; i += 3) {
        let d = 0;
        for (const r of this.ripples) {
          const dist = Math.hypot(p.world[i] - r.x, p.world[i + 1] - r.y, p.world[i + 2] - r.z);
          const envelope = r.strength * Math.exp(-r.age / R.decay) * Math.exp(-((dist / R.spread) ** 2));
          // A bulge where the ball went in, plus a wave running outwards from it.
          d += envelope * R.amplitude * (R.bulge + Math.cos(R.frequency * r.age - R.wavenumber * dist));
        }
        arr[i + 2] = p.rest[i + 2] + p.outward * d;
      }
      pos.needsUpdate = true;
    }
  }
}
