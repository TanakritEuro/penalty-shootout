import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { TUNING } from '../config';
import { BALL_RADIUS, PENALTY_SPOT_Z } from '../constants';
import type { PointerInput } from '../input/pointer';
import type { SpinKeys } from '../input/spinKeys';
import type { ColliderTag } from '../physics';
import { aimFromPointer } from '../shooting/aim';
import { chooseCpuShot, counterKeeper, type CpuShot } from '../shooting/cpuKicker';
import { ShotTracker, type ShotOutcome } from '../shooting/outcome';
import { applyShotError, powerFromCharge, speedForPower } from '../shooting/power';
import { CENTRE, contactScatter, contactSpeedFactor, nudgeContact, spinFromContact, type Contact } from '../shooting/spin';
import { predictCrossing, solveLaunch } from '../shooting/trajectory';
import type { Side } from './shootout';

export type KickState =
  | { kind: 'aiming' }
  | { kind: 'charging'; elapsed: number }
  /** Power is locked in; the kicker takes the last stride and strikes at the end. */
  | { kind: 'striking'; aim: { x: number; y: number }; power: number; contact: Contact; from: number; elapsed: number; duration: number }
  /** `tell`: the side (world x sign) the CPU kicker's hips open towards near the end. */
  | { kind: 'cpuRunUp'; shot: CpuShot; tell: number; elapsed: number }
  | { kind: 'ballInFlight'; tracker: ShotTracker; launchSpeed: number }
  | { kind: 'result'; outcome: ShotOutcome; launchSpeed: number; elapsed: number }
  | { kind: 'nextKick' };

/** A struck shot, as the keeper (and anything else watching) sees it. */
export interface Shot {
  /** Where the ball will cross the goal line, after any overpower error and curve. */
  target: { x: number; y: number };
  /** Where it looks like it is going: the line it sets off on, before any curve. */
  apparentTarget: { x: number; y: number };
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
  /** Where the player will strike the ball (W / A / S / D). Kept from kick to kick. */
  contact: Contact = CENTRE;
  events: KickEvents = {};

  constructor(
    private readonly ball: RAPIER.RigidBody,
    private readonly input: PointerInput,
    private readonly camera: THREE.Camera,
    private readonly spinKeys: SpinKeys,
  ) {
    this.placeBall();
  }

  /** Power (0–1) currently on the meter, or null outside the charging state. */
  get power(): number | null {
    return this.state.kind === 'charging' ? powerFromCharge(this.state.elapsed) : null;
  }

  /** How far the kicker is along their run-up: 0 standing at the start, 1 striking the ball. */
  get approach(): number {
    const s = this.state;
    const K = TUNING.kicker;
    switch (s.kind) {
      case 'aiming':
      case 'nextKick':
        return 0;
      case 'charging':
        return K.chargeApproach * powerFromCharge(s.elapsed);
      case 'striking':
        return s.from + (1 - s.from) * Math.min(1, s.elapsed / s.duration);
      case 'cpuRunUp':
        return Math.min(1, s.elapsed / TUNING.cpuKicker.runUpTime);
      case 'ballInFlight':
      case 'result':
        return 1;
    }
  }

  /** During the CPU's run-up, the side (world x sign) its hips will open towards; else 0. */
  get tell(): number {
    return this.state.kind === 'cpuRunUp' ? this.state.tell : 0;
  }

  /** Seconds since the ball was struck (game time), or null before the strike. */
  sinceStrike: number | null = null;

  /** CPU run-up progress (0–1) until the ball is struck, or null outside the run-up. */
  get runUp(): number | null {
    return this.state.kind === 'cpuRunUp' ? Math.min(1, this.state.elapsed / TUNING.cpuKicker.runUpTime) : null;
  }

  /**
   * The player's keeper has committed to a dive towards `keeperX`. If that happens well
   * before the CPU strikes the ball, the kicker sees it and goes the other way.
   * Returns true if the kicker changed the shot.
   */
  keeperCommitted(keeperX: number): boolean {
    const s = this.state;
    if (s.kind !== 'cpuRunUp') return false;
    if (TUNING.cpuKicker.runUpTime - s.elapsed <= TUNING.playerKeeper.earlyCommitWindow) return false;
    s.shot = counterKeeper(s.shot, keeperX);
    return true;
  }

