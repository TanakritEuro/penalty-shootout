import { TUNING, type KeeperLevelName } from '../config';
import { GOAL_HEIGHT, GOAL_WIDTH } from '../constants';
import type { Shot } from '../match/kick';
import { gaussian } from '../random';

export interface DivePlan {
  /** Where on the goal line the keeper goes for (x across, y up). */
  x: number;
  y: number;
  /** Seconds after the kick before they move. */
  delay: number;
  /** True if the keeper read the shot, false if they guessed. Handy for debugging and tuning. */
  read: boolean;
}

/** Typical penalty flight time (s); slower shots give the keeper a better look. */
const TYPICAL_FLIGHT = 0.45;

/**
 * Decide where to dive at the moment of the kick. Like a real keeper, they either read
 * the kicker (and go roughly the right way) or commit to a guess.
 */
export function planDive(shot: Shot, level: KeeperLevelName): DivePlan {
  const K = TUNING.keeper;
  const L = K.levels[level];

  const slowness = Math.min(1, Math.max(0, (shot.flightTime - TYPICAL_FLIGHT) / K.slowShotExtraTime));
  const read = Math.random() < L.readChance + K.slowShotReadBonus * slowness;

  let x: number;
  let y: number;
  if (read) {
    x = shot.target.x + gaussian() * L.readError;
    y = shot.target.y + gaussian() * L.readError * 0.6;
  } else if (Math.random() < K.guessCentreChance) {
    x = 0;
    y = 0.3 + Math.random() * 1.9;
  } else {
    x = (Math.random() < 0.5 ? -1 : 1) * (1.2 + Math.random() * 2.2);
    y = 0.2 + Math.random() * 2.0;
  }

  // Never go for anything outside the frame.
  return {
    x: Math.max(-GOAL_WIDTH / 2, Math.min(GOAL_WIDTH / 2, x)),
    y: Math.max(0.1, Math.min(GOAL_HEIGHT, y)),
    // A keeper who has read it times the dive to meet the ball; a guesser just goes.
    delay: read ? Math.max(L.reactionTime, shot.flightTime - L.diveTime) : L.reactionTime,
    read,
  };
}
