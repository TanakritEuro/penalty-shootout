import * as THREE from 'three';
import { blendPoses, Rig, type Pose } from '../characters/rig';
import { SkinnedFigure, type FigureTemplate } from '../characters/skinned';
import {
  KEEPER_ARM_LENGTH,
  KEEPER_HAND_RADIUS,
  KEEPER_HEIGHT,
  KEEPER_LINE_OFFSET,
  KEEPER_SHOULDER_HALF_WIDTH,
  KEEPER_SHOULDER_HEIGHT,
} from '../constants';
import type { Keeper } from './keeper';

/**
 * The keeper's visible body: a procedural rig whose proportions match the physics body
 * (so the gloves are where the glove colliders are). It copies its transform from the
 * kinematic body and its arm angle from the keeper's pose; legs and crouch are cosmetic.
 */
export class KeeperMesh {
  readonly object = new THREE.Group();
  private readonly rig: Rig;
  /** The Quaternius model, when it loaded; otherwise the rig's own capsule limbs show. */
  private readonly figure: SkinnedFigure | null = null;
  private clock = 0;

  constructor(
    private readonly keeper: Keeper,
    template: FigureTemplate | null,
  ) {
    this.rig = new Rig(
      {
        height: KEEPER_HEIGHT,
        shoulderHeight: KEEPER_SHOULDER_HEIGHT,
        shoulderHalfWidth: KEEPER_SHOULDER_HALF_WIDTH,
        armLength: KEEPER_ARM_LENGTH,
        handRadius: KEEPER_HAND_RADIUS,
      },
      // The shirt colour is set per team (see match/teams.ts).
      { shirt: 0xffffff, shorts: 0x1b1b1f, socks: 0x1b1b1f, boots: 0x111111, skin: 0xc98e62, hands: 0xf2f2f2, longSleeves: true },
    );
    // The rig faces −z; the keeper faces the kicker, out along +z.
    const facing = new THREE.Group();
    facing.rotation.y = Math.PI;
    facing.add(this.rig.root);
    this.object.add(facing);
    this.object.position.z = KEEPER_LINE_OFFSET;

    if (template) {
      this.figure = new SkinnedFigure(template, this.rig, KEEPER_HEIGHT);
      this.rig.setPartsVisible(false);
      // White gloves over the knuckles, where the glove colliders are.
      for (const side of ['l', 'r']) {
        const glove = new THREE.Mesh(new THREE.SphereGeometry(KEEPER_HAND_RADIUS, 12, 10), new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.6 }));
        glove.castShadow = true;
        this.figure.attach(`middle_01_${side}`, glove);
      }
    }
  }

  setShirt(colour: number): void {
    this.rig.setShirt(colour);
    this.figure?.setColours(colour, 0x1b1b1f);
  }

  /** Copy the physics body and pose the limbs. `dt` is game seconds, for the idle bob. */
  update(dt: number): void {
    this.clock += dt;
    const t = this.keeper.body.translation();
    const r = this.keeper.body.rotation();
    this.object.position.set(t.x, t.y, t.z);
    this.object.quaternion.set(r.x, r.y, r.z, r.w);

    const p = this.keeper.pose;
    const phase = this.keeper.phase;

    // Legs and trunk: a set stance on the line, blending into a stretched dive or a
    // tucked jump as the body leans or leaves the ground.
    const set: Pose = {
      joints: {
        spine: { x: 0.12 },
        hipL: { x: 0.35, z: -0.14 },
        hipR: { x: 0.35, z: 0.14 },
        kneeL: { x: -0.6 },
        kneeR: { x: -0.6 },
        ankleL: { x: 0.25, z: 0.14 },
        ankleR: { x: 0.25, z: -0.14 },
        elbowL: { x: 0.45 },
        elbowR: { x: 0.45 },
      },
      rootY: -0.07 + (phase === 'ready' ? 0.015 * Math.sin(this.clock * 9) : 0),
    };
    const dive: Pose = {
      joints: {
        spine: { x: -0.05 },
        hipL: { x: 0.1, z: -0.06 },
        hipR: { x: -0.1, z: 0.06 },
        kneeL: { x: -0.35 },
        kneeR: { x: -0.15 },
      },
    };
    const jump: Pose = {
      joints: {
        hipL: { x: 0.7, z: -0.08 },
        hipR: { x: 0.7, z: 0.08 },
        kneeL: { x: -1.2 },
        kneeR: { x: -1.2 },
        ankleL: { x: 0.4 },
        ankleR: { x: 0.4 },
      },
    };
    const diving = Math.min(1, Math.abs(p.lean) / 1.0);
    const jumping = diving < 0.2 ? Math.min(1, p.y / 0.3) : 0;
    let pose = blendPoses(set, dive, diving);
    pose = blendPoses(pose, jump, jumping);

    // Arms follow the physics arm angle exactly (measured from the body's up axis; the
    // rig's arms hang down at rest and its right side is the keeper's world −x).
    const raise = Math.PI - p.arms;
    pose.joints.shoulderR = { z: raise };
    pose.joints.shoulderL = { z: -raise };
    if (diving > 0.2 || p.arms < 1) {
      pose.joints.elbowL = { x: 0 };
      pose.joints.elbowR = { x: 0 };
    }
    this.rig.setPose(pose);
    this.figure?.update();
  }
}
