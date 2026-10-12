import type { SoundEvent } from '../audio/sound';
import type { KickState } from '../match/kick';
import type { MatchState } from '../match/match';
import type { Side } from '../match/shootout';
import type { Ripple } from '../net';

/**
 * Messages between the two devices in an online game. The host runs the match; the guest
 * plays the `cpu` side, sends its inputs and is sent what to show.
 *
 * Bump `PROTOCOL` whenever a message changes, so mismatched versions refuse to play
 * rather than misbehave.
 */
export const PROTOCOL = 1;

export interface XY {
  x: number;
  y: number;
}

/** What the guest needs to know about the moment, besides what's on screen. */
export interface GuestState {
  match: MatchState['kind'];
  kick: KickState['kind'];
  /** Counts kicks, so the guest can tell one kick's aiming from the next. */
  kickId: number;
  shooter: Side;
  /** The guest is in goal and may dive now. */
  canDive: boolean;
  /** The guest's camera is behind their goal (arrow keys then flip left and right). */
  keeperView: boolean;
}

export type GuestMessage =
  | { type: 'hello'; version: number; team: string; nodes: number }
  /** A click: start charging when it's their kick, or skip a banner. */
  | { type: 'press' }
  /** They let go: the power they reached on their own meter, and where they aimed. */
  | { type: 'release'; power: number; aim: XY; contact: XY }
  | { type: 'cancel' }
  | { type: 'dive'; x: number; y: number };

export type HudMessage =
  | { type: 'hud'; op: 'status'; text: string }
  | { type: 'hud'; op: 'result'; title: string; detail: string; good: boolean }
  | { type: 'hud'; op: 'hideResult' }
  | { type: 'hud'; op: 'scoreboard'; first: Side; kicks: Record<Side, boolean[]> };

export type HostMessage =
  | { type: 'welcome'; teams: Record<Side, string> }
  | { type: 'reject'; reason: string }
  /**
   * What's on screen: when (host clock, s), every tracked object (see frames.ts), the net,
   * the guest's camera (position, quaternion, field of view) and the state of play.
   */
  | { type: 'frame'; t: number; nodes: ArrayBuffer; ripples: Ripple[]; camera: number[]; state: GuestState }
  | HudMessage
  | { type: 'sound'; event: SoundEvent };

// What arrives over the network is only as good as the other device's code: check its
// shape before using it, and drop anything that doesn't fit.

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isXY = (v: unknown): v is XY => isObject(v) && isNumber(v.x) && isNumber(v.y);
const isSide = (v: unknown): v is Side => v === 'player' || v === 'cpu';

export function parseGuestMessage(raw: unknown): GuestMessage | null {
  if (!isObject(raw)) return null;
  switch (raw.type) {
    case 'hello':
      return isNumber(raw.version) && typeof raw.team === 'string' && isNumber(raw.nodes) ? (raw as GuestMessage) : null;
    case 'press':
    case 'cancel':
      return { type: raw.type };
    case 'release':
      return isNumber(raw.power) && isXY(raw.aim) && isXY(raw.contact) ? (raw as GuestMessage) : null;
    case 'dive':
      return isNumber(raw.x) && isNumber(raw.y) ? (raw as GuestMessage) : null;
    default:
      return null;
  }
}

export function parseHostMessage(raw: unknown): HostMessage | null {
  if (!isObject(raw)) return null;
  switch (raw.type) {
    case 'welcome':
      return isObject(raw.teams) && typeof raw.teams.player === 'string' && typeof raw.teams.cpu === 'string' ? (raw as HostMessage) : null;
    case 'reject':
      return typeof raw.reason === 'string' ? (raw as HostMessage) : null;
    case 'frame': {
      const s = raw.state;
      const ok =
        isNumber(raw.t) &&
        raw.nodes instanceof ArrayBuffer &&
        Array.isArray(raw.ripples) &&
        Array.isArray(raw.camera) &&
        raw.camera.length === 8 &&
        raw.camera.every(isNumber) &&
        isObject(s) &&
        isSide(s.shooter) &&
        typeof s.match === 'string' &&
        typeof s.kick === 'string';
      return ok ? (raw as HostMessage) : null;
    }
    case 'hud':
      return typeof raw.op === 'string' ? (raw as HostMessage) : null;
    case 'sound':
      return isObject(raw.event) && typeof raw.event.name === 'string' ? (raw as HostMessage) : null;
    default:
      return null;
  }
}
