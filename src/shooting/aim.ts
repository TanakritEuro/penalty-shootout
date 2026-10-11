import * as THREE from 'three';
import { TUNING } from '../config';
import { BALL_RADIUS, GOAL_HEIGHT, GOAL_WIDTH } from '../constants';

const A = TUNING.aim;
const goalPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0); // z = 0
const raycaster = new THREE.Raycaster();
const hit = new THREE.Vector3();

/**
 * Aim point on the goal line under the pointer, clamped to the goal mouth plus a
 * margin so the player can deliberately aim wide or high. Writes into `out`.
 */
export function aimFromPointer(ndc: THREE.Vector2, camera: THREE.Camera, out: THREE.Vector2): THREE.Vector2 {
  raycaster.setFromCamera(ndc, camera);
  // Pointing at the sky or behind the camera: keep the previous aim.
  if (!raycaster.ray.intersectPlane(goalPlane, hit)) return out;
  const maxX = GOAL_WIDTH / 2 + A.marginWide;
  return out.set(
    THREE.MathUtils.clamp(hit.x, -maxX, maxX),
    THREE.MathUtils.clamp(hit.y, BALL_RADIUS, GOAL_HEIGHT + A.marginHigh),
  );
}

const CALM = new THREE.Color(0xffffff);
const WILD = new THREE.Color(0xff3b30);
/** The player's dive target when they are in goal. */
const KEEPER = new THREE.Color(0x7dff6b);

/** Crosshair ring drawn on the goal line, always on top of the goal frame and net. */
export class Reticle {
  readonly object = new THREE.Group();
  private readonly material = new THREE.MeshBasicMaterial({
    color: CALM,
    transparent: true,
    opacity: 0.9,
    depthTest: false,
    depthWrite: false,
    // Seen from behind the goal too, when the player is in goal.
    side: THREE.DoubleSide,
  });
  private readonly ring: THREE.Mesh;
  /** Green while picking where to dive as keeper, white while shooting. */
  keeperMode = false;

  constructor() {
    // Unit-radius ring, scaled to the current spread.
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 48), this.material);
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.035, 16), this.material);
    const tick = new THREE.PlaneGeometry(0.02, 0.1);
    for (let i = 0; i < 4; i++) {
      const t = new THREE.Mesh(tick, this.material);
      const angle = (i * Math.PI) / 2;
      t.position.set(Math.sin(angle) * 0.12, Math.cos(angle) * 0.12, 0);
      t.rotation.z = -angle;
      this.object.add(t);
    }
    this.object.add(this.ring, dot);
    this.object.traverse((o) => (o.renderOrder = 10));
    this.object.position.z = 0.02;
  }

  /**
   * @param aim point on the goal line
   * @param spread expected scatter (m); the ring grows to show it
   * @param wildness 0 = under control, 1 = fully overpowered; tints the reticle red
   */
  update(aim: THREE.Vector2, spread: number, wildness: number): void {
    this.object.position.x = aim.x;
    this.object.position.y = aim.y;
    this.ring.scale.setScalar(A.reticleRadius + spread * 2);
    // The keeper's-eye camera is much nearer the goal line, so draw it smaller there.
    this.object.scale.setScalar(this.keeperMode ? 0.45 : 1);
    this.material.color.copy(this.keeperMode ? KEEPER : CALM).lerp(WILD, wildness);
  }

  set visible(v: boolean) {
    this.object.visible = v;
  }
}
