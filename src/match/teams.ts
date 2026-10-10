import type { Side } from './shootout';

export interface Team {
  name: string;
  /** Team colour for the scoreboard. */
  colour: string;
  /** Goalkeeper shirt colour. */
  keeperShirt: number;
}

// Invented teams only. Milestone 7 adds a team select.
export const TEAMS: Record<Side, Team> = {
  player: { name: 'Harbour Town', colour: '#3fa9f5', keeperShirt: 0x9be22d },
  cpu: { name: 'Copper Vale', colour: '#e8743b', keeperShirt: 0xff7a1a },
};
