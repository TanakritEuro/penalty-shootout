import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { Joint, Rig } from './rig';

/** A loaded character model: its scene (mesh + skeleton) and animation clips by name. */
export interface FigureTemplate {
  scene: THREE.Group;
  clips: Map<string, THREE.AnimationClip>;
}

/** Load a rigged .glb (Quaternius' Mannequin), or null if it can't be loaded. */
export async function loadFigure(url: string): Promise<FigureTemplate | null> {
  try {
    const gltf = await new GLTFLoader().loadAsync(url);
    return { scene: gltf.scene, clips: new Map(gltf.animations.map((a) => [a.name, a])) };
  } catch (error) {
    console.warn(`Character model ${url} failed to load; using the built-in figures.`, error);
    return null;
  }
}

/**
 * Which bone follows which driver joint, the bone that marks the far end of that limb, and
 * the limb's direction at rest in the driver joint's own frame (our rig hangs its limbs
 * down −y, the trunk points up +y and feet point forward −z).
 */
const BONES: readonly { joint: Joint; bone: string; end: string | null; restDir: [number, number, number] }[] = [
  { joint: 'hips', bone: 'pelvis', end: null, restDir: [0, 1, 0] },
  { joint: 'spine', bone: 'spine_01', end: 'neck_01', restDir: [0, 1, 0] },
  { joint: 'neck', bone: 'neck_01', end: 'Head', restDir: [0, 1, 0] },
  { joint: 'shoulderL', bone: 'upperarm_l', end: 'lowerarm_l', restDir: [0, -1, 0] },
  { joint: 'elbowL', bone: 'lowerarm_l', end: 'hand_l', restDir: [0, -1, 0] },
  { joint: 'shoulderR', bone: 'upperarm_r', end: 'lowerarm_r', restDir: [0, -1, 0] },
  { joint: 'elbowR', bone: 'lowerarm_r', end: 'hand_r', restDir: [0, -1, 0] },
  { joint: 'hipL', bone: 'thigh_l', end: 'calf_l', restDir: [0, -1, 0] },
  { joint: 'kneeL', bone: 'calf_l', end: 'foot_l', restDir: [0, -1, 0] },
  { joint: 'ankleL', bone: 'foot_l', end: 'ball_l', restDir: [0, -0.5, -0.87] },
  { joint: 'hipR', bone: 'thigh_r', end: 'calf_r', restDir: [0, -1, 0] },
  { joint: 'kneeR', bone: 'calf_r', end: 'foot_r', restDir: [0, -1, 0] },
  { joint: 'ankleR', bone: 'foot_r', end: 'ball_r', restDir: [0, -0.5, -0.87] },
];

/** Head bone to the top of the head (m, model scale), for sizing the model to the rig. */
const HEAD_TOP = 0.17;

interface BoneState {
  bone: THREE.Bone;
  /** Driver joint this bone follows, if any. */
  joint: THREE.Object3D | null;
  /** The joint's rotation at rest, and the bone's calibrated rest rotation (both rig-root space). */
  jointRest: THREE.Quaternion;
  boneRest: THREE.Quaternion;
  /** Calibrated rest rotation relative to the parent bone, for bones without a driver joint. */
  restLocal: THREE.Quaternion;
}

export interface ClipBlend {
  name: string;
  /** Time into the clip (s). */
  time: number;
  /** 0: pure procedural pose, 1: pure clip. */
  weight: number;
}

/**
 * A skinned character model driven by one of our procedural rigs. The rig still computes
 * every pose (so animation stays in sync with the physics); each frame the model's bones
 * take on the rotation each driver joint has made away from its rest pose, after a
 * one-off calibration that lines the model's limbs up with the rig's at rest (the model is
 * bound in a T-pose, the rig stands with its arms down). Recorded clips (idle, jog, dance)
 * can be blended over the top.
 */
