import type { KeeperLevelName } from '../config';
import type { GameMode, SessionChoice } from '../match/session';
import type { Side } from '../match/shootout';
import { TEAM_LIST, type Team } from '../match/teams';

export interface MenuEvents {
  /** Start a new game with this mode, teams and CPU keeper level. */
  onPlay: (choice: SessionChoice) => void;
  /** Close the menu and carry on with the match in progress. */
  onResume: () => void;
  /** Sound switched on or off. */
  onSound: (muted: boolean) => void;
  /** The player asked to wipe their saved stats. */
  onResetStats: () => void;
  /** Daylight or floodlights. */
  onNight: (night: boolean) => void;
  /** Full graphics, or Lite for weaker devices. */
  onLite: (lite: boolean) => void;
}

const LEVELS: readonly KeeperLevelName[] = ['easy', 'normal', 'hard'];
const MODES: readonly { mode: GameMode; label: string; help: string }[] = [
  { mode: 'friendly', label: 'Friendly', help: 'One shootout against the CPU.' },
  { mode: 'cup', label: 'Cup', help: 'Quarter-final, semi-final, final against drawn opponents; keepers get better each round. Lose once and you are out.' },
  { mode: 'twoPlayer', label: '2 players', help: 'Two players, one keyboard: the shooter aims with the mouse, the keeper dives with the arrow keys. Swap each kick.' },
];

/**
 * Start and pause menu: pick a mode, the teams (from the invented list) and the CPU
 * keeper's level, then kick off; or resume the match in progress. Shows saved stats.
 * The game is paused while it is open.
 */
export class Menu {
  private readonly root = document.getElementById('menu') as HTMLDivElement;
  private readonly resume: HTMLButtonElement;
  private readonly modeButtons: HTMLButtonElement[] = [];
  private readonly modeHelp: HTMLParagraphElement;
  private readonly teamRows: Record<Side, { row: HTMLDivElement; label: HTMLDivElement; buttons: HTMLButtonElement[] }>;
  private readonly levelRow: HTMLDivElement;
  private readonly levelButtons: HTMLButtonElement[] = [];
  private readonly soundButton: HTMLButtonElement;
  private readonly timeButtons: HTMLButtonElement[] = [];
  private night = false;
  private readonly graphicsButtons: HTMLButtonElement[] = [];
  private lite: boolean;
  private readonly statsLine: HTMLDivElement;
  private readonly statsRow: HTMLDivElement;
  private muted: boolean;
  private choice: SessionChoice;

