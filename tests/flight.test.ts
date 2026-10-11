import { beforeAll, describe, expect, it } from 'vitest';
import { BALL_RADIUS, PENALTY_SPOT_Z } from '../src/constants';
import { aeroAcceleration } from '../src/shooting/aero';
import { predictCrossing, solveLaunch } from '../src/shooting/trajectory';
import { createPitch, fire, type Pitch } from './helpers';

let pitch: Pitch;
beforeAll(async () => {
  pitch = await createPitch();
  // Keep the keeper out of the way: these shots go wide of the middle and they stand still.
});

describe('Launch solver', () => {
  it.each([
    [2.0, 1.0, 0.5],
    [-3.0, 2.0, 0.7],
    [2.5, 0.3, 0.2],
    [-2.5, 1.5, 0.95],
  ])('hits (%s, %s) at power %s to within a centimetre', (x, y, power) => {
    const { crossing } = fire(pitch, { x, y }, { power, exact: true });
    expect(crossing).not.toBeNull();
    expect(Math.hypot(crossing!.x - x, crossing!.y - y)).toBeLessThan(0.01);
  });

  it.each([
    ['right side', { x: 0.8, y: 0 }],
    ['left side', { x: -0.8, y: 0 }],
    ['underneath', { x: 0, y: -0.8 }],
  ])('still lands on target with spin struck from the %s', (_, contact) => {
    const { crossing } = fire(pitch, { x: 2.4, y: 1.3 }, { power: 0.7, contact, exact: true });
    expect(Math.hypot(crossing!.x - 2.4, crossing!.y - 1.3)).toBeLessThan(0.01);
  });
});

describe('Curve and drag', () => {
  it('striking the right side of the ball bends it left (and vice versa)', () => {
    // Same landing point: the curling shot must set off the other way of where it bends.
    const right = fire(pitch, { x: 2.4, y: 1.3 }, { power: 0.7, contact: { x: 0.8, y: 0 }, exact: true });
    const left = fire(pitch, { x: 2.4, y: 1.3 }, { power: 0.7, contact: { x: -0.8, y: 0 }, exact: true });
    expect(right.apparentTarget.x - 2.4).toBeGreaterThan(0.4); // set off right, bent left
    expect(left.apparentTarget.x - 2.4).toBeLessThan(-0.4); // set off left, bent right
  });

  it('backspin holds the ball up, topspin makes it dip', () => {
    const back = fire(pitch, { x: 2.4, y: 1.3 }, { power: 0.7, contact: { x: 0, y: -0.8 }, exact: true });
    const top = fire(pitch, { x: 2.4, y: 1.3 }, { power: 0.7, contact: { x: 0, y: 0.8 }, exact: true });
    expect(back.apparentTarget.y).toBeLessThan(1.3 - 0.2); // would land lower without the lift
    expect(top.apparentTarget.y).toBeGreaterThan(1.3 + 0.2); // would land higher without the dip
  });

  it('drag slows the ball through the air', () => {
    const from = { x: 0, y: BALL_RADIUS, z: PENALTY_SPOT_Z };
    const { velocity } = solveLaunch(from, { x: 0, y: 1.2, z: 0 }, 25);
    const a = aeroAcceleration(velocity, { x: 0, y: 0, z: 0 });
    // Drag points against the motion (the ball travels towards −z).
    expect(a.z).toBeGreaterThan(5);
    expect(predictCrossing(from, velocity)!.t).toBeGreaterThan(11 / 25);
  });
});
