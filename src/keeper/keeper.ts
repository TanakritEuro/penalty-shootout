import RAPIER from '@dimforge/rapier3d-compat';
import { TUNING, type KeeperLevelName } from '../config';
import {
  KEEPER_ARM_LENGTH,
  KEEPER_HAND_RADIUS,
  KEEPER_HEIGHT,
  KEEPER_LINE_OFFSET,
  KEEPER_RADIUS,
  KEEPER_SHOULDER_HALF_WIDTH,
  KEEPER_SHOULDER_HEIGHT,
} from '../constants';
import type { Shot } from '../match/kick';
import type { ColliderTag } from '../physics';
import { planDive, type DivePlan } from './brain';
import { distanceToKeeper, diveTargetPose, landedPose, lerpPose, standingPose, type KeeperPose } from './pose';

type KeeperState =
  | { kind: 'ready' }
  | { kind: 'waiting'; plan: DivePlan; elapsed: number }
  | { kind: 'diving'; from: KeeperPose; to: KeeperPose; duration: number; elapsed: number }
  | { kind: 'landing'; from: KeeperPose; to: KeeperPose; elapsed: number }
  | { kind: 'down' };

/** Rotation about world Z by -angle, as a quaternion (lean +θ tips the head towards +x). */
function leanQuat(angle: number): RAPIER.Rotation {
  return { x: 0, y: 0, z: Math.sin(-angle / 2), w: Math.cos(-angle / 2) };
}

/**
 * The AI goalkeeper: a kinematic Rapier body (torso plus two arms) that the ball bounces
 * off. It waits on the line, then dives to where it thinks the ball is going.
 */
export class Keeper {
  level: KeeperLevelName = TUNING.keeper.level;
  /** When true the player dives with `playerDive`; otherwise the AI decides in `react`. */
  controlledByPlayer = false;
  pose: KeeperPose = standingPose();
  /** The last dive plan, for debugging. */
  lastPlan: DivePlan | null = null;

  readonly body: RAPIER.RigidBody;
  private readonly arms: RAPIER.Collider[] = [];
  private state: KeeperState = { kind: 'ready' };
  private clock = 0;
  /** Player's keeper: the dive target awaiting assist, and where the shot is going. */
  private command: { x: number; y: number } | null = null;
  private incoming: { x: number; y: number } | null = null;

