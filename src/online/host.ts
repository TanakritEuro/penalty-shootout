import * as THREE from 'three';
import type { SoundEvent } from '../audio/sound';
import { Director } from '../camera/director';
import type { Release, ShooterControls } from '../input/shooter';
import type { KickState } from '../match/kick';
import type { MatchHud, RemoteSeat } from '../match/match';
import type { Side } from '../match/shootout';
import type { Net } from '../net';
import type { Recorder } from '../replay/recorder';
import { placeMainCamera } from '../scene';
import { CENTRE, clampContact, type Contact } from '../shooting/spin';
import { encodeFrame } from './frames';
import type { Link } from './link';
import { parseGuestMessage, PROTOCOL, type GuestMessage, type GuestState, type HostMessage, type XY } from './protocol';

/** Frames sent to the guest per second; it interpolates between them. */
const FRAME_RATE = 30;
const HELLO_TIMEOUT = 10000;

/** The guest's kicks, as the Kick sees them: presses, releases and aim from the network. */
export class RemoteShooter implements ShooterControls {
  private pressed = false;
  private released: Release | null = null;
  private cancelled = false;
  private readonly aimed = new THREE.Vector2(0, 1);
  private point: Contact = CENTRE;

  /** Apply one message from the guest. */
  receive(m: GuestMessage): void {
    switch (m.type) {
      case 'press':
        this.pressed = true;
        break;
      case 'release':
        this.aimed.set(m.aim.x, m.aim.y);
        this.point = clampContact(m.contact.x, m.contact.y);
        this.released = { power: Math.min(1, Math.max(0, m.power)) };
        break;
      case 'cancel':
        this.cancelled = true;
        break;
    }
  }

  clear(): void {
    this.pressed = false;
    this.released = null;
    this.cancelled = false;
  }

  consumePress(): boolean {
    const p = this.pressed;
    this.pressed = false;
    return p;
  }

  consumeRelease(): Release | null {
    const r = this.released;
    this.released = null;
    return r;
  }

  consumeCancel(): boolean {
    const c = this.cancelled;
    this.cancelled = false;
    return c;
  }

  /** Aimed through the guest's own camera, on their device: the goal-line point is what arrives. */
  aim(_camera: THREE.Camera, out: THREE.Vector2): void {
    out.copy(this.aimed);
  }

  contact(): Contact {
    return this.point;
  }
}

/**
 * Wait for a newly connected guest to say hello: their protocol version, their team and
 * how many objects their scene tracks (it must match ours for frames to make sense).
 * Resolves with their team's name, or rejects (after telling them why) if they can't play.
 */
export function greetGuest(link: Link, nodes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const fail = (reason: string, tell: string) => {
      clearTimeout(timer);
      link.send({ type: 'reject', reason: tell } satisfies HostMessage);
      reject(new Error(reason));
    };
    const timer = setTimeout(() => reject(new Error('Your opponent never said hello.')), HELLO_TIMEOUT);
    link.onMessage = (raw) => {
      const m = parseGuestMessage(raw);
      if (m?.type !== 'hello') return;
      if (m.version !== PROTOCOL || m.nodes !== nodes) {
        fail('Your opponent is on a different version of the game.', 'The host is on a different version of the game. Both of you reload the page and try again.');
        return;
      }
      clearTimeout(timer);
      resolve(m.team);
    };
  });
}

/**
 * The guest's seat in a match this device hosts. The Match plays the guest's side through
 * it (their kicks, their dives, their HUD, their camera director), and each frame the
 * host sends them what's on screen: the scene's transforms, their camera and the state of
 * play. Sounds go across as they happen.
 */
export class OnlineHost implements RemoteSeat {
  readonly side: Side = 'cpu';
  readonly shooter = new RemoteShooter();
  readonly hud: MatchHud;
  /** The guest's camera, directed here and sent to them each frame. */
  readonly camera = new THREE.PerspectiveCamera(36, 2, 0.1, 300);
  readonly director: Director;
  private dives: XY[] = [];
  private lastSent = -Infinity;
  private kickId = 0;
  private lastKick: KickState['kind'] | null = null;

  constructor(
    private readonly link: Link,
    private readonly recorder: Recorder,
    private readonly net: Net,
  ) {
    // Wide enough that the director never widens the shot for a narrow screen: the guest
    // fits the field of view to their own screen.
    placeMainCamera(this.camera);
    this.director = new Director(this.camera);
    const send = (m: HostMessage) => link.send(m);
    this.hud = {
      setStatus: (text) => send({ type: 'hud', op: 'status', text }),
      showResult: (title, detail, good) => send({ type: 'hud', op: 'result', title, detail, good }),
      hideResult: () => send({ type: 'hud', op: 'hideResult' }),
      setScoreboard: (shootout) =>
        send({ type: 'hud', op: 'scoreboard', first: shootout.first, kicks: { player: [...shootout.kicks.player], cpu: [...shootout.kicks.cpu] } }),
    };
    link.onMessage = (raw) => {
      const m = parseGuestMessage(raw);
      if (!m) return;
      if (m.type === 'dive') this.dives.push({ x: m.x, y: m.y });
      else this.shooter.receive(m);
    };
  }

  consumeDive(): XY | null {
    return this.dives.shift() ?? null;
  }

  clearDives(): void {
    this.dives.length = 0;
  }

  sound(event: SoundEvent): void {
    this.link.send({ type: 'sound', event } satisfies HostMessage);
  }

  /**
   * Send the guest the frame just rendered (at most FRAME_RATE a second). `now` is this
   * device's clock in seconds; `state` what they need to know about the moment.
   */
  sendFrame(now: number, state: Omit<GuestState, 'kickId' | 'keeperView'>): void {
    // Count kicks as they start, so the guest can tell them apart.
    if ((state.kick === 'aiming' || state.kick === 'cpuRunUp') && this.lastKick !== 'aiming' && this.lastKick !== 'charging' && this.lastKick !== 'cpuRunUp') this.kickId++;
    this.lastKick = state.kick;
    if (now - this.lastSent < 1 / FRAME_RATE - 0.002) return;
    this.lastSent = now;
    const c = this.camera;
    const message: HostMessage = {
      type: 'frame',
      t: now,
      nodes: encodeFrame(this.recorder.snapshot(), this.recorder.shown()),
      ripples: this.net.snapshot(),
      camera: [c.position.x, c.position.y, c.position.z, c.quaternion.x, c.quaternion.y, c.quaternion.z, c.quaternion.w, c.fov],
      state: { ...state, kickId: this.kickId, keeperView: this.director.keeperView },
    };
    this.link.send(message, 'frames');
  }

  close(): void {
    this.link.close();
  }
}