  constructor(
    initial: SessionChoice & { muted: boolean; lite: boolean },
    private readonly events: MenuEvents,
  ) {
    this.choice = { mode: initial.mode, teams: { ...initial.teams }, level: initial.level };
    this.muted = initial.muted;
    this.lite = initial.lite;

    const panel = el('div', 'menu-panel');
    const title = el('h1');
    title.textContent = 'Penalty Shootout';
    panel.append(title);

    const modeRow = row('Mode');
    const modes = el('div', 'menu-seg');
    for (const m of MODES) {
      const b = button('menu-mode', () => this.pick({ mode: m.mode }));
      b.textContent = m.label;
      this.modeButtons.push(b);
      modes.append(b);
    }
    this.modeHelp = el('p', 'menu-mode-help');
    modeRow.row.append(modes, this.modeHelp);
    panel.append(modeRow.row);

    const teamRow = (side: Side) => {
      const r = row('');
      const list = el('div', 'menu-teams');
      const buttons = TEAM_LIST.map((team) => {
        const b = button('menu-team', () => this.pickTeam(side, team));
        const swatch = el('span', 'menu-swatch');
        swatch.style.background = team.colour;
        b.append(swatch, team.name);
        list.append(b);
        return b;
      });
      r.row.append(list);
      panel.append(r.row);
      return { ...r, buttons };
    };
    this.teamRows = { player: teamRow('player'), cpu: teamRow('cpu') };

    const level = row('CPU keeper');
    this.levelRow = level.row;
    const seg = el('div', 'menu-seg');
    for (const l of LEVELS) {
      const b = button('menu-level', () => this.pick({ level: l }));
      b.textContent = l[0].toUpperCase() + l.slice(1);
      this.levelButtons.push(b);
      seg.append(b);
    }
    level.row.append(seg);
    panel.append(level.row);

    const sound = row('Sound (M)');
    this.soundButton = button('menu-sound', () => {
      this.setMuted(!this.muted);
      this.events.onSound(this.muted);
    });
    sound.row.append(this.soundButton);
    panel.append(sound.row);

    const time = row('Kick-off');
    const times = el('div', 'menu-seg');
    for (const night of [false, true]) {
      const b = button('menu-time', () => {
        this.night = night;
        this.events.onNight(night);
        this.refresh();
      });
      b.textContent = night ? 'Night (floodlights)' : 'Afternoon';
      this.timeButtons.push(b);
      times.append(b);
    }
    time.row.append(times);
    panel.append(time.row);

    const graphics = row('Graphics');
    const gfx = el('div', 'menu-seg');
    for (const lite of [false, true]) {
      const b = button('menu-graphics', () => {
        this.lite = lite;
        this.events.onLite(lite);
        this.refresh();
      });
      b.textContent = lite ? 'Lite (faster)' : 'Full';
      this.graphicsButtons.push(b);
      gfx.append(b);
    }
    graphics.row.append(gfx);
    panel.append(graphics.row);

    const stats = row('Your record');
    this.statsRow = stats.row;
    this.statsLine = el('div', 'menu-stats');
    const reset = button('menu-reset', () => this.events.onResetStats());
    reset.textContent = 'Reset';
    stats.row.append(this.statsLine, reset);
    panel.append(stats.row);

    const actions = el('div', 'menu-actions');
    this.resume = button('menu-resume', () => this.events.onResume());
    this.resume.textContent = 'Resume';
    const play = button('menu-play', () => this.events.onPlay({ ...this.choice, teams: { ...this.choice.teams } }));
    play.textContent = 'Kick off';
    actions.append(this.resume, play);
    panel.append(actions);

    const help = el('p', 'menu-help');
    help.textContent =
      'Shoot: aim with the mouse (or finger), hold to power up, release. W/A/S/D or tap the ball icon to add spin. ' +
      'In goal: arrow keys, or click/tap where to dive. Space replays a kick. Esc opens this menu.';
    panel.append(help);

    this.root.append(panel);
    this.refresh();
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  /** Show the menu; `canResume` offers to carry on with the match in progress. */
  open(canResume: boolean): void {
    this.resume.hidden = !canResume;
    this.root.hidden = false;
  }

  close(): void {
    this.root.hidden = true;
  }

  /** Reflect a mute change made elsewhere (the M key). */
  setMuted(muted: boolean): void {
    this.muted = muted;
    this.refresh();
  }

  /** Show the saved record, or hide the row before the first game. */
  setStats(summary: string | null): void {
    this.statsRow.hidden = summary === null;
    this.statsLine.textContent = summary ?? '';
  }

  private pick(change: Partial<SessionChoice>): void {
    this.choice = { ...this.choice, ...change };
    this.refresh();
  }

  private pickTeam(side: Side, team: Team): void {
    const other: Side = side === 'player' ? 'cpu' : 'player';
    // Picking the other side's team swaps them, so the two always differ.
    if (this.choice.teams[other] === team) this.choice.teams[other] = this.choice.teams[side];
    this.choice.teams[side] = team;
    this.refresh();
  }

  private refresh(): void {
    const mode = this.choice.mode;
    this.modeButtons.forEach((b, i) => b.classList.toggle('selected', MODES[i].mode === mode));
    this.modeHelp.textContent = MODES.find((m) => m.mode === mode)!.help;

    const labels: Record<GameMode, Record<Side, string>> = {
      friendly: { player: 'Your team', cpu: 'Opponent' },
      cup: { player: 'Your team', cpu: '' },
      twoPlayer: { player: 'Player 1', cpu: 'Player 2' },
    };
    for (const side of ['player', 'cpu'] as const) {
      const r = this.teamRows[side];
      r.label.textContent = labels[mode][side];
      r.buttons.forEach((b, i) => b.classList.toggle('selected', TEAM_LIST[i] === this.choice.teams[side]));
    }
    // The cup draws your opponents and sets each round's keeper; two players have no CPU.
    this.teamRows.cpu.row.hidden = mode === 'cup';
    this.levelRow.hidden = mode !== 'friendly';
    this.levelButtons.forEach((b, i) => b.classList.toggle('selected', LEVELS[i] === this.choice.level));

    this.timeButtons.forEach((b, i) => b.classList.toggle('selected', (i === 1) === this.night));
    this.graphicsButtons.forEach((b, i) => b.classList.toggle('selected', (i === 1) === this.lite));
    this.soundButton.textContent = this.muted ? 'Off' : 'On';
    this.soundButton.classList.toggle('selected', !this.muted);
  }
}

function row(label: string): { row: HTMLDivElement; label: HTMLDivElement } {
  const r = el('div', 'menu-row');
  const l = el('div', 'menu-label');
  l.textContent = label;
  r.append(l);
  return { row: r, label: l };
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  return e;
}

function button(className: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', className);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}