export class SkinnedFigure {
  readonly model: THREE.Object3D;
  private readonly bones: BoneState[] = [];
  private readonly pelvis: THREE.Bone;
  private readonly pelvisRest = new THREE.Vector3();
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<string, THREE.AnimationAction>();
  private readonly body: THREE.MeshStandardMaterial[] = [];
  private readonly joints: THREE.MeshStandardMaterial[] = [];
  private readonly hipHeight: number;
  private readonly clipPelvisPosition = new THREE.Vector3();

  constructor(
    template: FigureTemplate,
    private readonly driver: Rig,
    height: number,
  ) {
    this.model = cloneSkinned(template.scene);
    this.model.traverse((o) => {
      if (!(o instanceof THREE.Mesh)) return;
      o.castShadow = true;
      o.frustumCulled = false; // skinned bounds don't follow the pose
      // Own materials per figure, so each can wear its team's colours.
      const mats = (Array.isArray(o.material) ? o.material : [o.material]).map((m: THREE.Material) => {
        const c = (m as THREE.MeshStandardMaterial).clone();
        (c.name === 'M_Joints' ? this.joints : this.body).push(c);
        return c;
      });
      o.material = Array.isArray(o.material) ? mats : mats[0];
    });
    this.pelvis = this.model.getObjectByName('pelvis') as THREE.Bone;

    // The model faces +z, the rig −z; size it to the rig.
    const head = this.model.getObjectByName('Head')!;
    this.model.updateMatrixWorld(true);
    const modelHeight = head.getWorldPosition(new THREE.Vector3()).y + HEAD_TOP;
    this.model.rotation.y = Math.PI;
    this.model.scale.setScalar(height / modelHeight);
    driver.root.add(this.model);
    this.hipHeight = driver.joints.hips.position.y;

    this.mixer = new THREE.AnimationMixer(this.model);
    for (const [name, clip] of template.clips) {
      const action = this.mixer.clipAction(clip);
      action.play();
      action.paused = true;
      action.enabled = false;
      this.actions.set(name, action);
    }

    this.calibrate();
  }

  /** Team colours: the body takes the shirt colour, the joint plates a second colour. */
  setColours(bodyColour: number, jointColour: number): void {
    for (const m of this.body) m.color.setHex(bodyColour);
    for (const m of this.joints) m.color.setHex(jointColour);
  }

  /** Attach a small mesh (e.g. a glove) to the named bone. */
  attach(boneName: string, object: THREE.Object3D): void {
    const bone = this.model.getObjectByName(boneName);
    if (!bone) return;
    // Undo the model's scale so the attachment keeps its real size.
    object.scale.divideScalar(this.model.scale.x);
    bone.add(object);
  }

  /** Copy the driver rig's current pose onto the model, optionally blending a clip in. */
  update(clip?: ClipBlend): void {
    const clipLocal = clip && clip.weight > 0 ? this.sampleClip(clip) : null;

    // Fresh world matrices for the rig and everything above it (the caller just moved it).
    this.driver.root.updateWorldMatrix(true, true);
    const rootInverse = this.driver.root.getWorldQuaternion(new THREE.Quaternion()).invert();
    const rel = (o: THREE.Object3D) => rootInverse.clone().multiply(o.getWorldQuaternion(new THREE.Quaternion()));

    // Bones are listed parents first; work out each one's rotation in rig-root space.
    const target = new Map<THREE.Object3D, THREE.Quaternion>();
    const modelRel = rel(this.model);
    for (const s of this.bones) {
      const parentRel = target.get(s.bone.parent!) ?? (s.bone.parent === this.model ? modelRel : rel(s.bone.parent!));
      let want: THREE.Quaternion;
      if (s.joint) {
        // The rotation the joint has made away from rest, applied to the bone's rest.
        const delta = rel(s.joint).multiply(s.jointRest.clone().invert());
        want = delta.multiply(s.boneRest);
      } else {
        want = parentRel.clone().multiply(s.restLocal);
      }
      target.set(s.bone, want);
      const local = parentRel.clone().invert().multiply(want);
      const fromClip = clipLocal?.get(s.bone);
      s.bone.quaternion.copy(fromClip ? local.slerp(fromClip, clip!.weight) : local);
    }

    // Raise or lower the hips with the rig (crouches, jumps, the run's bob).
    const lift = this.driver.joints.hips.position.y - this.hipHeight;
    this.pelvis.position.copy(this.pelvisRest);
    this.pelvis.position.y += lift / this.model.scale.x;
    if (clipLocal && clip) {
      const clipPelvis = clipLocal.get(this.pelvis);
      if (clipPelvis) this.pelvis.position.lerp(this.clipPelvisPosition, clip.weight);
    }
  }

