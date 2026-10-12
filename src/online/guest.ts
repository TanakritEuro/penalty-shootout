import * as THREE from 'three';
import type { Sound } from '../audio/sound';
import { fitFov } from '../camera/director';
import type { Kickers } from '../characters/kicker';
import { TUNING } from '../config';
import { GOAL_HEIGHT, GOAL_WIDTH } from '../constants';
import type { KeeperKeys } from '../input/keeperKeys';
import type { PointerInput } from '../input/pointer';
import type { SpinKeys } from '../input/spinKeys';
import type { KeeperMesh } from '../keeper/mesh';
import { otherSide, Shootout, type Side } from '../match/shootout';
import { keeperShirt, TEAMS } from '../match/teams';
import type { Ripple } from '../net';
import type { Clip, Frame, Recorder } from '../replay/recorder';
import { aimFromPointer, type Reticle } from '../shooting/aim';
import { overpower, powerFromCharge, scatterForPower } from '../shooting/power';
import { CENTRE, clampContact, nudgeContact, type Contact } from '../shooting/spin';
import type { Hud } from '../ui/hud';
import { decodeFrame } from './frames';
import type { Link } from './link';
import { parseHostMessage, PROTOCOL, type GuestMessage, type GuestState, type HostMessage } from './protocol';

/** How far behind the host (s) the guest shows things, so there's always a next frame to blend towards. */
const DELAY = 0.1;
/** How fast (s per s) that delay is allowed to shrink back after a late frame stretched it. */
const CATCH_UP = 0.02;
/** Keep this much (s) of frames behind the playhead. */
const HISTORY = 0.5;
const WELCOME_TIMEOUT = 10000;

/** What the guest's device brings to an online game. */
export interface GuestParts {
  recorder: Recorder;
  camera: THREE.PerspectiveCamera;
  hud: Hud;
  reticle: Reticle;
  pointer: PointerInput;
  spinKeys: SpinKeys;
  keeperKeys: KeeperKeys;
  sound: Sound;
  keeperMesh: KeeperMesh;
  kickers: Kickers;
}

/**
 * Join a host's game: say hello (version, team, how many objects our scene tracks) and
 * wait to be welcomed with both teams. Rejects with the host's reason if they refuse.
 */
export function introduce(link: Link, team: string, nodes: number): Promise<Record<Side, string>> {
  link.send({ type: 'hello', version: PROTOCOL, team, nodes } satisfies GuestMessage);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("The host didn't answer.")), WELCOME_TIMEOUT);
    link.onMessage = (raw) => {
      const m = parseHostMessage(raw);
      if (m?.type === 'welcome') {
        clearTimeout(timer);
        resolve(m.teams);
      } else if (m?.type === 'reject') {
        clearTimeout(timer);
        reject(new Error(m.reason));
      }
    };
  });
}

/**
 * This device as the guest in an online game. The host runs the match; here we show what
 * it sends, a moment behind so motion can be blended between frames, and handle this
 * player's input on the spot: aiming and the power meter run locally (so the timing is
 * theirs, not the network's) and only the result goes to the host. Dives likewise.
 */
export class OnlineGuest {
  private readonly frames: Frame[] = [];
  /** The camera for each frame: position, quaternion, field of view. */
  private readonly cameras: number[][] = [];
  private readonly clip: Clip = { frames: this.frames, start: 0, end: 0, side: 1, caption: '' };
  private state: GuestState | null = null;
  private newest = -Infinity;
  /** Host clock minus ours (s), from the quickest frame to arrive lately. */
  private offset: number | null = null;
  private playhead: number | null = null;
  private lastData: Float32Array | null = null;
  private dressedFor: string | null = null;

  /** Seconds the button has been held on our kick, or null. */
  private charging: number | null = null;
  /** The kick we've already let go on, so a late frame still showing it can't start another. */
  private releasedKick = -1;
  private contact: Contact = CENTRE;
  private readonly aim = new THREE.Vector2(0, 1);
  private readonly keeperAim = new THREE.Vector2(0, 1);

