import { BALL_LINEAR_DAMPING, GRAVITY } from '../constants';

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

/**
 * Launch velocity that carries the ball from `from` to `target` with an average
 * horizontal speed of `speed` m/s, under gravity and the ball's linear damping.
 *
 * With damping c, velocity obeys dv/dt = g − c·v, which integrates to
 *   x(t) = x0 + v0·(1 − e^(−ct)) / c
 *   y(t) = y0 + (g/c)·t + (v0 − g/c)·(1 − e^(−ct)) / c
 * so both components can be solved exactly for a chosen flight time.
 */
export function solveLaunch(from: Vec3, target: Vec3, speed: number): Launch {
  const dx = target.x - from.x;
  const dz = target.z - from.z;
  const dy = target.y - from.y;
  const distance = Math.hypot(dx, dz);
  const time = distance / speed;

  const c = BALL_LINEAR_DAMPING;
  const g = GRAVITY;
  let horizontal: number;
  let vy: number;
  if (c < 1e-6) {
    horizontal = speed;
    vy = (dy - 0.5 * g * time * time) / time;
  } else {
    const k = c / (1 - Math.exp(-c * time)); // 1 / ((1 − e^(−ct)) / c)
    horizontal = distance * k;
    vy = (dy - (g / c) * time) * k + g / c;
  }

  return {
    velocity: { x: (dx / distance) * horizontal, y: vy, z: (dz / distance) * horizontal },
    flightTime: time,
  };
}
