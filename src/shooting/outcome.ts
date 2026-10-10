import { TUNING } from '../config';
import { BALL_RADIUS, GOAL_HEIGHT, GOAL_WIDTH } from '../constants';
import type { ColliderTag } from '../physics';
import type { Vec3 } from './trajectory';

export type Woodwork = 'post' | 'bar';
export type MissKind = 'wide' | 'over' | 'highAndWide' | 'short';

export type ShotOutcome =
  | { kind: 'goal'; woodwork: Woodwork | null; keeperTouch: boolean }
  | { kind: 'saved' }
  | { kind: 'woodwork'; woodwork: Woodwork }
  | { kind: 'miss'; miss: MissKind };

const O = TUNING.outcome;

/**
 * Watches one shot from the moment it is struck and decides how it ended.
 * Feed it the ball's contacts and state every physics step; `update` returns the
 * outcome once it is known and null until then.
 */
export class ShotTracker {
  private elapsed = 0;
  private woodwork: Woodwork | null = null;
  private keeperTouch = false;

  onContact(tag: ColliderTag): void {
    if (tag === 'keeper') this.keeperTouch = true;
    // Remember the first piece of woodwork hit; "off the bar and the post" reads as "off the bar".
    if ((tag === 'post' || tag === 'bar') && this.woodwork === null) this.woodwork = tag;
  }

  update(dt: number, p: Vec3, v: Vec3): ShotOutcome | null {
    this.elapsed += dt;

    // The whole ball has crossed the goal line (or its extension).
    if (p.z < -BALL_RADIUS) {
      const insidePosts = Math.abs(p.x) < GOAL_WIDTH / 2;
      const underBar = p.y < GOAL_HEIGHT;
      if (insidePosts && underBar) return { kind: 'goal', woodwork: this.woodwork, keeperTouch: this.keeperTouch };
      return this.stayedOut() ?? { kind: 'miss', miss: insidePosts ? 'over' : underBar ? 'wide' : 'highAndWide' };
    }

    // Once deflected, wait for the ball to die or come back out before calling it.
    const speed = Math.hypot(v.x, v.y, v.z);
    const settled = speed < O.settleSpeed && this.elapsed > 0.5;
    const deflected = this.stayedOut();
    if (deflected && (settled || p.z > O.reboundDistance)) return deflected;
    if (settled || this.elapsed > O.maxFlightTime) return deflected ?? { kind: 'miss', miss: 'short' };
    return null;
  }

  /** How the shot was kept out if it touched the keeper or the woodwork; null if it touched neither. */
  private stayedOut(): ShotOutcome | null {
    // Any keeper touch on a shot that stays out counts as a save, even if it then hits the frame.
    if (this.keeperTouch) return { kind: 'saved' };
    if (this.woodwork) return { kind: 'woodwork', woodwork: this.woodwork };
    return null;
  }
}

export function describeOutcome(outcome: ShotOutcome): string {
  switch (outcome.kind) {
    case 'goal':
      if (outcome.keeperTouch) return 'GOAL! Through the keeper';
      return outcome.woodwork === 'post' ? 'GOAL! In off the post' : outcome.woodwork === 'bar' ? 'GOAL! In off the bar' : 'GOAL!';
    case 'saved':
      return 'Saved!';
    case 'woodwork':
      return outcome.woodwork === 'post' ? 'Off the post!' : 'Off the bar!';
    case 'miss':
      switch (outcome.miss) {
        case 'wide':
          return 'Wide!';
        case 'over':
          return 'Over the bar!';
        case 'highAndWide':
          return 'High and wide!';
        case 'short':
          return 'Never reached the goal';
      }
  }
}
