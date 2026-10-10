import { TUNING } from '../config';
import { BALL_RADIUS, GOAL_HEIGHT, GOAL_WIDTH } from '../constants';
import type { ColliderTag } from '../physics';
import type { Vec3 } from './trajectory';

export type Woodwork = 'post' | 'bar';
export type MissKind = 'wide' | 'over' | 'highAndWide' | 'short';

export type ShotOutcome =
  | { kind: 'goal'; woodwork: Woodwork | null }
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

  onContact(tag: ColliderTag): void {
    // Remember the first piece of woodwork hit; "off the bar and the post" reads as "off the bar".
    if ((tag === 'post' || tag === 'bar') && this.woodwork === null) this.woodwork = tag;
  }

  update(dt: number, p: Vec3, v: Vec3): ShotOutcome | null {
    this.elapsed += dt;

    // The whole ball has crossed the goal line (or its extension).
    if (p.z < -BALL_RADIUS) {
      const insidePosts = Math.abs(p.x) < GOAL_WIDTH / 2;
      const underBar = p.y < GOAL_HEIGHT;
      if (insidePosts && underBar) return { kind: 'goal', woodwork: this.woodwork };
      if (this.woodwork) return { kind: 'woodwork', woodwork: this.woodwork };
      return { kind: 'miss', miss: insidePosts ? 'over' : underBar ? 'wide' : 'highAndWide' };
    }

    const speed = Math.hypot(v.x, v.y, v.z);
    const settled = speed < O.settleSpeed && this.elapsed > 0.5;
    if (this.woodwork && (settled || p.z > O.reboundDistance)) {
      return { kind: 'woodwork', woodwork: this.woodwork };
    }
    if (settled || this.elapsed > O.maxFlightTime) {
      return this.woodwork ? { kind: 'woodwork', woodwork: this.woodwork } : { kind: 'miss', miss: 'short' };
    }
    return null;
  }
}

export function describeOutcome(outcome: ShotOutcome): string {
  switch (outcome.kind) {
    case 'goal':
      return outcome.woodwork === 'post' ? 'GOAL! In off the post' : outcome.woodwork === 'bar' ? 'GOAL! In off the bar' : 'GOAL!';
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