  constructor(world: RAPIER.World, tags: Map<number, ColliderTag>) {
    this.body = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 0, KEEPER_LINE_OFFSET),
    );
    // Gloves and body absorb some of the ball's pace: saves are parries, not trampolines.
    const surface = (desc: RAPIER.ColliderDesc) => desc.setRestitution(0.3).setFriction(0.6);

    const torso = world.createCollider(
      surface(RAPIER.ColliderDesc.capsule(KEEPER_HEIGHT / 2 - KEEPER_RADIUS, KEEPER_RADIUS)).setTranslation(
        0,
        KEEPER_HEIGHT / 2,
        0,
      ),
      this.body,
    );
    tags.set(torso.handle, 'keeper');

    for (let i = 0; i < 2; i++) {
      const arm = world.createCollider(
        surface(RAPIER.ColliderDesc.capsule(KEEPER_ARM_LENGTH / 2 - KEEPER_HAND_RADIUS, KEEPER_HAND_RADIUS)),
        this.body,
      );
      tags.set(arm.handle, 'keeper');
      this.arms.push(arm);
    }
    this.applyPose(true);
  }

  /** The kick has been taken: an AI keeper decides where to go. A player's keeper ignores this. */
  react(shot: Shot): void {
    if (this.controlledByPlayer) {
      this.incoming = shot.target;
      this.assistDive();
      return;
    }
    const plan = planDive(shot, this.level);
    this.lastPlan = plan;
    this.state = { kind: 'waiting', plan, elapsed: 0 };
  }

  /** Distance (m) from a point in the plane of the goal line to the keeper's body and gloves. */
  distanceTo(x: number, y: number): number {
    return distanceToKeeper(this.pose, x, y);
  }

  /** True until the keeper has committed to a dive for this kick. */
  get ready(): boolean {
    return this.state.kind === 'ready';
  }

  /** The player dives towards (x, y) on the goal line, right now. Only once per kick. */
  /**
   * The player dives towards (x, y) on the goal line, right now. Only once per kick.
   * If the ball comes near where they went, they adjust onto it (see `assistRadius`).
   */
  playerDive(x: number, y: number): boolean {
    if (!this.controlledByPlayer || !this.ready) return false;
    const P = TUNING.playerKeeper;
    this.command = { x, y };
    this.startDive(x, y, P.diveTime, P.maxDive);
    this.assistDive();
    return true;
  }

  /** Once both the player's dive and the shot are known, steer the dive onto a nearby ball. */
  private assistDive(): void {
    const s = this.state;
    const ball = this.incoming;
    if (!this.command || !ball || s.kind !== 'diving') return;
    const P = TUNING.playerKeeper;
    if (Math.hypot(ball.x - this.command.x, ball.y - this.command.y) < P.assistRadius) {
      // Carry on from where the body is now, for whatever is left of the dive.
      const remaining = Math.max(0.15, s.duration - s.elapsed);
      this.state = { kind: 'diving', from: this.pose, to: diveTargetPose(this.pose, ball.x, ball.y, P.maxDive), duration: remaining, elapsed: 0 };
    }
    this.command = null;
  }

  /** Back to the middle of the line for the next kick. */
  reset(): void {
    this.state = { kind: 'ready' };
    this.command = null;
    this.incoming = null;
    this.pose = standingPose();
    this.applyPose(true);
  }

  /** Advance the keeper and queue its pose for the next physics step. Call before `world.step()`. */
  step(dt: number): void {
    const K = TUNING.keeper;
    this.clock += dt;
    const s = this.state;

    switch (s.kind) {
      case 'ready':
        this.pose = standingPose(K.swayAmplitude * Math.sin(this.clock * K.swayFrequency * 2 * Math.PI));
        break;

      case 'waiting':
        s.elapsed += dt;
        if (s.elapsed >= s.plan.delay) {
          const level = K.levels[this.level];
          this.startDive(s.plan.x, s.plan.y, level.diveTime, level.maxDive);
        }
        break;

      case 'diving': {
        s.elapsed += dt;
        const t = Math.min(1, s.elapsed / s.duration);
        const eased = 1 - (1 - t) * (1 - t); // explosive launch, slowing at full stretch
        const fast = 1 - (1 - t) ** 4; // the body tips and the arms go up before it travels
        this.pose = lerpPose(s.from, s.to, eased);
        this.pose.lean = s.from.lean + (s.to.lean - s.from.lean) * fast;
        this.pose.arms = s.from.arms + (s.to.arms - s.from.arms) * Math.min(1, fast * 1.5);
        if (t >= 1) this.state = { kind: 'landing', from: this.pose, to: landedPose(this.pose), elapsed: 0 };
        break;
      }

      case 'landing': {
        s.elapsed += dt;
        const t = Math.min(1, s.elapsed / K.landTime);
        this.pose = lerpPose(s.from, s.to, t * t); // falling: accelerate into the ground
        if (t >= 1) this.state = { kind: 'down' };
        break;
      }

      case 'down':
        break;
    }

    this.applyPose(false);
  }

  private startDive(x: number, y: number, duration: number, maxDive: number): void {
    this.state = { kind: 'diving', from: this.pose, to: diveTargetPose(this.pose, x, y, maxDive), duration, elapsed: 0 };
  }

  /** Position the body and arm colliders for the current pose. */
  private applyPose(teleport: boolean): void {
    const p = this.pose;
    const position = { x: p.x, y: p.y, z: KEEPER_LINE_OFFSET };
    const rotation = leanQuat(p.lean);
    if (teleport) {
      this.body.setTranslation(position, true);
      this.body.setRotation(rotation, true);
    } else {
      // Kinematic moves give the body a velocity, so a diving keeper pushes the ball.
      this.body.setNextKinematicTranslation(position);
      this.body.setNextKinematicRotation(rotation);
    }

    this.arms.forEach((arm, i) => {
      const side = i === 0 ? -1 : 1;
      const a = armLocal(side, p.arms);
      arm.setTranslationWrtParent({ x: a.x, y: a.y, z: 0 });
      arm.setRotationWrtParent(leanQuat(side * p.arms));
    });
  }
}

/** Centre of an arm in the body's local frame, for arm angle `angle` on `side` (−1 left, +1 right). */
export function armLocal(side: number, angle: number): { x: number; y: number } {
  return {
    x: side * (KEEPER_SHOULDER_HALF_WIDTH + Math.sin(angle) * (KEEPER_ARM_LENGTH / 2)),
    y: KEEPER_SHOULDER_HEIGHT + Math.cos(angle) * (KEEPER_ARM_LENGTH / 2),
  };
}
