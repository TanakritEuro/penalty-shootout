import RAPIER from '@dimforge/rapier3d-compat';
import { GRAVITY, PHYSICS_STEP } from '../constants';
import { createBall } from '../physics';
import { applyAero } from './aero';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Launch {
  velocity: Vec3;
  /** Seconds until the ball reaches the target. */
  flightTime: number;
}

export interface Crossing {
  /** Where the ball crosses the plane z = `planeZ`. */
  x: number;
  y: number;
  /** Seconds after launch. */
  t: number;
}

const NO_SPIN: Vec3 = { x: 0, y: 0, z: 0 };
const MAX_FLIGHT = 3; // s: give up on anything that takes longer to arrive

/**
 * A private physics world holding a single ghost ball, identical to the real one. Flying
 * it with the same engine and the same forces makes predictions match the game exactly
 * (Rapier's internal substeps and damping included). Created on first use, after
 * `createPhysics` has initialised Rapier.
 */
let ghost: { world: RAPIER.World; ball: RAPIER.RigidBody } | null = null;

function ghostBall(): { world: RAPIER.World; ball: RAPIER.RigidBody } {
  if (!ghost) {
    const world = new RAPIER.World({ x: 0, y: GRAVITY, z: 0 });
    world.timestep = PHYSICS_STEP;
    ghost = { world, ball: createBall(world) };
  }
  return ghost;
}

/**
 * Fly the ball from `from` with velocity `v` and spin `w` through empty air (gravity,
 * drag, Magnus) until it crosses the plane z = `planeZ`. Matches the in-game flight until
 * the ball hits something. Returns null if the ball never gets there.
 */
export function predictCrossing(from: Vec3, v: Vec3, w: Vec3 = NO_SPIN, planeZ = 0): Crossing | null {
  const { world, ball } = ghostBall();
  ball.setTranslation(from, true);
  ball.setLinvel(v, true);
  ball.setAngvel(w, true);
  for (let step = 0; step * PHYSICS_STEP < MAX_FLIGHT; step++) {
    const prev = ball.translation();
    applyAero(ball);
    world.step();
    const p = ball.translation();
    if (p.z <= planeZ) {
      // Interpolate within the step for a sub-step crossing point.
      const f = (prev.z - planeZ) / (prev.z - p.z);
      return { x: prev.x + (p.x - prev.x) * f, y: prev.y + (p.y - prev.y) * f, t: (step + f) * PHYSICS_STEP };
    }
  }
  return null;
}

/**
 * Launch velocity that sends the ball from `from` through `target` (on the plane
 * z = target.z), struck with spin `w`, at a horizontal speed of `speed` m/s.
 *
 * Starts from the drag-free ballistic answer, flies it with `predictCrossing`, and moves
 * the point it aims at by however far the ball missed, until it lands on target. Curved
 * shots therefore set off to one side and bend back in.
 */
export function solveLaunch(from: Vec3, target: Vec3, speed: number, w: Vec3 = NO_SPIN): Launch {
  const aimAt = { ...target };
  let velocity = ballistic(from, aimAt, speed);
  let flightTime = horizontalDistance(from, target) / speed;

  for (let i = 0; i < 10; i++) {
    const c = predictCrossing(from, velocity, w, target.z);
    if (!c) break;
    flightTime = c.t;
    const ex = target.x - c.x;
    const ey = target.y - c.y;
    if (Math.abs(ex) < 0.002 && Math.abs(ey) < 0.002) break;
    aimAt.x += ex;
    aimAt.y += ey;
    velocity = ballistic(from, aimAt, speed);
  }
  return { velocity, flightTime };
}

/** Drag-free launch velocity from `from` to `target` at horizontal speed `speed`. */
function ballistic(from: Vec3, target: Vec3, speed: number): Vec3 {
  const dx = target.x - from.x;
  const dz = target.z - from.z;
  const distance = Math.hypot(dx, dz);
  const time = distance / speed;
  const vy = (target.y - from.y - 0.5 * GRAVITY * time * time) / time;
  return { x: (dx / distance) * speed, y: vy, z: (dz / distance) * speed };
}

function horizontalDistance(a: Vec3, b: Vec3): number {
  return Math.hypot(b.x - a.x, b.z - a.z);
}
