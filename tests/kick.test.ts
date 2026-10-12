import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { TUNING } from '../src/config';
import { PHYSICS_STEP } from '../src/constants';
import type { PointerInput } from '../src/input/pointer';
import type { SpinKeys } from '../src/input/spinKeys';
import { Kick, type Shot } from '../src/match/kick';
import { createPhysics, type Physics } from '../src/physics';
import { applyAero } from '../src/shooting/aero';
import type { ShotOutcome } from '../src/shooting/outcome';

/** Scripted stand-in for the mouse: press/release flags the Kick consumes, like the real one. */
class FakePointer {
  readonly ndc = new THREE.Vector2(0.2, 0.1);
  pressed = false;
  released = false;
  cancelled = false;
  consumePress() {
    const p = this.pressed;
    this.pressed = false;
    return p;
  }
  consumeRelease() {
    const r = this.released;
    this.released = false;
    return r;
  }
  consumeCancel() {
    const c = this.cancelled;
    this.cancelled = false;
    return c;
  }
}

let physics: Physics;
beforeAll(async () => {
  physics = await createPhysics();
});

function setup() {
  const pointer = new FakePointer();
  const camera = new THREE.PerspectiveCamera(36, 16 / 9, 0.1, 300);
  camera.position.set(0, 2.6, 16.5);
  camera.lookAt(0, -1.2, 0);
  camera.updateMatrixWorld();
  const spin = { consume: () => ({ x: 0, y: 0 }) };
  const kick = new Kick(physics.ball, pointer as unknown as PointerInput, camera, spin as unknown as SpinKeys);
  const log: string[] = [];
  const shots: Shot[] = [];
  const outcomes: ShotOutcome[] = [];
  kick.events = {
    onShot: (s) => {
      log.push('shot');
      shots.push(s);
    },
    onResult: (o) => {
      log.push('result');
      outcomes.push(o);
    },
    onDone: () => log.push('done'),
  };
  /** Step the kick (and, once the ball is moving, the physics) for `seconds`. */
  const run = (seconds: number) => {
    for (let t = 0; t < seconds; t += PHYSICS_STEP) {
      applyAero(physics.ball);
      physics.world.step(physics.events);
      physics.events.drainCollisionEvents((h1, h2, started) => {
        const tag = physics.tags.get(h1) ?? physics.tags.get(h2);
        if (started && tag) kick.onBallContact(tag);
      });
      kick.step(PHYSICS_STEP);
    }
  };
  return { kick, pointer, log, shots, outcomes, run };
}

describe('Kick: the player', () => {
  it('goes aiming → charging → striking → in flight → result → next kick, firing events in order', () => {
    const { kick, pointer, log, shots, run } = setup();
    kick.start('player');
    expect(kick.state.kind).toBe('aiming');
    expect(kick.approach).toBe(0);

    pointer.pressed = true;
    run(PHYSICS_STEP);
    expect(kick.state.kind).toBe('charging');
    run(0.6);
    expect(kick.power).toBeGreaterThan(0.4);
    expect(kick.approach).toBeGreaterThan(0);

    pointer.released = true;
    run(PHYSICS_STEP);
    expect(kick.state.kind).toBe('striking');
    expect(kick.sinceStrike).toBeNull();

    run(TUNING.kicker.maxStrikeTime + 0.05);
    expect(kick.state.kind).toBe('ballInFlight');
    expect(kick.approach).toBe(1);
    expect(shots[0].launchSpeed).toBeGreaterThan(15);

    run(3);
    expect(['result', 'nextKick']).toContain(kick.state.kind);
    run(TUNING.outcome.resultDuration + 0.1);
    expect(kick.state.kind).toBe('nextKick');
    expect(log).toEqual(['shot', 'result', 'done']);
  });

  it('a tap (press and release in the same step) still shoots, weakly', () => {
    const { kick, pointer, run, shots } = setup();
    kick.start('player');
    pointer.pressed = true;
    pointer.released = true;
    run(PHYSICS_STEP * 2);
    expect(kick.state.kind).toBe('striking');
    run(TUNING.kicker.maxStrikeTime + 0.05);
    expect(shots).toHaveLength(1);
    expect(shots[0].launchSpeed).toBeLessThan(15);
  });

  it('losing the pointer while charging goes back to aiming', () => {
    const { kick, pointer, run } = setup();
    kick.start('player');
    pointer.pressed = true;
    run(0.3);
    pointer.cancelled = true;
    run(PHYSICS_STEP);
    expect(kick.state.kind).toBe('aiming');
  });
});

describe('Kick: the CPU', () => {
  it('runs up and strikes when the run-up is complete', () => {
    const { kick, run, shots } = setup();
    kick.start('cpu', false);
    expect(kick.state.kind).toBe('cpuRunUp');
    run(TUNING.cpuKicker.runUpTime * 0.5);
    expect(kick.runUp).toBeCloseTo(0.5, 1);
    expect(kick.tell === 1 || kick.tell === -1).toBe(true);
    run(TUNING.cpuKicker.runUpTime * 0.5 + 0.05);
    expect(shots).toHaveLength(1);
  });

  it('changes its shot if the keeper goes early, but not in the last moment', () => {
    const { kick, run } = setup();
    kick.start('cpu', false);
    run(0.1);
    expect(kick.keeperCommitted(2.5)).toBe(true);
    const early = kick.state;
    expect(early.kind === 'cpuRunUp' && early.shot.aim.x < 0).toBe(true);

    kick.start('cpu', false);
    run(TUNING.cpuKicker.runUpTime - TUNING.playerKeeper.earlyCommitWindow / 2);
    expect(kick.keeperCommitted(2.5)).toBe(false);
  });

  it('a human can take the CPU side’s kick (two players)', () => {
    const { kick } = setup();
    kick.start('cpu', true);
    expect(kick.state.kind).toBe('aiming');
  });
});
