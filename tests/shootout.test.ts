import { describe, expect, it } from 'vitest';
import { Shootout, type Side } from '../src/match/shootout';

/** Play kicks in order ('1' = scored, '0' = missed) and report when it was decided. */
function play(first: Side, kicks: string): { winner: Side | null; decidedAfter: number | null; shootout: Shootout } {
  const shootout = new Shootout(first);
  for (let i = 0; i < kicks.length; i++) {
    shootout.record(kicks[i] === '1');
    if (shootout.winner) return { winner: shootout.winner, decidedAfter: i + 1, shootout };
  }
  return { winner: null, decidedAfter: null, shootout };
}

describe('Shootout', () => {
  it('alternates, starting with whoever won the toss', () => {
    const s = new Shootout('cpu');
    const order: Side[] = [];
    for (let i = 0; i < 4; i++) {
      order.push(s.next);
      s.record(true);
    }
    expect(order).toEqual(['cpu', 'player', 'cpu', 'player']);
  });

  it.each([
    // [first, kicks taken in order, winner, decided after this many kicks]
    ['player', '1111111111', null, null], // 5-5, still level
    ['player', '10101', null, null], // 3-0 but the CPU still has three to take
    ['player', '101010', 'player', 6], // 3-0 and only two left: can't catch up
    ['cpu', '101010', 'cpu', 6],
    ['player', '11111010', 'player', 8], // 4-2, one left
    ['player', '10101110', 'player', 7], // 4-1 with two left: over before the 8th kick
    ['player', '1111111110', 'player', 10], // decided on the very last regulation kick
    ['player', '01111111', null, null], // 3-4 with one each to come: still alive
  ] as const)('first=%s kicks=%s -> %s after %s', (first, kicks, winner, after) => {
    const r = play(first, kicks);
    expect(r.winner).toBe(winner);
    expect(r.decidedAfter).toBe(after);
  });

  it('goes to sudden death after five each, decided only at the end of a round', () => {
    expect(play('player', '1111111111' + '1').winner).toBeNull(); // player scores, CPU yet to kick
    expect(play('player', '1111111111' + '10')).toMatchObject({ winner: 'player', decidedAfter: 12 });
    expect(play('player', '1111111111' + '01')).toMatchObject({ winner: 'cpu', decidedAfter: 12 });
    expect(play('player', '1111111111' + '11' + '01')).toMatchObject({ winner: 'cpu', decidedAfter: 14 });
    expect(play('cpu', '0000000000' + '01')).toMatchObject({ winner: 'player', decidedAfter: 12 });
  });

  it('flags sudden death once both sides have taken five', () => {
    const s = new Shootout('player');
    for (let i = 0; i < 9; i++) s.record(true);
    expect(s.suddenDeath).toBe(false);
    s.record(true);
    expect(s.suddenDeath).toBe(true);
  });

  it('refuses kicks after it is decided', () => {
    const { shootout } = play('player', '101010');
    expect(() => shootout.record(true)).toThrow();
  });
});
