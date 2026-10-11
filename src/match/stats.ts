import type { ShotOutcome } from '../shooting/outcome';
import type { Side } from './shootout';

/** The player's record against the CPU, kept in this browser between visits. */
export interface StatsData {
  played: number;
  won: number;
  streak: number;
  bestStreak: number;
  /** The player's penalties: taken and scored. */
  kicksTaken: number;
  goals: number;
  /** The CPU's penalties the player faced in goal, and saved. */
  kicksFaced: number;
  saves: number;
  cupsWon: number;
}

const KEY = 'penalty-shootout:stats';

const EMPTY: StatsData = {
  played: 0,
  won: 0,
  streak: 0,
  bestStreak: 0,
  kicksTaken: 0,
  goals: 0,
  kicksFaced: 0,
  saves: 0,
  cupsWon: 0,
};

/**
 * Lifetime stats for single-player games (two-player matches don't count). Stored in
 * localStorage when it is available; otherwise they last for the visit.
 */
export class Stats {
  data: StatsData;

  constructor() {
    this.data = load();
  }

  recordKick(shooter: Side, outcome: ShotOutcome): void {
    if (shooter === 'player') {
      this.data.kicksTaken++;
      if (outcome.kind === 'goal') this.data.goals++;
    } else {
      this.data.kicksFaced++;
      if (outcome.kind === 'saved') this.data.saves++;
    }
    this.save();
  }

  recordMatch(won: boolean): void {
    this.data.played++;
    if (won) {
      this.data.won++;
      this.data.streak++;
      this.data.bestStreak = Math.max(this.data.bestStreak, this.data.streak);
    } else {
      this.data.streak = 0;
    }
    this.save();
  }

  recordCupWin(): void {
    this.data.cupsWon++;
    this.save();
  }

  /** A one-line summary for the menu, or null before the first game. */
  summary(): string | null {
    const d = this.data;
    if (d.played === 0) return null;
    const pct = (n: number, of: number) => (of ? `${Math.round((100 * n) / of)}%` : '–');
    const parts = [
      `Won ${d.won} of ${d.played}`,
      `streak ${d.streak} (best ${d.bestStreak})`,
      `scored ${pct(d.goals, d.kicksTaken)}`,
      `saved ${pct(d.saves, d.kicksFaced)}`,
    ];
    if (d.cupsWon) parts.push(`${d.cupsWon} cup${d.cupsWon === 1 ? '' : 's'}`);
    return parts.join(' · ');
  }

  reset(): void {
    this.data = { ...EMPTY };
    this.save();
  }

  private save(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      // Storage unavailable (private mode, blocked): the stats just won't persist.
    }
  }
}

function load(): StatsData {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...EMPTY, ...(JSON.parse(raw) as Partial<StatsData>) };
  } catch {
    // Missing, unreadable or corrupt: start afresh.
  }
  return { ...EMPTY };
}
