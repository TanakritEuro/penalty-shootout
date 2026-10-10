import { TUNING } from '../config';
import { BALL_RADIUS } from '../constants';

const T = TUNING.shooting;

/** Power (0–1) after holding the button for `elapsed` seconds. Caps at full power. */
export function powerFromCharge(elapsed: number): number {
  return Math.min(1, elapsed / T.chargeTime);
}

/** Average ball speed (m/s) for a given power. */
export function speedForPower(power: number): number {
  return T.minSpeed + (T.maxSpeed - T.minSpeed) * power;
}

/** 0 while the shot is under control, rising to 1 at full power. */
export function overpower(power: number): number {
  const over = (power - T.overpowerThreshold) / (1 - T.overpowerThreshold);
  return Math.pow(Math.min(1, Math.max(0, over)), T.overpowerCurve);
}

/** Standard deviation (m) of the random scatter on the shot at this power. */
export function scatterForPower(power: number): number {
  return T.baseScatter + T.overpowerScatter * overpower(power);
}

/**
 * Where the ball actually goes when the player aims at (x, y) on the goal line.
 * Overpowered shots drift high and away from the centre, plus some random scatter.
 */
export function applyShotError(aim: { x: number; y: number }, power: number): { x: number; y: number } {
  const over = overpower(power);
  const scatter = scatterForPower(power);
  // Drift away from the side being aimed at; a dead-centre aim can slice either way.
  const side = Math.abs(aim.x) > 0.05 ? Math.sign(aim.x) : Math.random() < 0.5 ? -1 : 1;
  return {
    x: aim.x + side * over * T.overpowerWideDrift * (0.5 + 0.5 * Math.random()) + gaussian() * scatter,
    y: Math.max(BALL_RADIUS, aim.y + over * T.overpowerHighDrift * (0.6 + 0.4 * Math.random()) + gaussian() * scatter),
  };
}

/** Standard normal sample (Box–Muller). */
function gaussian(): number {
  const u = 1 - Math.random(); // (0, 1], keeps log() finite
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random());
}
