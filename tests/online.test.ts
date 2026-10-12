import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { PHYSICS_STEP } from '../src/constants';
import type { PointerInput } from '../src/input/pointer';
import type { SpinKeys } from '../src/input/spinKeys';
import { Kick, type Shot } from '../src/match/kick';
import { Net } from '../src/net';
import { decodeFrame, encodeFrame } from '../src/online/frames';
import { introduce } from '../src/online/guest';
import { greetGuest, OnlineHost } from '../src/online/host';
import { parseGuestMessage, parseHostMessage, PROTOCOL } from '../src/online/protocol';
import { createPhysics, type Physics } from '../src/physics';
import { Recorder, STRIDE } from '../src/replay/recorder';
import { speedForPower } from '../src/shooting/power';
import { memoryLinks } from './helpers';

/** A ball and two "kickers" (a joint each), one hidden, like the real scene. */
function scene() {
  const ball = new THREE.Object3D();
  const kickers = new THREE.Group();
  const figure = (x: number) => {
    const root = new THREE.Group();
    const arm = new THREE.Group();
    arm.position.set(0.2, 1.4, 0);
    arm.quaternion.setFromEuler(new THREE.Euler(0.3, -0.7, 1.1));
    root.add(arm);
    root.position.set(x, 0, 11.4);
    kickers.add(root);
    return { root, arm };
  };
  const shooter = figure(-0.14);
  const waiting = figure(-1.5);
  waiting.root.visible = false;
  const recorder = new Recorder([ball, kickers], new Net());
  return { ball, shooter, waiting, recorder };
}

describe('Online frames', () => {
  it('round-trip transforms to within 2 mm, leaving hidden objects out', () => {
    const { ball, shooter, waiting, recorder } = scene();
    ball.position.set(-3.1, 2.05, 0.4);
    ball.quaternion.setFromEuler(new THREE.Euler(1, 2, 3));
    const before = recorder.snapshot();
    const shown = recorder.shown();
    expect(shown.filter(Boolean).length).toBeLessThan(recorder.size);

    const decoded = decodeFrame(encodeFrame(before, shown), recorder.size, null)!;
    const objects = recorder.size;
    for (let i = 0; i < objects; i++) {
      const k = i * STRIDE;
      expect(decoded[k + 7]).toBe(before[k + 7]); // visibility always goes across
      if (!shown[i]) continue;
      for (let c = 0; c < 3; c++) expect(Math.abs(decoded[k + c] - before[k + c])).toBeLessThan(0.002);
      for (let c = 3; c < 7; c++) expect(Math.abs(decoded[k + c] - before[k + c])).toBeLessThan(0.001);
    }

    // The next frame: the hidden kicker's joints keep the values they last had.
    shooter.arm.position.y = 1.2;
    waiting.arm.position.y = 9; // not sent while hidden
    const next = decodeFrame(encodeFrame(recorder.snapshot(), recorder.shown()), objects, decoded)!;
    for (let i = 0; i < objects; i++) {
      if (!shown[i]) for (let c = 0; c < 7; c++) expect(next[i * STRIDE + c]).toBe(decoded[i * STRIDE + c]);
    }
    recorder.apply({ frames: [{ t: 0, data: next, ripples: [] }], start: 0, end: 0, side: 1, caption: '' }, 0);
    expect(shooter.arm.position.y).toBeCloseTo(1.2, 2);
    expect(waiting.arm.position.y).not.toBeCloseTo(9, 1);
    expect(waiting.root.visible).toBe(false);
  });

  it('rejects a truncated frame', () => {
    const { recorder } = scene();
    const buffer = encodeFrame(recorder.snapshot(), recorder.shown());
    expect(decodeFrame(buffer.slice(0, buffer.byteLength - 4), recorder.size, null)).toBeNull();
  });
});

describe('Online messages', () => {
  it('only lets through messages of the right shape', () => {
    expect(parseGuestMessage({ type: 'dive', x: 1, y: 0.5 })).toEqual({ type: 'dive', x: 1, y: 0.5 });
    expect(parseGuestMessage({ type: 'dive', x: 'left', y: 0.5 })).toBeNull();
    expect(parseGuestMessage({ type: 'release', power: NaN, aim: { x: 0, y: 1 }, contact: { x: 0, y: 0 } })).toBeNull();
    expect(parseGuestMessage({ type: 'teleport' })).toBeNull();
    expect(parseGuestMessage('press')).toBeNull();
    expect(parseHostMessage({ type: 'frame', t: 1, nodes: 'oops', ripples: [], camera: [], state: {} })).toBeNull();
  });

  it('a guest says hello and is welcomed with both teams', async () => {
    const { a: host, b: guest, flush } = memoryLinks();
    const greeted = greetGuest(host, 42);
    const welcomed = introduce(guest, 'Glasswater', 42);
    flush();
    expect(await greeted).toBe('Glasswater');
    host.send({ type: 'welcome', teams: { player: 'Harbour Town', cpu: 'Glasswater' } });
    flush();
    expect(await welcomed).toEqual({ player: 'Harbour Town', cpu: 'Glasswater' });
  });

  it('a guest on another version is turned away, and told why', async () => {
    const { a: host, b: guest, flush } = memoryLinks();
    const greeted = greetGuest(host, 42);
    const welcomed = introduce(guest, 'Glasswater', 41); // a different scene: frames wouldn't line up
    flush(); // hello
    await expect(greeted).rejects.toThrow(/different version/);
    flush(); // the rejection
    await expect(welcomed).rejects.toThrow(/different version/);
    expect(PROTOCOL).toBeGreaterThan(0);
  });
});

describe('Online host', () => {
  let physics: Physics;
  beforeAll(async () => {
    physics = await createPhysics();
  });

  it("takes the guest's kick with the power they reached on their own meter", () => {
    const { a: guest, b: hostEnd, flush } = memoryLinks();
    const { recorder } = scene();
    const host = new OnlineHost(hostEnd, recorder, new Net());
    const camera = new THREE.PerspectiveCamera();
    const idle = { consume: () => ({ x: 0, y: 0 }) } as unknown as SpinKeys;
    const pointer = { ndc: new THREE.Vector2(), consumePress: () => false, consumeRelease: () => false, consumeCancel: () => false };
    const kick = new Kick(physics.ball, pointer as unknown as PointerInput, camera, idle);
    const shots: Shot[] = [];
    kick.events = { onShot: (s) => shots.push(s) };

    kick.start('cpu', true, host.shooter);
    guest.send({ type: 'press' });
    flush();
    kick.step(PHYSICS_STEP);
    expect(kick.state.kind).toBe('charging');
    // Held only a moment here (the network was slow), but the guest's meter said 0.9.
    guest.send({ type: 'release', power: 0.9, aim: { x: 2.5, y: 1.2 }, contact: { x: 0.4, y: 0 } });
    flush();
    for (let i = 0; i < 60 && shots.length === 0; i++) kick.step(PHYSICS_STEP);
    expect(shots).toHaveLength(1);
    expect(shots[0].launchSpeed).toBeGreaterThan(speedForPower(0.8));
    expect(shots[0].target.x).toBeGreaterThan(1);

    guest.send({ type: 'dive', x: -3, y: 1.9 });
    flush();
    expect(host.consumeDive()).toEqual({ x: -3, y: 1.9 });
    expect(host.consumeDive()).toBeNull();
  });
});
