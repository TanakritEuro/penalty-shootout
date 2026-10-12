import type { Sound } from '../audio/sound';
import type { Match } from '../match/match';
import type { Session } from '../match/session';
import { TEAM_LIST, TEAMS, type Team } from '../match/teams';
import type { Net } from '../net';
import type { GuestParts, OnlineGuest } from '../online/guest';
import type { OnlineHost } from '../online/host';
import type { Link } from '../online/link';
import type { HostMessage } from '../online/protocol';
import type { Hud } from '../ui/hud';
import type { Menu } from '../ui/menu';

export interface OnlineParts extends GuestParts {
  menu: Menu;
  match: Match;
  session: Session;
  sound: Sound;
  net: Net;
  hud: Hud;
}

export interface OnlineHooks {
  /** A game against the other device has started (this one hosting or joining). */
  started(): void;
  /** It's over (someone left, or the connection dropped): back to the menu. */
  ended(): void;
}

/**
 * Playing a friend on another device: opening a room or joining one from the menu, then
 * either hosting the match (this device runs it and sends the guest what to show) or
 * being the guest. The networking code is only loaded when someone goes online.
 */
export class OnlinePlay {
  host: OnlineHost | null = null;
  guest: OnlineGuest | null = null;
  /** Bumped on every new attempt and on leaving, so a late connection from an old one is dropped. */
  private attempt = 0;
  private room: { cancel(): void } | null = null;

  constructor(
    private readonly parts: OnlineParts,
    private readonly hooks: OnlineHooks,
  ) {}

  get active(): boolean {
    return this.host !== null || this.guest !== null;
  }

  /** Open a room and wait for someone to join it; then kick off with us as `team`. */
  async hostRoom(team: Team): Promise<void> {
    const { menu, match, session, sound, recorder, net } = this.parts;
    this.leave();
    sound.unlock(); // inside the click
    const attempt = ++this.attempt;
    const current = () => attempt === this.attempt;
    try {
      const [{ openRoom }, { OnlineHost, greetGuest }] = await Promise.all([import('../online/link'), import('../online/host')]);
      const room = await openRoom();
      if (!current()) return room.cancel();
      this.room = room;
      menu.setOnline({ kind: 'hosting', code: room.code });
      const link = await room.guest;
      this.room = null;
      if (!current()) return link.close();
      link.onClose = (reason) => this.leave(reason);
      const guestTeamName = await greetGuest(link, recorder.size);
      if (!current()) return link.close();
      // The guest picked their own team; if it's ours too, they get the next one.
      const others = TEAM_LIST.filter((t) => t !== team);
      const guestTeam = others.find((t) => t.name === guestTeamName) ?? others[0];
      link.send({ type: 'welcome', teams: { player: team.name, cpu: guestTeam.name } } satisfies HostMessage);

      const host = new OnlineHost(link, recorder, net);
      this.host = host;
      sound.echo = (event) => host.sound(event);
      match.remote = host;
      session.begin({ mode: 'online', teams: { player: team, cpu: guestTeam }, level: 'normal' });
      menu.setOnline({ kind: 'connected', opponent: guestTeam.name });
      this.hooks.started();
    } catch (e) {
      if (current()) this.fail(e);
    }
  }

  /** Join the room with the code the player typed, as `team`. */
  async join(typed: string, team: Team): Promise<void> {
    const { menu, sound, recorder, hud } = this.parts;
    this.leave();
    sound.unlock(); // inside the click
    const attempt = ++this.attempt;
    const current = () => attempt === this.attempt;
    let link: Link | null = null;
    try {
      const [{ cleanRoomCode, joinRoom }, { OnlineGuest, introduce }] = await Promise.all([import('../online/link'), import('../online/guest')]);
      const code = cleanRoomCode(typed);
      if (!code) throw new Error('Room codes are four letters and numbers, like K7QP.');
      menu.setOnline({ kind: 'joining', code });
      link = await joinRoom(code);
      if (!current()) return link.close();
      link.onClose = (reason) => this.leave(reason);
      const teams = await introduce(link, team.name, recorder.size);
      if (!current()) return link.close();
      TEAMS.player = TEAM_LIST.find((t) => t.name === teams.player) ?? TEAMS.player;
      TEAMS.cpu = TEAM_LIST.find((t) => t.name === teams.cpu) ?? TEAMS.cpu;
      hud.hideResult();
      hud.setStatus('');
      this.guest = new OnlineGuest(link, this.parts);
      menu.setOnline({ kind: 'connected', opponent: TEAMS.player.name });
      this.hooks.started();
    } catch (e) {
      link?.close();
      if (current()) this.fail(e);
    }
  }

  /** Stop waiting, connecting or playing; with `message`, tell the player why. */
  leave(message?: string): void {
    this.attempt++;
    this.room?.cancel();
    this.room = null;
    const wasActive = this.active;
    if (this.host) {
      this.host.close();
      this.parts.match.remote = null;
      this.parts.sound.echo = undefined;
      this.host = null;
    }
    if (this.guest) {
      this.guest.close();
      this.guest = null;
    }
    this.parts.menu.setOnline({ kind: 'idle', message });
    if (wasActive) this.hooks.ended();
  }

  private fail(e: unknown): void {
    const message = (e as Error).message;
    this.leave(message === 'cancelled' ? undefined : message);
  }
}
