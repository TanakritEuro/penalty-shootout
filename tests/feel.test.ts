import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Director } from '../src/camera/director';
import { TUNING } from '../src/config';
import { PHYSICS_STEP } from '../src/constants';
import type { Keeper } from '../src/keeper/keeper';
import { BallTrail } from '../src/trail';

const noKeeper = { distanceTo: () => Infinity } as unknown as Keeper;
const ball = { x: 0, y: 0.11, z: 11 };

function camera(): THREE.PerspectiveCamera {
  const c = new THREE.PerspectiveCamera(36, 16 / 9, 0.1, 300);
  c.position.set(0, 2.6, 16.5);
  c.lookAt(0, -1.2, 0);
  return c;
}

describe('Director', () => {
  it('shakes the camera on woodwork and settles back exactly where it was', () => {
    const cam = camera();
    const director = new Director(cam);
    director.reset();
    const rest = cam.quaternion.clone();
    director.shake(25);
    let moved = 0;
    for (let i = 0; i < 120; i++) {
      director.update(1 / 60, ball, false, noKeeper);
      moved = Math.max(moved, cam.quaternion.angleTo(rest));
    }
    expect(moved).toBeGreaterThan(TUNING.director.shake.angle * 0.3);
    expect(cam.quaternion.angleTo(rest)).toBeLessThan(1e-6);
  });

  it('cuts to the scorer after a goal and back to the main camera for the next kick', () => {
    const cam = camera();
    const director = new Director(cam);
    director.reset();
    const main = cam.position.clone();
    const scorer = { x: -0.1, y: 0, z: 10.8 };
    director.celebrate(scorer);
    // In front of them (between them and the goal), looking back at them.
    expect(cam.position.z).toBeLessThan(scorer.z);
    const facing = new THREE.Vector3();
    cam.getWorldDirection(facing);
    expect(facing.z).toBeGreaterThan(0.8);
    // It pushes in.
    const before = cam.position.distanceTo(new THREE.Vector3(scorer.x, 1, scorer.z));
    for (let i = 0; i < 120; i++) director.update(1 / 60, ball, false, noKeeper);
    expect(cam.position.distanceTo(new THREE.Vector3(scorer.x, 1, scorer.z))).toBeLessThan(before - 0.5);
    director.reset();
    expect(cam.position.distanceTo(main)).toBeLessThan(1e-9);
  });
});

describe('BallTrail', () => {
  const eye = new THREE.Vector3(0, 2.6, 16.5);
  const drawn = (t: BallTrail) => t.object.geometry.drawRange.count;

  /** Fly the ball down the pitch at `speed`, rendering `framesPerStep` frames per physics step. */
  function fly(speed: number, framesPerStep: number): BallTrail {
    const trail = new BallTrail();
    const p = new THREE.Vector3(0, 0.5, 11);
    for (let step = 0; step < 12; step++) {
      p.z -= speed * PHYSICS_STEP;
      for (let f = 0; f < framesPerStep; f++) trail.update(p, PHYSICS_STEP / framesPerStep, eye);
    }
    return trail;
  }

  it('shows behind a hard shot, even in slow motion when frames outnumber physics steps', () => {
    expect(drawn(fly(29, 1))).toBeGreaterThan(0);
    expect(drawn(fly(29, 4))).toBeGreaterThan(0);
  });

  it("doesn't show behind a soft shot", () => {
    expect(drawn(fly(15, 1))).toBe(0);
    expect(drawn(fly(15, 4))).toBe(0);
  });

  it('starts afresh when the ball is put back on the spot', () => {
    const trail = fly(29, 1);
    trail.update(new THREE.Vector3(0, 0.11, 11), PHYSICS_STEP, eye);
    expect(drawn(trail)).toBe(0);
  });
});
