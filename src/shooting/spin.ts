import { TUNING } from '../config';
import type { Vec3 } from './trajectory';

/**
 * Where the boot meets the ball, seen from behind it: x across (+ = right side of the
 * ball), y up (+ = top), as a fraction of the ball's radius. (0, 0) is a clean strike
 * through the middle.
 */
export interface Contact {
  x: number;
  y: number;
}

export const CENTRE: Contact = { x: 0, y: 0 };

/**
 * Spin (rad/s) from striking the ball at `contact`, for a shot heading towards the goal
 * (−z). The strike pushes the contact point forwards, so the torque is r × (−z):
 * striking the right side spins it about +y and the Magnus force bends it left; striking
 * underneath gives backspin (it holds up), over the top gives topspin (it dips).
 */
export function spinFromContact(contact: Contact, power: number): Vec3 {
  const s = TUNING.spin.maxSpin * (0.5 + 0.5 * power);
  return { x: -contact.y * s, y: contact.x * s, z: 0 };
}

/** Off-centre strikes lose some pace: the fraction of speed kept. */
export function contactSpeedFactor(contact: Contact): number {
  const off = Math.hypot(contact.x, contact.y) / TUNING.spin.maxOffset;
  return 1 - TUNING.spin.powerLoss * Math.min(1, off) ** 2;
}

/** Extra scatter (m, standard deviation) from an off-centre strike. */
export function contactScatter(contact: Contact): number {
  return TUNING.spin.extraScatter * Math.min(1, Math.hypot(contact.x, contact.y) / TUNING.spin.maxOffset);
}

/** Move the contact point by (dx, dy), kept inside the allowed circle. */
export function nudgeContact(contact: Contact, dx: number, dy: number): Contact {
  return clampContact(contact.x + dx, contact.y + dy);
}

/** The contact point at (x, y), pulled back inside the allowed circle if need be. */
export function clampContact(x: number, y: number): Contact {
  const r = Math.hypot(x, y);
  const max = TUNING.spin.maxOffset;
  return r > max ? { x: (x / r) * max, y: (y / r) * max } : { x, y };
}
