import { TUNING } from '../config';
import { SHOOTOUT_KICKS } from '../constants';
import type { Shootout, Side } from '../match/shootout';
import type { Team } from '../match/teams';
import type { Contact } from '../shooting/spin';

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** DOM overlay: status line, power meter, result banner, scoreboard and keeper level. */
export class Hud {
  private readonly status = el<HTMLDivElement>('status');
  private readonly scoreboard = el<HTMLDivElement>('scoreboard');
  private readonly level = el<HTMLDivElement>('level');
  private readonly result = el<HTMLDivElement>('result');
  private readonly resultTitle = el<HTMLDivElement>('result-title');
  private readonly resultDetail = el<HTMLDivElement>('result-detail');
  private readonly power = el<HTMLDivElement>('power');
  private readonly powerFill = el<HTMLDivElement>('power-fill');
  private readonly powerLabel = el<HTMLDivElement>('power-label');
  private readonly powerDanger = el<HTMLDivElement>('power-danger');
  private readonly contact = el<HTMLDivElement>('contact');
  private readonly contactDot = el<HTMLDivElement>('contact-dot');
  private readonly root = el<HTMLDivElement>('hud');
  private readonly replayTag = el<HTMLDivElement>('replay-tag');
  private readonly replayButton = el<HTMLButtonElement>('replay-btn');

  constructor() {
    this.powerDanger.style.width = `${(1 - TUNING.shooting.overpowerThreshold) * 100}%`;
  }

  setStatus(text: string): void {
    this.status.textContent = text;
  }

  /** Team names, a dot per kick (scored / missed / to come) and the score. */
  setScoreboard(shootout: Shootout, teams: Record<Side, Team>): void {
    // Five slots each in regulation; sudden death adds one per round.
    const slots = Math.max(SHOOTOUT_KICKS, shootout.kicks.player.length, shootout.kicks.cpu.length);
    const winner = shootout.winner;
    const rows = (['player', 'cpu'] as const).flatMap((side) => {
      const team = div('sb-team');
      if (!winner && shootout.next === side) team.classList.add('up');
      const swatch = div('sb-swatch');
      swatch.style.background = teams[side].colour;
      team.append(swatch, teams[side].name);

      const dots = div('sb-dots');
      const kicks = shootout.kicks[side];
      for (let i = 0; i < slots; i++) {
        dots.append(div(i >= kicks.length ? 'sb-dot' : kicks[i] ? 'sb-dot scored' : 'sb-dot missed'));
      }

      const score = div('sb-score');
      score.textContent = String(shootout.goals(side));
      return [team, dots, score];
    });
    this.scoreboard.replaceChildren(...rows);
  }

  /** Show the CPU keeper's level; with `debugKeys`, also the keys that change it. */
  setKeeperLevel(level: string, debugKeys: boolean): void {
    const keys = document.createElement('span');
    keys.className = 'keys-only';
    keys.textContent = debugKeys ? ' · 1 / 2 / 3 to change' : '';
    this.level.replaceChildren(`CPU keeper: ${level[0].toUpperCase()}${level.slice(1)}`, keys);
  }

  onMenuClick(handler: () => void): void {
    el<HTMLButtonElement>('menu-btn').addEventListener('click', handler);
  }

  /**
   * Tapping the spin widget sets the contact point directly: `handler` gets the tapped
   * spot as fractions of the ball's radius (x right, y up).
   */
  onContactTap(handler: (x: number, y: number) => void): void {
    const ball = el<HTMLDivElement>('contact-ball');
    ball.addEventListener('pointerdown', (e) => {
      const r = ball.getBoundingClientRect();
      handler(((e.clientX - r.left) / r.width) * 2 - 1, -(((e.clientY - r.top) / r.height) * 2 - 1));
    });
  }

  /** Show the meter at `power` (0–1), or hide it with null. */
  /** Show the power meter at `power` (0–1), or hide it with null. */
  setPower(power: number | null): void {
    this.showMeter(power, 'POWER', true);
    if (power !== null) this.powerFill.classList.toggle('over', power > TUNING.shooting.overpowerThreshold);
  }

  /** Reuse the meter as the CPU's run-up: when it fills, the ball is struck. Null hides it. */
  setRunUp(progress: number | null): void {
    this.showMeter(progress, 'KICK', false);
    this.powerFill.classList.remove('over');
  }

  private showMeter(value: number | null, label: string, showDanger: boolean): void {
    this.power.classList.toggle('hidden', value === null);
    if (value === null) return;
    this.powerLabel.textContent = label;
    this.powerDanger.hidden = !showDanger;
    this.powerFill.style.width = `${value * 100}%`;
  }

  /** Show where the player will strike the ball (fractions of its radius), or hide with null. */
  setContact(contact: Contact | null): void {
    this.contact.classList.toggle('hidden', contact === null);
    if (!contact) return;
    this.contactDot.style.left = `${50 + contact.x * 50}%`;
    this.contactDot.style.top = `${50 - contact.y * 50}%`;
  }

  /**
   * Replay controls: 'available' offers the Replay button, 'playing' shows the REPLAY
   * badge and hides the live HUD, null hides both.
   */
  setReplay(state: 'available' | 'playing' | null): void {
    this.replayButton.hidden = state !== 'available';
    this.replayTag.hidden = state !== 'playing';
    this.root.classList.toggle('replaying', state === 'playing');
  }

  onReplayClick(handler: () => void): void {
    this.replayButton.addEventListener('click', handler);
  }

  /** `good`: news the player wants (their goal, their save), shown in gold. */
  showResult(title: string, detail: string, good: boolean): void {
    this.resultTitle.textContent = title;
    this.resultTitle.classList.toggle('good', good);
    this.resultDetail.textContent = detail;
    this.result.hidden = false;
  }

  hideResult(): void {
    this.result.hidden = true;
  }
}

function div(className: string): HTMLDivElement {
  const d = document.createElement('div');
  d.className = className;
  return d;
}
