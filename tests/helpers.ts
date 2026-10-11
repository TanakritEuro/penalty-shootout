// Headless game pieces for tests: a real Rapier world, ball and keeper, and a `fire()`
// that strikes a shot the same way the Kick does (shot error, spin, launch solver, aero),
// then steps physics until the ShotTracker calls the outcome.

import type { KeeperLevelName } from '../src/config';
import { BALL_RADIUS, PENALTY_SPOT_Z, PHYSICS_STEP } from '../src/constants';
import { Keeper } from '../src/keeper/keeper';
import { createPhysics, type Physics } from '../src/physics';
import { applyAero } from '../src/shooting/aero';
import { ShotTracker, type ShotOutcome } from '../src/shooting/outcome';
import { applyShotError, speedForPower } from '../src/shooting/power';
import { CENTRE, contactScatter, contactSpeedFactor, spinFromContact, type Contact } from '../src/shooting/spin';
import { predictCrossing, solveLaunch, type Vec3 } from '../src/shooting/trajectory';

export interface Pitch extends Physics {
  keeper: Keeper;
}

export async function createPitch(): Promise<Pitch> {
  const physics = await createPhysics();
  return { ...physics, keeper: new Keeper(physics.world, physics.tags) };
}

export interface FireOptions {
  power: number;
  contact?: Contact;
  /** Skip the random shot error: the ball goes exactly where aimed. */
  exact?: boolean;
  /** AI keeper level; omit to have the keeper stand still on the line. */
  level?: KeeperLevelName;
  /** Player's keeper instead: dive to (x, y) at `at` seconds relative to the strike. */
  playerDive?: { x: number; y: number; at: number };
}

export interface FireResult {
  outcome: ShotOutcome;
  target: { x: number; y: number };
  apparentTarget: { x: number; y: number };
  /** Where the ball actually crossed z = 0, if it got there untouched. */
  crossing: { x: number; y: number } | null;
}

/** Strike one penalty at `aim` and play it out. */
export function fire(pitch: Pitch, aim: { x: number; y: number }, options: FireOptions): FireResult {
  const { world, ball, events, tags, keeper } = pitch;
  const contact = options.contact ?? CENTRE;
  keeper.reset();
  keeper.controlledByPlayer = options.playerDive !== undefined;
  if (options.level) keeper.level = options.level;
  ball.setTranslation({ x: 0, y: BALL_RADIUS, z: PENALTY_SPOT_Z }, true);
  ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
  ball.setAngvel({ x: 0, y: 0, z: 0 }, true);

  const from = ball.translation();
  const target = options.exact ? aim : applyShotError(aim, options.power, contactScatter(contact));
  const spin = spinFromContact(contact, options.power);
  const { velocity, flightTime } = solveLaunch(
    from,
    { x: target.x, y: target.y, z: 0 },
    speedForPower(options.power) * contactSpeedFactor(contact),
    spin,
  );
  const apparent = predictCrossing(from, velocity) ?? { ...target, t: 0 };
  const shot = { target, apparentTarget: { x: apparent.x, y: apparent.y }, flightTime, launchSpeed: 0 };

  const tracker = new ShotTracker();
  let crossing: { x: number; y: number } | null = null;
  let touched = false;
  let time = Math.min(0, options.playerDive?.at ?? 0);
  let struck = false;
  let dived = false;
  for (let i = 0; i < 1200; i++) {
    if (options.playerDive && !dived && time >= options.playerDive.at) {
      keeper.playerDive(options.playerDive.x, options.playerDive.y);
      dived = true;
    }
    if (!struck && time >= 0) {
      ball.setLinvel(velocity, true);
      ball.setAngvel(spin, true);
      if (options.level || options.playerDive) keeper.react(shot);
      struck = true;
    }
    keeper.step(PHYSICS_STEP);
    if (struck) applyAero(ball);
    const before: Vec3 = { ...ball.translation() };
    world.step(events);
    events.drainCollisionEvents((h1, h2, started) => {
      if (!started || !struck) return;
      const tag = tags.get(h1) ?? tags.get(h2);
      if (!tag) return;
      if (tag !== 'ground') touched = true;
      tracker.onContact(tag);
    });
    time += PHYSICS_STEP;
    if (!struck) continue;
    const p = ball.translation();
    if (!crossing && !touched && before.z > 0 && p.z <= 0) {
      const f = before.z / (before.z - p.z);
      crossing = { x: before.x + (p.x - before.x) * f, y: before.y + (p.y - before.y) * f };
    }
    const outcome = tracker.update(PHYSICS_STEP, p, ball.linvel());
    if (outcome) return { outcome, target, apparentTarget: shot.apparentTarget, crossing };
  }
  throw new Error('Shot never finished');
}

/**
 * A small seeded random generator (mulberry32), to swap in for Math.random so the
 * statistical tests give the same answer every run.
 */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
