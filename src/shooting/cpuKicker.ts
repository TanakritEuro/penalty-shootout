import { TUNING } from '../config';

export interface CpuShot {
  /** Where the computer aims on the goal line. Overpower error is applied on top, as for the player. */
  aim: { x: number; y: number };
  power: number;
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
  };
}