  /** Set the ball on the spot and hand the kick to `shooter`. */
  start(shooter: Side): void {
    this.shooter = shooter;
    this.placeBall();
    this.input.consumePress();
    this.input.consumeRelease();
    this.input.consumeCancel();
    this.spinKeys.consume(); // W / A / S / D pressed between kicks don't count
    this.sinceStrike = null;
    if (shooter === 'player') {
      this.state = { kind: 'aiming' };
    } else {
      const shot = chooseCpuShot();
      const side = Math.abs(shot.aim.x) > 0.3 ? Math.sign(shot.aim.x) : Math.random() < 0.5 ? -1 : 1;
      const tell = Math.random() < TUNING.cpuKicker.tellHonesty ? side : -side;
      this.state = { kind: 'cpuRunUp', shot, tell, elapsed: 0 };
    }
  }

  /** Abandon the kick in progress and leave the ball on the spot, idle. */
  stop(): void {
    this.placeBall();
    this.sinceStrike = null;
    this.state = { kind: 'nextKick' };
  }

  /** Pass every contact the ball makes during this physics step. */
  onBallContact(tag: ColliderTag): void {
    if (this.state.kind === 'ballInFlight') this.state.tracker.onContact(tag);
  }

  step(dt: number): void {
    if (this.sinceStrike !== null) this.sinceStrike += dt;
    const s = this.state;
    switch (s.kind) {
      case 'aiming':
        this.updateAim();
        this.updateContact();
        // A press starts charging. Its release may already be waiting (a tap faster than one
        // step), so leave that for the charging state; any other release is left over from
        // skipping the last result.
        if (this.input.consumePress()) this.state = { kind: 'charging', elapsed: 0 };
        else this.input.consumeRelease();
        break;

      case 'charging':
        this.updateAim();
        this.updateContact();
        s.elapsed += dt;
        if (this.input.consumeCancel()) this.state = { kind: 'aiming' };
        else if (this.input.consumeRelease()) this.startStrike(powerFromCharge(s.elapsed));
        break;

      case 'striking':
        this.input.consumePress();
        s.elapsed += dt;
        if (s.elapsed >= s.duration) this.shoot(s.aim, s.power, s.contact);
        break;

      case 'cpuRunUp':
        this.input.consumePress(); // clicks don't do anything while the computer shoots
        s.elapsed += dt;
        if (s.elapsed >= TUNING.cpuKicker.runUpTime) this.shoot(s.shot.aim, s.shot.power, s.shot.contact);
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

  /** Lock in aim, power and contact and send the kicker on to the ball. */
  private startStrike(power: number): void {
    const K = TUNING.kicker;
    const from = K.chargeApproach * power;
    const duration = K.strikeTime + (K.maxStrikeTime - K.strikeTime) * (1 - from / K.chargeApproach);
    this.state = { kind: 'striking', aim: { x: this.aim.x, y: this.aim.y }, power, contact: this.contact, from, elapsed: 0, duration };
  }

  private updateAim(): void {
    aimFromPointer(this.input.ndc, this.camera, this.aim);
  }

  private updateContact(): void {
    const n = this.spinKeys.consume();
    if (n.x || n.y) this.contact = nudgeContact(this.contact, n.x * TUNING.spin.nudge, n.y * TUNING.spin.nudge);
  }

  private shoot(aim: { x: number; y: number }, power: number, contact: Contact): void {
    const from = this.ball.translation();
    const target = applyShotError(aim, power, contactScatter(contact));
    const spin = spinFromContact(contact, power);
    const { velocity: v, flightTime } = solveLaunch(
      from,
      { x: target.x, y: target.y, z: 0 },
      speedForPower(power) * contactSpeedFactor(contact),
      spin,
    );
    // The line it sets off on: where it would go without the curve.
    const apparentTarget = predictCrossing(from, v) ?? target;
    this.ball.setLinvel(v, true);
    this.ball.setAngvel(spin, true);
    const launchSpeed = Math.hypot(v.x, v.y, v.z);
    this.sinceStrike = 0;
    this.state = { kind: 'ballInFlight', tracker: new ShotTracker(), launchSpeed };
    this.events.onShot?.({ target, apparentTarget: { x: apparentTarget.x, y: apparentTarget.y }, flightTime, launchSpeed });
  }

  private placeBall(): void {
    this.ball.setTranslation({ x: 0, y: BALL_RADIUS, z: PENALTY_SPOT_Z }, true);
    this.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.ball.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }
}
