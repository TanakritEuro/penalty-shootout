import * as THREE from 'three';
import { TUNING } from '../config';
import type { Kick } from '../match/kick';
import type { Side } from '../match/shootout';
import { TEAMS, type Team } from '../match/teams';
import { blendPoses, DEFAULT_DIMS, Rig, type Pose } from './rig';
import { SkinnedFigure, type ClipBlend, type FigureTemplate } from './skinned';

/**
 * The penalty taker for each side: a rigged figure that waits beside the ball, runs in
 * as the kick progresses and strikes it with the right foot at the moment the ball
 * leaves the spot, then follows through and reacts to the result. Purely visual; the
 * ball's launch is decided by the Kick.
 *
 * Everything is driven by the kick's state (`approach`, `sinceStrike`, the result), so
 * the strike always lands on the physics launch step.
 */
export class Kickers {
  readonly object = new THREE.Group();
  private readonly rigs: Record<Side, Rig>;
  private clock = 0;
  /** The CPU's tell, latched so the body doesn't snap back the moment the ball goes. */
  private tell = 0;

  /** The team each rig is currently dressed as. */
  private readonly dressed: Record<Side, Team>;

  /** The Quaternius models driven by the rigs, when they loaded. */
  private readonly figures: Record<Side, SkinnedFigure> | null = null;

  constructor(template: FigureTemplate | null) {
    const rig = (side: Side) => {
      const t = TEAMS[side];
      return new Rig(DEFAULT_DIMS, { ...teamColours(t), boots: 0x111111, hands: t.skin, longSleeves: false });
    };
    this.rigs = { player: rig('player'), cpu: rig('cpu') };
    if (template) {
      const figure = (side: Side) => {
        const f = new SkinnedFigure(template, this.rigs[side], DEFAULT_DIMS.height);
        this.rigs[side].setPartsVisible(false);
        f.setColours(new THREE.Color(TEAMS[side].colour).getHex(), TEAMS[side].shorts);
        return f;
      };
      this.figures = { player: figure('player'), cpu: figure('cpu') };
    }
    this.dressed = { ...TEAMS };
    this.object.add(this.rigs.player.root, this.rigs.cpu.root);
  }

  /** Put each kicker in their team's kit, if the teams have changed (the menu, a cup round, online). */
  dress(): void {
    for (const side of ['player', 'cpu'] as const) {
      if (this.dressed[side] !== TEAMS[side]) {
        this.dressed[side] = TEAMS[side];
        this.rigs[side].setColours(teamColours(TEAMS[side]));
        this.figures?.[side].setColours(new THREE.Color(TEAMS[side].colour).getHex(), TEAMS[side].shorts);
      }
    }
  }

  /** Where the kicker taking the current kick is standing (their feet). */
  get position(): THREE.Vector3 {
    return (this.rigs.player.root.visible ? this.rigs.player : this.rigs.cpu).root.position;
  }

  /** Pose the kicker taking `kick`. `dt` is game seconds. */
  update(dt: number, kick: Kick): void {
    this.dress();
    this.clock += dt;
    const shooter = kick.shooter;
    const rig = this.rigs[shooter];
    this.rigs.player.root.visible = shooter === 'player';
    this.rigs.cpu.root.visible = shooter === 'cpu';

    const K = TUNING.kicker;
    const a = kick.approach;
    const since = kick.sinceStrike;
    if (kick.tell !== 0) this.tell = kick.tell;
    if (a === 0 && since === null) this.tell = 0;

    // Where along the run-up, and which way they face.
    const start = K.runUpStart;
    const end = K.strikePoint;
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const length = Math.hypot(dx, dz);
    const pathYaw = Math.atan2(-dx, -dz);
    // Late in the run-up the hips open and the body leans towards the tell side: the cue a
    // keeper reads (yaw −θ turns towards +x).
    const C = TUNING.cpuKicker;
    const tellAmount = this.tell * smoothstep(C.tellFrom, C.tellFull, since === null ? a : 1);
    const strikeYaw = -tellAmount * C.tellYaw;
    const turn = smoothstep(0.55, 1, a);
    let yaw = (a === 0 && since === null ? pathYaw * 0.6 : pathYaw) * (1 - turn) + strikeYaw * turn;
    let x = start.x + dx * a;
    let z = start.z + dz * a;

    let pose: Pose;
    // With the Quaternius model, its own idle and jog clips take over where they fit: the
    // jog is played in step with the distance run, so the feet land as the kicker moves.
    let clip: ClipBlend | undefined;
    if (since === null) {
      const windup = smoothstep(0.7, 0.95, a);
      const running = smoothstep(0, 0.06, a);
      const phase = ((a * length) / K.stride) * 2 * Math.PI;
      pose = blendPoses(standPose(this.clock), runPose(phase), running);
      pose = blendPoses(pose, windupPose(), windup);
      clip =
        running > 0.5
          ? { name: 'Jog_Fwd_Loop', time: (phase / (2 * Math.PI)) * JOG_CYCLE, weight: running * (1 - windup) }
          : { name: 'Idle_Loop', time: this.clock, weight: 1 - running };
    } else {
      // Contact, follow through, carry on a step and settle.
      pose = blendPoses(contactPose(), followPose(), smoothstep(0.02, 0.3, since));
      pose = blendPoses(pose, standPose(this.clock), smoothstep(0.5, 1.1, since));
      const carry = 0.6 * smoothstep(0, 0.8, since);
      x += Math.sin(-yaw) * carry;
      z += -Math.cos(yaw) * carry;
      yaw *= 1 - smoothstep(0.8, 1.6, since);
    }

    const s = kick.state;
    if (s.kind === 'result') {
      const scored = s.outcome.kind === 'goal';
      const react = smoothstep(0.1, 0.5, s.elapsed);
      pose = blendPoses(pose, scored ? celebratePose(this.clock) : dejectedPose(), react);
      if (scored) clip = { name: 'Dance_Loop', time: this.clock, weight: react };
    }

    rig.root.position.set(x, 0, z);
    rig.root.rotation.y = yaw;
    // The tell's lean: rolling the spine by −θ tips the upper body towards +x.
    const spine = pose.joints.spine ?? {};
    pose.joints.spine = { ...spine, z: (spine.z ?? 0) - tellAmount * C.tellLean };
    rig.setPose(pose);
    this.figures?.[shooter].update(clip);
  }
}

