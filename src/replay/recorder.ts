import * as THREE from 'three';
import type { Net, Ripple } from '../net';

interface Frame {
  /** Game seconds since recording started. */
  t: number;
  /** Position (3), quaternion (4) and visibility (1) of every tracked object. */
  data: Float32Array;
  ripples: Ripple[];
}

const STRIDE = 8;
/** Longest recording kept (game seconds); anything older is dropped. */
const MAX_LENGTH = 10;

/**
 * Records what is on screen during a kick, frame by frame: the local transforms of the
 * ball, the keeper and kicker rigs (every joint), and the net's ripples. Playing it back
 * just writes those transforms back, so a replay looks exactly like the kick did, without
 * re-running any physics.
 */
export class Recorder {
  private readonly objects: THREE.Object3D[] = [];
  private frames: Frame[] = [];
  private clock = 0;
  private recording = false;
  private strikeAt: number | null = null;

  constructor(
    roots: THREE.Object3D[],
    private readonly net: Net,
  ) {
    // Every node that moves: the roots plus their joint groups. Meshes hang rigidly off
    // the joints, so they don't need recording.
    for (const root of roots) {
      root.traverse((o) => {
        if (o === root || !(o instanceof THREE.Mesh)) this.objects.push(o);
      });
    }
  }

  /** Throw away the last recording and start a new one. */
  start(): void {
    this.frames = [];
    this.clock = 0;
    this.strikeAt = null;
    this.recording = true;
  }

  stop(): void {
    this.recording = false;
  }

  /** The moment the ball was struck, so a replay can start just before it. */
  markStrike(): void {
    this.strikeAt = this.clock;
  }

  /** The span (game seconds, recording clock) worth replaying: from `lead` before the strike to the end. */
  span(lead: number): { start: number; end: number } | null {
    if (this.frames.length < 2) return null;
    const first = this.frames[0].t;
    const end = this.frames[this.frames.length - 1].t;
    const start = this.strikeAt === null ? first : Math.max(first, this.strikeAt - lead);
    return { start, end };
  }

  /** Call after the scene has been updated for a frame that advanced `dt` game seconds. */
  capture(dt: number): void {
    if (!this.recording) return;
    this.clock += dt;
    if (this.frames.length && dt === 0) return; // paused: nothing new to record
    const data = new Float32Array(this.objects.length * STRIDE);
    this.objects.forEach((o, i) => {
      const k = i * STRIDE;
      data[k] = o.position.x;
      data[k + 1] = o.position.y;
      data[k + 2] = o.position.z;
      data[k + 3] = o.quaternion.x;
      data[k + 4] = o.quaternion.y;
      data[k + 5] = o.quaternion.z;
      data[k + 6] = o.quaternion.w;
      data[k + 7] = o.visible ? 1 : 0;
    });
    this.frames.push({ t: this.clock, data, ripples: this.net.snapshot() });
    while (this.frames.length > 2 && this.clock - this.frames[0].t > MAX_LENGTH) this.frames.shift();
  }

  /** Pose everything as it was at time `time` on the recording clock (see `span`). */
  apply(time: number): void {
    if (this.frames.length === 0) return;
    let i = this.frames.findIndex((f) => f.t >= time);
    if (i < 0) i = this.frames.length - 1;
    const b = this.frames[i];
    const a = this.frames[Math.max(0, i - 1)];
    const f = b.t > a.t ? Math.min(1, Math.max(0, (time - a.t) / (b.t - a.t))) : 1;
    const qa = new THREE.Quaternion();
    const qb = new THREE.Quaternion();
    this.objects.forEach((o, n) => {
      const k = n * STRIDE;
      o.position.set(
        a.data[k] + (b.data[k] - a.data[k]) * f,
        a.data[k + 1] + (b.data[k + 1] - a.data[k + 1]) * f,
        a.data[k + 2] + (b.data[k + 2] - a.data[k + 2]) * f,
      );
      qa.set(a.data[k + 3], a.data[k + 4], a.data[k + 5], a.data[k + 6]);
      qb.set(b.data[k + 3], b.data[k + 4], b.data[k + 5], b.data[k + 6]);
      o.quaternion.copy(qa.slerp(qb, f));
      o.visible = (f < 0.5 ? a : b).data[k + 7] > 0.5;
    });
    this.net.restore((f < 0.5 ? a : b).ripples);
  }
}
