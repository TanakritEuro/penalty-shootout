import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { TUNING } from '../config';
import { BALL_RADIUS, PENALTY_SPOT_Z } from '../constants';
import type { PointerInput } from '../input/pointer';
import type { ColliderTag } from '../physics';
import { aimFromPointer } from '../shooting/aim';
import { ShotTracker, type ShotOutcome } from '../shooting/outcome';
import { applyShotError, powerFromCharge, speedForPower } from '../shooting/power';
import { solveLaunch } from '../shooting/trajectory';

export type KickState =
  | { kind: 'aiming' }
  | { kind: 'charging'; elapsed: number }
  | { kind: 'ballInFlight'; tracker: ShotTracker; launchSpeed: number }
  | { kind: 'result'; outcome: ShotOutcome; launchSpeed: number; elapsed: number }
  | { kind: 'nextKick' };

/** A struck shot, as the keeper (and anything else watching) sees it. */
export interface Shot {
  /** Where the ball will cross the goal line, after any overpower error. */
  target: { x: number; y: number };
  /** Seconds until it gets there. */
  flightTime: number;
  launchSpeed: number;
}

export interface KickEvents {
  onShot?: (shot: Shot) => void;
  onResult?: (outcome: ShotOutcome, launchSpeed: number) => void;
  onNextKick?: () => void;
}

/**
 * One penalty, start to finish: Aiming → Charging → BallInFlight → Result → NextKick.
 * `step` runs inside the fixed physics step; the renderer reads `state` and `aim`.
 */
export class Kick {
  state: KickState = { kind: 'aiming' };
  /** Where the player is aiming on the goal line (x across, y up). */
  readonly aim = new THREE.Vector2(0, 1);

  constructor(
    private readonly ball: RAPIER.RigidBody,
    private readonly input: PointerInput,
    private readonly camera: THREE.Camera,
    private readonly events: KickEvents = {},
  ) {
    this.placeBall();
  }

  /** Power (0–1) currently on the meter, or null outside the charging state. */
  get power(): number | null {
    return this.state.kind === 'charging' ? powerFromCharge(this.state.elapsed) : null;
  }

  /** Pass every contact the ball makes during this physics step. */
  onBallContact(tag: ColliderTag): void {
    if (this.state.kind === 'ballInFlight') this.state.tracker.onContact(tag);
  }

  step(dt: number): void {
    const s = this.state;
    switch (s.kind) {
      case 'aiming':
        this.updateAim();
        this.input.consumeRelease(); // a release left over from a skipped result
        if (this.input.consumePress()) this.state = { kind: 'charging', elapsed: 0 };
        break;

      case 'charging':
        this.updateAim();
        s.elapsed += dt;
        if (this.input.consumeCancel()) this.state = { kind: 'aiming' };
        else if (this.input.consumeRelease()) this.shoot(powerFromCharge(s.elapsed));
        break;

      case 'ballInFlight': {
        const outcome = s.tracker.update(dt, this.ball.translation(), this.ball.linvel());
        if (outcome) {
          this.state = { kind: 'result', outcome, launchSpeed: s.launchSpeed, elapsed: 0 };
          this.events.onResult?.(outcome, s.launchSpeed);
        }
        break;
      }

      case 'result':
        s.elapsed += dt;
        // Click to skip ahead once the banner has had a moment on screen.
        if ((this.input.consumePress() && s.elapsed > 0.4) || s.elapsed > TUNING.outcome.resultDuration) {
          this.state = { kind: 'nextKick' };
        }
        break;

      case 'nextKick':
        // Milestone 3's shootout rules decide who kicks next; for now it is always the player.
        this.placeBall();
        this.input.consumePress();
        this.input.consumeCancel();
        this.state = { kind: 'aiming' };
        this.events.onNextKick?.();
        break;
    }
  }

  /** Abandon the current kick and set up a fresh one. */
  reset(): void {
    this.state = { kind: 'nextKick' };
  }

  private updateAim(): void {
    aimFromPointer(this.input.ndc, this.camera, this.aim);
  }

  private shoot(power: number): void {
    const target = applyShotError(this.aim, power);
    const { velocity: v, flightTime } = solveLaunch(
      this.ball.translation(),
      { x: target.x, y: target.y, z: 0 },
      speedForPower(power),
    );
    this.ball.setLinvel(v, true);
    const launchSpeed = Math.hypot(v.x, v.y, v.z);
    this.state = { kind: 'ballInFlight', tracker: new ShotTracker(), launchSpeed };
    this.events.onShot?.({ target, flightTime, launchSpeed });
  }

  private placeBall(): void {
    this.ball.setTranslation({ x: 0, y: BALL_RADIUS, z: PENALTY_SPOT_Z }, true);
    this.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.ball.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }
}
