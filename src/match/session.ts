import type { KeeperLevelName } from '../config';
import type { Keeper } from '../keeper/keeper';
import type { FinishBanner, Match } from './match';
import type { Shootout, Side } from './shootout';
import type { Stats } from './stats';
import { TEAM_LIST, TEAMS, type Team } from './teams';

export type GameMode = 'friendly' | 'cup' | 'twoPlayer' | 'online';

export interface SessionChoice {
  mode: GameMode;
  teams: Record<Side, Team>;
  level: KeeperLevelName;
}

/** The cup: three knockout rounds against drawn opponents, each keeper better than the last. */
export const CUP_ROUNDS: readonly { name: string; level: KeeperLevelName }[] = [
  { name: 'Quarter-final', level: 'easy' },
  { name: 'Semi-final', level: 'normal' },
  { name: 'Final', level: 'hard' },
];

export interface SessionHooks {
  /** The CPU keeper's level changed (a new cup round); null when there is no CPU keeper. */
  onLevel: (level: KeeperLevelName | null) => void;
  /** Back to the menu (the cup is over). */
  openMenu: () => void;
}

/**
 * What the player chose to play, across shootouts: a friendly against the CPU (rematch on
 * click), two players on one keyboard or on two devices, or a cup run. Records stats
 * against the CPU.
 */
export class Session {
  mode: GameMode = 'friendly';
  private cup: { opponents: Team[]; round: number; lost: boolean } | null = null;

  constructor(
    private readonly match: Match,
    private readonly keeper: Keeper,
    private readonly stats: Stats,
    private readonly hooks: SessionHooks,
  ) {
    match.events = {
      onKick: (shooter, outcome) => {
        if (this.againstCpu) this.stats.recordKick(shooter, outcome);
      },
      onFinish: (winner, shootout) => this.finish(winner, shootout),
      onContinue: () => this.continue(),
    };
  }

  private get againstCpu(): boolean {
    return this.mode === 'friendly' || this.mode === 'cup';
  }

  begin(choice: SessionChoice): void {
    this.mode = choice.mode;
    TEAMS.player = choice.teams.player;
    if (choice.mode === 'cup') {
      // Draw three different opponents for the three rounds.
      const others = shuffle(TEAM_LIST.filter((t) => t !== choice.teams.player));
      this.cup = { opponents: others.slice(0, CUP_ROUNDS.length), round: 0, lost: false };
      this.startCupRound();
      return;
    }
    this.cup = null;
    TEAMS.cpu = choice.teams.cpu;
    this.setLevel(choice.level);
    if (!this.againstCpu) this.hooks.onLevel(null);
    this.match.restart(choice.mode === 'online' ? { twoPlayer: false, online: true } : { twoPlayer: choice.mode === 'twoPlayer' });
  }

  private startCupRound(): void {
    const cup = this.cup!;
    const round = CUP_ROUNDS[cup.round];
    TEAMS.cpu = cup.opponents[cup.round];
    this.setLevel(round.level);
    this.match.restart({ twoPlayer: false, introTitle: `${round.name} · v ${TEAMS.cpu.name}` });
  }

  private setLevel(level: KeeperLevelName): void {
    this.keeper.level = level;
    this.hooks.onLevel(level);
  }

  private finish(winner: Side, shootout: Shootout): FinishBanner | void {
    if (!this.againstCpu) return;
    const won = winner === 'player';
    this.stats.recordMatch(won);
    const cup = this.cup;
    if (this.mode !== 'cup' || !cup) return;

    const score = `${shootout.goals('player')}–${shootout.goals('cpu')}`;
    const round = CUP_ROUNDS[cup.round];
    if (!won) {
      cup.lost = true;
      return { title: 'Knocked out', detail: `${score} in the ${round.name.toLowerCase()} · click for the menu`, good: false };
    }
    if (cup.round === CUP_ROUNDS.length - 1) {
      this.stats.recordCupWin();
      return { title: 'Cup winners!', detail: `${score} in the final · click for the menu`, good: true };
    }
    const next = CUP_ROUNDS[cup.round + 1];
    return {
      title: `Through to the ${next.name.toLowerCase()}!`,
      detail: `${score} · click to face ${cup.opponents[cup.round + 1].name}`,
      good: true,
    };
  }

  private continue(): void {
    const cup = this.cup;
    if (this.mode === 'cup' && cup) {
      if (cup.lost || cup.round === CUP_ROUNDS.length - 1) {
        this.cup = null;
        this.hooks.openMenu();
        return;
      }
      cup.round++;
      this.startCupRound();
      return;
    }
    this.match.restart();
  }
}

function shuffle<T>(items: T[]): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
