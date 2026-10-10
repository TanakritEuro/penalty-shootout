import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { TUNING } from '../config';
import { BALL_RADIUS, PENALTY_SPOT_Z } from '../constants';
import type { PointerInput } from '../input/pointer';
import type { ColliderTag } from '../physics';
import { aimFromPointer } from '../shooting/aim';
import { chooseCpuShot, type CpuShot } from '../shooting/cpuKicker';
import { ShotTracker, type ShotOutcome } from '../shooting/outcome';
import { applyShotError, powerFromCharge, speedForPower } from '../shooting/power';
import { solveLaunch } from '../shooting/trajectory';
import type { Side } from './shootout';

export type KickState =
  | { kind: 'aiming' }
  | { kind: 'charging'; elapsed: number }
  | { kind: 'cpuRunUp'; shot: CpuShot; elapsed: number }
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
  /** The result has been shown; the kick is over and waits in `nextKick` to be started again. */
  onDone?: (outcome: ShotOutcome) => void;
}

/**
 * One penalty, start to finish. The player's kick goes Aiming → Charging → BallInFlight →
 * Result → NextKick; the computer's replaces aiming and charging with a CpuRunUp.
 * `step` runs inside the fixed physics step; the renderer reads `state` and `aim`.
 */
export class Kick {
  state: KickState = { kind: 'nextKick' };
  /** Who is taking this kick. */
  shooter: Side = 'player';
  /** Where the player is aiming on the goal line (x across, y up). */
  readonly aim = new THREE.Vector2(0, 1);
  events: KickEvents = {};

  constructor(
    private readonly ball: RAPIER.RigidBody,
    private readonly input: PointerInput,
    private readonly camera: THREE.Camera,
  ) {
    this.placeBall();
  }

  /** Power (0–1) currently on the meter, or null outside the charging state. */
  get power(): number | null {
    return this.state.kind === 'charging' ? powerFromCharge(this.state.elapsed) : null;
  }

  /** Set the ball on the spot and hand the kick to `shooter`. */
  start(shooter: Side): void {
    this.shooter = shooter;
    this.placeBall();
    this.input.consumePress();
    this.input.consumeRelease();
    this.input.consumeCancel();
    this.state = shooter === 'player' ? { kind: 'aiming' } : { kind: 'cpuRunUp', shot: chooseCpuShot(), elapsed: 0 };
  }

  /** Abandon the kick in progress and leave the ball on the spot, idle. */
  stop(): void {
    this.placeBall();
    this.state = { kind: 'nextKick' };
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
        else if (this.input.consumeRelease()) this.shoot(this.aim, powerFromCharge(s.elapsed));
        break;

      case 'cpuRunUp':
        this.input.consumePress(); // clicks don't do anything while the computer shoots
        s.elapsed += dt;
        if (s.elapsed >= TUNING.cpuKicker.runUpTime) this.shoot(s.shot.aim, s.shot.power);
        break;

      case 'ballInFlight': {
        this.input.consumePress();
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
          this.events.onDone?.(s.outcome);
        }
        break;

      case 'nextKick':
        break;
    }
  }

  private updateAim(): void {
    aimFromPointer(this.input.ndc, this.camera, this.aim);
  }

  private shoot(aim: { x: number; y: number }, power: number): void {
    const target = applyShotError(aim, power);
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