/** Length (s) of one cycle (two steps) of the Quaternius jog clip. */
const JOG_CYCLE = 0.93;

function standPose(clock: number): Pose {
  return {
    joints: {
      spine: { x: 0.06 },
      shoulderL: { z: -0.12 },
      shoulderR: { z: 0.12 },
      elbowL: { x: 0.25 },
      elbowR: { x: 0.25 },
      hipL: { z: -0.05 },
      hipR: { z: 0.05 },
    },
    rootY: 0.006 * Math.sin(clock * 2.5),
  };
}

/** One point in the running cycle; `phase` advances 2π per stride. */
function runPose(phase: number): Pose {
  const s = Math.sin(phase);
  return {
    joints: {
      spine: { x: 0.2 },
      hipL: { x: 0.75 * s },
      hipR: { x: -0.75 * s },
      kneeL: { x: -(0.3 + 1.3 * Math.max(0, -s)) },
      kneeR: { x: -(0.3 + 1.3 * Math.max(0, s)) },
      shoulderL: { x: -0.65 * s, z: -0.1 },
      shoulderR: { x: 0.65 * s, z: 0.1 },
      elbowL: { x: 1.3 },
      elbowR: { x: 1.3 },
    },
    rootY: 0.045 * Math.abs(s) - 0.03,
  };
}

/** Planted on the left foot, right leg drawn back, left arm out for balance. */
function windupPose(): Pose {
  return {
    joints: {
      spine: { x: 0.08, z: 0.12 },
      hipL: { x: 0.3 },
      kneeL: { x: -0.4 },
      ankleL: { x: 0.12 },
      hipR: { x: -0.8 },
      kneeR: { x: -1.8 },
      ankleR: { x: -0.4 },
      shoulderL: { x: 0.3, z: -0.95 },
      shoulderR: { x: -0.4, z: 0.45 },
      elbowL: { x: 0.4 },
      elbowR: { x: 0.6 },
    },
    rootY: -0.05,
  };
}

/** The boot meets the ball: right leg swinging through, toe pointed. */
function contactPose(): Pose {
  return {
    joints: {
      spine: { x: -0.02, z: 0.1 },
      hipL: { x: 0.15 },
      kneeL: { x: -0.4 },
      hipR: { x: 0.5 },
      kneeR: { x: -0.3 },
      ankleR: { x: -0.5 },
      shoulderL: { x: 0.1, z: -1.05 },
      shoulderR: { x: 0.5, z: 0.4 },
      elbowL: { x: 0.3 },
      elbowR: { x: 0.5 },
    },
    rootY: -0.05,
  };
}

function followPose(): Pose {
  return {
    joints: {
      spine: { x: -0.2, z: 0.05 },
      hipL: { x: 0.0 },
      kneeL: { x: -0.25 },
      hipR: { x: 1.25 },
      kneeR: { x: -0.15 },
      ankleR: { x: -0.3 },
      shoulderL: { x: -0.3, z: -1.1 },
      shoulderR: { x: 0.8, z: 0.6 },
      elbowL: { x: 0.3 },
      elbowR: { x: 0.4 },
    },
    rootY: 0,
  };
}

function celebratePose(clock: number): Pose {
  return {
    joints: {
      spine: { x: -0.12 },
      neck: { x: -0.3 },
      shoulderL: { z: -2.7 },
      shoulderR: { z: 2.7 },
      elbowL: { x: 0.2 },
      elbowR: { x: 0.2 },
    },
    rootY: 0.06 * Math.abs(Math.sin(clock * 7)),
  };
}

/** Hands on head. */
function dejectedPose(): Pose {
  return {
    joints: {
      spine: { x: 0.2 },
      neck: { x: 0.35 },
      shoulderL: { x: 0.6, z: -2.2 },
      shoulderR: { x: 0.6, z: 2.2 },
      elbowL: { x: 2.1 },
      elbowR: { x: 2.1 },
    },
  };
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function teamColours(team: Team): { shirt: number; shorts: number; socks: number; skin: number } {
  return { shirt: new THREE.Color(team.colour).getHex(), shorts: team.shorts, socks: team.socks, skin: team.skin };
}