  /** Pose the bones from `clip` at its time and return their local rotations. */
  private sampleClip(clip: ClipBlend): Map<THREE.Object3D, THREE.Quaternion> | null {
    const action = this.actions.get(clip.name);
    if (!action) return null;
    for (const a of this.actions.values()) a.enabled = a === action;
    action.time = clip.time % action.getClip().duration;
    action.weight = 1;
    this.mixer.update(0);
    const out = new Map<THREE.Object3D, THREE.Quaternion>();
    for (const s of this.bones) out.set(s.bone, s.bone.quaternion.clone());
    this.clipPelvisPosition.copy(this.pelvis.position);
    action.enabled = false;
    return out;
  }

  /** Line the model's limbs up with the rig at rest and remember both rest poses. */
  private calibrate(): void {
    this.driver.setPose({ joints: {} });
    const skinned = this.findSkinnedMesh();
    skinned.skeleton.pose();
    this.driver.root.updateWorldMatrix(true, true);
    this.pelvisRest.copy(this.pelvis.position);

    const rootWorld = this.driver.root.getWorldQuaternion(new THREE.Quaternion());
    const rootInverse = rootWorld.clone().invert();
    const rel = (o: THREE.Object3D) => rootInverse.clone().multiply(o.getWorldQuaternion(new THREE.Quaternion()));
    const pos = (o: THREE.Object3D) => this.driver.root.worldToLocal(o.getWorldPosition(new THREE.Vector3()));

    const restRel = new Map<THREE.Object3D, THREE.Quaternion>();
    const order: THREE.Bone[] = [];
    this.model.traverse((o) => {
      if (o instanceof THREE.Bone) order.push(o);
    });
    for (const bone of order) {
      const map = BONES.find((b) => b.bone === bone.name);
      const parent = bone.parent!;
      const parentRest = restRel.get(parent) ?? rel(parent);
      let boneRest: THREE.Quaternion;
      let joint: THREE.Object3D | null = null;
      let jointRest = new THREE.Quaternion();
      if (map) {
        joint = this.driver.joints[map.joint];
        jointRest = rel(joint);
        boneRest = rel(bone);
        if (map.end) {
          // Swing the bone so its limb points the way the rig's limb does at rest.
          const end = this.model.getObjectByName(map.end)!;
          const from = pos(end).sub(pos(bone)).normalize();
          const to = new THREE.Vector3(...map.restDir).normalize().applyQuaternion(jointRest);
          boneRest = new THREE.Quaternion().setFromUnitVectors(from, to).multiply(boneRest);
        }
      } else {
        // Unmapped bones (fingers, upper spine, clavicles) keep their pose relative to the parent.
        boneRest = parentRest.clone().multiply(bone.quaternion);
      }
      restRel.set(bone, boneRest);
      const restLocal = parentRest.clone().invert().multiply(boneRest);
      this.bones.push({ bone, joint, jointRest, boneRest, restLocal });
    }
  }

  private findSkinnedMesh(): THREE.SkinnedMesh {
    let found: THREE.SkinnedMesh | null = null;
    this.model.traverse((o) => {
      if (o instanceof THREE.SkinnedMesh) found = o;
    });
    if (!found) throw new Error('Character model has no skinned mesh');
    return found;
  }
}
