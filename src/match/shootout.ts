import { SHOOTOUT_KICKS } from '../constants';

/** `player` is the human's team, `cpu` the computer's. */
export type Side = 'player' | 'cpu';

export function otherSide(side: Side): Side {
  return side === 'player' ? 'cpu' : 'player';
}

/**
 * Penalty shootout scoring rules, with no rendering or timing: the sides alternate,
 * five kicks each, stopping early once one side can't be caught, then sudden death
 * in pairs until a round ends with one side ahead.
 */
export class Shootout {
  /** Each side's kicks in order: true = scored. */
  readonly kicks: Record<Side, boolean[]> = { player: [], cpu: [] };

  constructor(readonly first: Side) {}

  /** Who takes the next kick: the side with fewer kicks, or whoever went first on a level count. */
  get next(): Side {
    const p = this.kicks.player.length;
    const c = this.kicks.cpu.length;
    if (p === c) return this.first;
    return p < c ? 'player' : 'cpu';
  }

  /** True once both sides have taken their regulation kicks and it is still level. */
  get suddenDeath(): boolean {
    return Math.min(this.kicks.player.length, this.kicks.cpu.length) >= SHOOTOUT_KICKS;
  }

  goals(side: Side): number {
    return this.kicks[side].filter(Boolean).length;
  }

  record(scored: boolean): void {
    if (this.winner) throw new Error('Shootout is already decided');
    this.kicks[this.next].push(scored);
  }

  /** The winning side, or null while the shootout is still alive. */
  get winner(): Side | null {
    const taken = { player: this.kicks.player.length, cpu: this.kicks.cpu.length };
    const goals = { player: this.goals('player'), cpu: this.goals('cpu') };

    if (taken.player <= SHOOTOUT_KICKS && taken.cpu <= SHOOTOUT_KICKS) {
      // Regulation: over as soon as one side can't catch up even if they score every
      // remaining kick and the other side misses all of theirs.
      const left = { player: SHOOTOUT_KICKS - taken.player, cpu: SHOOTOUT_KICKS - taken.cpu };
      if (goals.player > goals.cpu + left.cpu) return 'player';
      if (goals.cpu > goals.player + left.player) return 'cpu';
      return null;
    }

    // Sudden death: only decided at the end of a round, when both have kicked.
    if (taken.player === taken.cpu && goals.player !== goals.cpu) {
      return goals.player > goals.cpu ? 'player' : 'cpu';
    }
    return null;
  }
}
