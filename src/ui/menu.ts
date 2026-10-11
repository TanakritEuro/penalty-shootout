import type { KeeperLevelName } from '../config';
import type { Side } from '../match/shootout';
import { TEAM_LIST, type Team } from '../match/teams';

export interface MenuChoice {
  teams: Record<Side, Team>;
  level: KeeperLevelName;
}

export interface MenuEvents {
  /** Start a new match with these teams and CPU keeper level. */
  onPlay: (choice: MenuChoice) => void;
  /** Close the menu and carry on with the match in progress. */
  onResume: () => void;
  /** Sound switched on or off. */
  onSound: (muted: boolean) => void;
}

const LEVELS: readonly KeeperLevelName[] = ['easy', 'normal', 'hard'];

/**
 * Start and pause menu: pick both teams (from the invented list), the CPU keeper's level,
 * then kick off; or resume the match in progress. The game is paused while it is open.
 */
export class Menu {
  private readonly root = document.getElementById('menu') as HTMLDivElement;
  private readonly resume: HTMLButtonElement;
  private readonly teamButtons: Record<Side, HTMLButtonElement[]> = { player: [], cpu: [] };
  private readonly levelButtons: HTMLButtonElement[] = [];
  private readonly soundButton: HTMLButtonElement;
  private muted: boolean;
  private choice: MenuChoice;

  constructor(
    initial: MenuChoice & { muted: boolean },
    private readonly events: MenuEvents,
  ) {
    this.choice = { teams: { ...initial.teams }, level: initial.level };
    this.muted = initial.muted;

    const panel = el('div', 'menu-panel');
    const title = el('h1');
    title.textContent = 'Penalty Shootout';
    panel.append(title);

    for (const side of ['player', 'cpu'] as const) {
      const row = el('div', 'menu-row');
      const label = el('div', 'menu-label');
      label.textContent = side === 'player' ? 'Your team' : 'Opponent';
      const list = el('div', 'menu-teams');
      for (const team of TEAM_LIST) {
        const b = button('menu-team', () => this.pickTeam(side, team));
        const swatch = el('span', 'menu-swatch');
        swatch.style.background = team.colour;
        b.append(swatch, team.name);
        this.teamButtons[side].push(b);
        list.append(b);
      }
      row.append(label, list);
      panel.append(row);
    }

    const levelRow = el('div', 'menu-row');
    const levelLabel = el('div', 'menu-label');
    levelLabel.textContent = 'CPU keeper';
    const seg = el('div', 'menu-seg');
    for (const level of LEVELS) {
      const b = button('menu-level', () => this.pickLevel(level));
      b.textContent = level[0].toUpperCase() + level.slice(1);
      this.levelButtons.push(b);
      seg.append(b);
    }
    levelRow.append(levelLabel, seg);
    panel.append(levelRow);

    const soundRow = el('div', 'menu-row');
    const soundLabel = el('div', 'menu-label');
    soundLabel.textContent = 'Sound (M)';
    this.soundButton = button('menu-sound', () => {
      this.setMuted(!this.muted);
      this.events.onSound(this.muted);
    });
    soundRow.append(soundLabel, this.soundButton);
    panel.append(soundRow);

    const actions = el('div', 'menu-actions');
    this.resume = button('menu-resume', () => this.events.onResume());
    this.resume.textContent = 'Resume';
    const play = button('menu-play', () => this.events.onPlay({ teams: { ...this.choice.teams }, level: this.choice.level }));
    play.textContent = 'Kick off';
    actions.append(this.resume, play);
    panel.append(actions);

    const help = el('p', 'menu-help');
    help.textContent =
      'Shoot: aim with the mouse (or finger), hold to power up, release. W/A/S/D or tap the ball icon to add spin. ' +
      'In goal: arrow keys, or click/tap where to dive. Esc opens this menu.';
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

  private pickTeam(side: Side, team: Team): void {
    const other: Side = side === 'player' ? 'cpu' : 'player';
    // Picking the other side's team swaps them, so the two always differ.
    if (this.choice.teams[other] === team) this.choice.teams[other] = this.choice.teams[side];
    this.choice.teams[side] = team;
    this.refresh();
  }

  private pickLevel(level: KeeperLevelName): void {
    this.choice.level = level;
    this.refresh();
  }

  private refresh(): void {
    for (const side of ['player', 'cpu'] as const) {
      this.teamButtons[side].forEach((b, i) => b.classList.toggle('selected', TEAM_LIST[i] === this.choice.teams[side]));
    }
    this.levelButtons.forEach((b, i) => b.classList.toggle('selected', LEVELS[i] === this.choice.level));
    this.soundButton.textContent = this.muted ? 'Off' : 'On';
    this.soundButton.classList.toggle('selected', !this.muted);
  }
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
