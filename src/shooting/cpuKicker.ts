import { TUNING } from '../config';
import { CENTRE, type Contact } from './spin';

export interface CpuShot {
  /** Where the computer aims on the goal line. Overpower error is applied on top, as for the player. */
  aim: { x: number; y: number };
  power: number;
  /** Where the boot meets the ball (see spin.ts). */
  contact: Contact;
}

/** The computer's choice of placement and power for one penalty. */
export function chooseCpuShot(): CpuShot {
  const C = TUNING.cpuKicker;
  const between = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

  const x =
    Math.random() < C.centreChance
      ? between(-0.4, 0.4)
      : (Math.random() < 0.5 ? -1 : 1) * between(C.minSideX, C.maxSideX);
  return {
    aim: { x, y: between(C.minY, C.maxY) },
    power: between(C.minPower, C.maxPower),
    // Sometimes curl it: mostly sidespin, a little top or back.
    contact:
      Math.random() < C.spinChance
        ? { x: between(-C.maxContact, C.maxContact), y: between(-0.2, 0.2) * C.maxContact }
        : CENTRE,
  };
}

/** The keeper went early to `keeperX`: put the ball in the other side of the goal. */
export function counterKeeper(shot: CpuShot, keeperX: number): CpuShot {
  const C = TUNING.cpuKicker;
  const side = Math.abs(keeperX) > 0.3 ? -Math.sign(keeperX) : Math.random() < 0.5 ? -1 : 1;
  const x = side * (C.minSideX + Math.random() * (C.maxSideX - C.minSideX));
  return { ...shot, aim: { x, y: shot.aim.y } };
}