  constructor(
    private readonly link: Link,
    private readonly parts: GuestParts,
  ) {
    link.onMessage = (raw) => this.receive(raw);
    parts.hud.setKeeperLevel(null, false);
    parts.hud.setReplay(null);
  }

  /** Set where we strike the ball (a tap on the spin widget). */
  setContact(x: number, y: number): void {
    this.contact = clampContact(x, y);
  }

  /**
   * Show the host's game as it was a moment ago and handle this player's input. Returns
   * how much of the host's time (s) this frame moved on.
   */
  update(realDt: number): number {
    this.dress();
    const now = performance.now() / 1000;
    if (this.offset === null || this.frames.length === 0) return 0;
    this.offset -= CATCH_UP * realDt;
    const t = now + this.offset - DELAY;
    while (this.frames.length > 2 && this.frames[1].t < t - HISTORY) {
      this.frames.shift();
      this.cameras.shift();
    }
    this.parts.recorder.apply(this.clip, t);
    this.placeCamera(t);
    const played = this.playhead === null ? 0 : Math.max(0, t - this.playhead);
    this.playhead = t;
    if (this.state) this.control(this.state, realDt);
    return played;
  }

  close(): void {
    this.link.close();
  }

  private receive(raw: unknown): void {
    const m = parseHostMessage(raw);
    if (!m) return;
    switch (m.type) {
      case 'frame':
        this.addFrame(m);
        break;
      case 'hud':
        this.showHud(m);
        break;
      case 'sound':
        this.parts.sound.play(m.event);
        break;
    }
  }

  private addFrame(m: Extract<HostMessage, { type: 'frame' }>): void {
    const data = decodeFrame(m.nodes, this.parts.recorder.size, this.lastData);
    if (!data) return;
    this.lastData = data;
    // Frames may arrive out of order: keep them sorted by time.
    let i = this.frames.length;
    while (i > 0 && this.frames[i - 1].t > m.t) i--;
    this.frames.splice(i, 0, { t: m.t, data, ripples: m.ripples.filter(isRipple) });
    this.cameras.splice(i, 0, m.camera);
    const sample = m.t - performance.now() / 1000;
    this.offset = this.offset === null ? sample : Math.max(this.offset, sample);
    if (m.t > this.newest) {
      this.newest = m.t;
      this.state = m.state;
    }
  }

  private showHud(m: Extract<HostMessage, { type: 'hud' }>): void {
    const hud = this.parts.hud;
    switch (m.op) {
      case 'status':
        return hud.setStatus(m.text);
      case 'result':
        return hud.showResult(m.title, m.detail, m.good);
      case 'hideResult':
        return hud.hideResult();
      case 'scoreboard': {
        const shootout = new Shootout(m.first);
        shootout.kicks.player.push(...m.kicks.player);
        shootout.kicks.cpu.push(...m.kicks.cpu);
        return hud.setScoreboard(shootout, TEAMS);
      }
    }
  }

  /** The camera between the two frames around `t`; across a cut, whichever side is nearer. */
  private placeCamera(t: number): void {
    const frames = this.frames;
    let i = frames.findIndex((f) => f.t >= t);
    if (i < 0) i = frames.length - 1;
    const a = this.cameras[Math.max(0, i - 1)];
    const b = this.cameras[i];
    const ta = frames[Math.max(0, i - 1)].t;
    const tb = frames[i].t;
    const f = tb > ta ? THREE.MathUtils.clamp((t - ta) / (tb - ta), 0, 1) : 1;
    const camera = this.parts.camera;
    const pa = new THREE.Vector3(a[0], a[1], a[2]);
    const pb = new THREE.Vector3(b[0], b[1], b[2]);
    const qa = new THREE.Quaternion(a[3], a[4], a[5], a[6]).normalize();
    const qb = new THREE.Quaternion(b[3], b[4], b[5], b[6]).normalize();
    const cut = pa.distanceTo(pb) > 1 || qa.angleTo(qb) > 0.4;
    if (cut) {
      const c = f < 0.5 ? a : b;
      camera.position.set(c[0], c[1], c[2]);
      camera.quaternion.copy(f < 0.5 ? qa : qb);
    } else {
      camera.position.lerpVectors(pa, pb, f);
      camera.quaternion.slerpQuaternions(qa, qb, f);
    }
    const fov = fitFov((cut && f < 0.5 ? a : b)[7], camera.aspect);
    if (Math.abs(camera.fov - fov) > 1e-3) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  }

