import * as THREE from 'three';
import { TUNING } from '../config';
import { GOAL_HEIGHT, GOAL_WIDTH, POST_RADIUS } from '../constants';
import type { Keeper } from '../keeper/keeper';
import type { Shot } from '../match/kick';
import type { Vec3 } from '../shooting/trajectory';

type SlowMo =
  | { phase: 'in'; t: number }
  | { phase: 'hold'; t: number }
  | { phase: 'out'; t: number };

/**
 * Directs the presentation of each kick: the broadcast camera behind the kicker on the
 * player's kicks, a camera behind the keeper looking out at the kicker on the CPU's (the
 * player is in goal and needs to read the run-up), and on a close call (the ball about
 * to pass near the woodwork or the keeper's gloves) a cut to a low goal-line camera with
 * a moment of slow motion.
 *
 * `timeScale` is applied by the game loop to how much game time each frame advances.
 */
export class Director {
  timeScale = 1;
  private slowMo: SlowMo | null = null;
  private shot: Shot | null = null;
  private triggered = false;
  private readonly main: { position: THREE.Vector3; quaternion: THREE.Quaternion; fov: number };

  constructor(private readonly camera: THREE.PerspectiveCamera) {
    this.main = { position: camera.position.clone(), quaternion: camera.quaternion.clone(), fov: camera.fov };
  }

  /** True from a close-call cut until the next kick: the main camera is not showing. */
  get cutAway(): boolean {
    return this.triggered;
  }

  /** A new kick: back to full speed, on the broadcast camera or the keeper's-eye one. */
  reset(view: 'main' | 'keeper' = 'main'): void {
    this.shot = null;
    this.triggered = false;
    this.slowMo = null;
    this.timeScale = 1;
    this.keeperView = view === 'keeper' && TUNING.director.useKeeperCamera;
    if (this.keeperView) {
      const C = TUNING.director.keeperCamera;
      this.camera.position.set(C.x, C.y, C.z);
      this.camera.lookAt(C.lookX, C.lookY, C.lookZ);
      this.setFov(C.fov);
    } else {
      this.camera.position.copy(this.main.position);
      this.camera.quaternion.copy(this.main.quaternion);
      this.setFov(this.main.fov);
    }
  }

  /**
   * True while looking out from behind the keeper (the player is in goal): screen left is
   * then world +x, the opposite of the main camera.
   */
  keeperView = false;

  onShot(shot: Shot): void {
    this.shot = shot;
    this.triggered = false;
  }

  /**
   * Call once per rendered frame with real (unscaled) seconds. `ball` is the ball's
   * position and `inFlight` whether the shot is still live.
   */
  update(realDt: number, ball: Vec3, inFlight: boolean, keeper: Keeper): void {
    if (!this.triggered && inFlight && this.shot && ball.z > 0 && ball.z < TUNING.director.triggerDistance) {
      if (this.isCloseCall(keeper)) this.trigger();
    }
    this.advanceSlowMo(realDt);
  }

  private isCloseCall(keeper: Keeper): boolean {
    const D = TUNING.director;
    const t = this.shot!.target;
    const postX = GOAL_WIDTH / 2 + POST_RADIUS;
    const barY = GOAL_HEIGHT + POST_RADIUS;
    const nearPost = Math.abs(Math.abs(t.x) - postX) < D.woodworkMargin && t.y < barY + D.woodworkMargin;
    const nearBar = Math.abs(t.y - barY) < D.woodworkMargin && Math.abs(t.x) < postX + D.woodworkMargin;
    // Where the keeper is now, against where the ball will cross: a save or a near miss.
    const nearKeeper = keeper.distanceTo(t.x, t.y) < D.keeperMargin;
    return nearPost || nearBar || nearKeeper;
  }

  private trigger(): void {
    const C = TUNING.director.cutCamera;
    const side = this.shot!.target.x < 0 ? -1 : 1;
    this.triggered = true;
    this.slowMo = { phase: 'in', t: 0 };
    this.camera.position.set(side * C.x, C.y, C.z);
    this.camera.lookAt(side * C.lookX, C.lookY, C.lookZ);
    this.setFov(C.fov);
  }

  private advanceSlowMo(realDt: number): void {
    const D = TUNING.director;
    const s = this.slowMo;
    if (!s) return;
    s.t += realDt;
    switch (s.phase) {
      case 'in':
        this.timeScale = 1 + (D.slowScale - 1) * Math.min(1, s.t / D.easeIn);
        if (s.t >= D.easeIn) this.slowMo = { phase: 'hold', t: 0 };
        break;
      case 'hold':
        this.timeScale = D.slowScale;
        if (s.t >= D.slowHold) this.slowMo = { phase: 'out', t: 0 };
        break;
      case 'out':
        this.timeScale = D.slowScale + (1 - D.slowScale) * Math.min(1, s.t / D.easeOut);
        if (s.t >= D.easeOut) {
          this.slowMo = null;
          this.timeScale = 1;
        }
        break;
    }
  }

  private setFov(fov: number): void {
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }
}
