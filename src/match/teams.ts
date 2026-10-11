import * as THREE from 'three';
import type { Side } from './shootout';

export interface Team {
  name: string;
  /** Shirt colour (CSS), also used for the team on the scoreboard. */
  colour: string;
  shorts: number;
  socks: number;
  /** Goalkeeper shirt, and a second choice for when it is too close to the other side's kit. */
  keeperShirt: number;
  keeperAlt: number;
  /** Skin tone of the team's penalty taker. */
  skin: number;
}

// Invented teams only: no real clubs, crests or kits.
export const TEAM_LIST: readonly Team[] = [
  { name: 'Harbour Town', colour: '#3fa9f5', shorts: 0xf2f2f2, socks: 0x3fa9f5, keeperShirt: 0x9be22d, keeperAlt: 0x222222, skin: 0xd7a37c },
  { name: 'Copper Vale', colour: '#e8743b', shorts: 0xf2f2f2, socks: 0xe8743b, keeperShirt: 0x6a5acd, keeperAlt: 0x9be22d, skin: 0x9a6a48 },
  { name: 'Kestrel Bay', colour: '#6a4c93', shorts: 0x1b1b1f, socks: 0x6a4c93, keeperShirt: 0xffd60a, keeperAlt: 0x2ec4b6, skin: 0xe0b48f },
  { name: 'Thornfield Comets', colour: '#d62828', shorts: 0xf2f2f2, socks: 0xf2f2f2, keeperShirt: 0x2ec4b6, keeperAlt: 0xffd60a, skin: 0x7a4e32 },
  { name: 'Glasswater', colour: '#2a9d8f', shorts: 0x14213d, socks: 0x2a9d8f, keeperShirt: 0xff70a6, keeperAlt: 0xffd60a, skin: 0xc68e66 },
  { name: 'Lumen City', colour: '#f4d35e', shorts: 0x1b1b1f, socks: 0x1b1b1f, keeperShirt: 0xe63946, keeperAlt: 0x6a5acd, skin: 0xb27a54 },
];

/** The current matchup. The menu sets it before each match; everything else reads it. */
export const TEAMS: Record<Side, Team> = { player: TEAM_LIST[0], cpu: TEAM_LIST[1] };

/** The keeper's shirt for `team` facing `opponent`: the first choice unless it is too close in colour. */
export function keeperShirt(team: Team, opponent: Team): number {
  const against = new THREE.Color(opponent.colour);
  const distance = (hex: number) => {
    const c = new THREE.Color(hex);
    return Math.hypot(c.r - against.r, c.g - against.g, c.b - against.b);
  };
  return distance(team.keeperShirt) > 0.45 ? team.keeperShirt : team.keeperAlt;
}