  /** Kit colours: the kickers and the keeper's shirt follow the teams and who is shooting. */
  private dress(): void {
    const shooter = this.state?.shooter ?? 'player';
    const key = `${TEAMS.player.name}|${TEAMS.cpu.name}|${shooter}`;
    if (key === this.dressedFor) return;
    this.dressedFor = key;
    this.parts.kickers.dress();
    this.parts.keeperMesh.setShirt(keeperShirt(TEAMS[otherSide(shooter)], TEAMS[shooter]));
  }

  /** Our kick: aim, charge and release here; in goal: dive here. Either way, tell the host. */
  private control(s: GuestState, realDt: number): void {
    const { pointer, hud, reticle, camera, spinKeys, keeperKeys } = this.parts;
    const send = (m: GuestMessage) => this.link.send(m);
    const live = s.match === 'kicking';
    const myShot = live && s.shooter === 'cpu' && (s.kick === 'aiming' || s.kick === 'charging') && s.kickId !== this.releasedKick;

    const nudge = spinKeys.consume();
    if (!myShot) {
      this.charging = null;
      hud.setPower(null);
      hud.setContact(null);
      if (live && s.canDive) {
        reticle.keeperMode = true;
        reticle.visible = true;
        aimFromPointer(pointer.ndc, camera, this.keeperAim);
        this.keeperAim.x = THREE.MathUtils.clamp(this.keeperAim.x, -GOAL_WIDTH / 2, GOAL_WIDTH / 2);
        this.keeperAim.y = Math.min(this.keeperAim.y, GOAL_HEIGHT);
        reticle.update(this.keeperAim, 0, 0);
        let dive = keeperKeys.consumeDive(realDt);
        // Arrow keys follow the screen: looking out from behind the goal, screen left is +x.
        if (dive && s.keeperView) dive.x = -dive.x;
        if (!dive && pointer.consumePress()) dive = { x: this.keeperAim.x, y: this.keeperAim.y };
        if (dive) send({ type: 'dive', x: dive.x, y: dive.y });
      } else {
        keeperKeys.clear();
        reticle.visible = false;
        // Clicks skip banners and start a rematch, as on the host.
        if (pointer.consumePress()) send({ type: 'press' });
        pointer.consumeRelease();
      }
      return;
    }

    if (nudge.x || nudge.y) this.contact = nudgeContact(this.contact, nudge.x * TUNING.spin.nudge, nudge.y * TUNING.spin.nudge);
    aimFromPointer(pointer.ndc, camera, this.aim);
    if (this.charging === null && pointer.consumePress()) {
      this.charging = 0;
      send({ type: 'press' });
    } else if (this.charging !== null) {
      this.charging += realDt;
    }
    if (this.charging !== null) {
      if (pointer.consumeCancel()) {
        this.charging = null;
        send({ type: 'cancel' });
      } else if (pointer.consumeRelease()) {
        send({ type: 'release', power: powerFromCharge(this.charging), aim: { x: this.aim.x, y: this.aim.y }, contact: this.contact });
        this.releasedKick = s.kickId;
        this.charging = null;
      }
    } else {
      pointer.consumeRelease();
      pointer.consumeCancel();
    }
    const power = this.charging === null ? 0 : powerFromCharge(this.charging);
    hud.setPower(power);
    hud.setContact(this.contact);
    reticle.keeperMode = false;
    reticle.visible = this.releasedKick !== s.kickId;
    reticle.update(this.aim, scatterForPower(power), overpower(power));
  }
}

function isRipple(r: unknown): r is Ripple {
  if (typeof r !== 'object' || r === null) return false;
  const o = r as Record<string, unknown>;
  return ['x', 'y', 'z', 'strength', 'age'].every((k) => typeof o[k] === 'number' && Number.isFinite(o[k]));
}
