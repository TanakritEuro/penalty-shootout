import { describe, expect, it, vi } from 'vitest';
import type { Keeper } from '../src/keeper/keeper';
import type { FinishBanner, Match, MatchEvents, MatchSetup } from '../src/match/match';
import { CUP_ROUNDS, Session } from '../src/match/session';
import { Shootout } from '../src/match/shootout';
import { Stats } from '../src/match/stats';
import { TEAM_LIST, TEAMS } from '../src/match/teams';

/** Just enough of a Match for the Session: it records restarts and exposes its events. */
function fakeMatch() {
  const restarts: MatchSetup[] = [];
  const match = { events: {} as MatchEvents, restart: (setup?: MatchSetup) => restarts.push(setup ?? restarts[restarts.length - 1]) };
  return { match: match as unknown as Match, restarts, events: () => match.events };
}

/** A finished shootout the player won (or lost): one side scores everything, the other nothing. */
function shootout(playerWon: boolean): Shootout {
  const s = new Shootout('player');
  while (!s.winner) s.record((s.next === 'player') === playerWon);
  return s;
}

function setup() {
  const { match, restarts, events } = fakeMatch();
  const keeper = { level: 'normal' } as Keeper;
  const stats = new Stats();
  stats.reset();
  const hooks = { onLevel: vi.fn(), openMenu: vi.fn() };
  const session = new Session(match, keeper, stats, hooks);
  return { session, restarts, events, keeper, stats, hooks };
}

describe('Session: cup', () => {
  it('runs three rounds against three different drawn opponents, keepers getting better', () => {
    const { session, restarts, events, keeper, stats, hooks } = setup();
    session.begin({ mode: 'cup', teams: { player: TEAM_LIST[0], cpu: TEAM_LIST[1] }, level: 'easy' });

    const opponents = new Set();
    for (let round = 0; round < CUP_ROUNDS.length; round++) {
      expect(restarts.at(-1)?.introTitle).toContain(CUP_ROUNDS[round].name);
      expect(keeper.level).toBe(CUP_ROUNDS[round].level);
      expect(TEAMS.cpu).not.toBe(TEAMS.player);
      opponents.add(TEAMS.cpu);
      const banner = events().onFinish!('player', shootout(true)) as FinishBanner;
      if (round < CUP_ROUNDS.length - 1) {
        expect(banner.title).toBe(`Through to the ${CUP_ROUNDS[round + 1].name.toLowerCase()}!`);
        events().onContinue!();
      } else {
        expect(banner.title).toBe('Cup winners!');
      }
    }
    expect(opponents.size).toBe(3);
    expect(stats.data).toMatchObject({ played: 3, won: 3, streak: 3, cupsWon: 1 });
    events().onContinue!();
    expect(hooks.openMenu).toHaveBeenCalledOnce();
  });

  it('ends the cup on the first defeat', () => {
    const { session, events, stats, hooks } = setup();
    session.begin({ mode: 'cup', teams: { player: TEAM_LIST[2], cpu: TEAM_LIST[3] }, level: 'easy' });
    events().onFinish!('player', shootout(true));
    events().onContinue!(); // into the semi-final
    const banner = events().onFinish!('cpu', shootout(false)) as FinishBanner;
    expect(banner.title).toBe('Knocked out');
    expect(banner.detail).toContain('semi-final');
    events().onContinue!();
    expect(hooks.openMenu).toHaveBeenCalledOnce();
    expect(stats.data).toMatchObject({ played: 2, won: 1, streak: 0, cupsWon: 0 });
  });
});

describe('Session: friendly and two players', () => {
  it('a friendly rematches on continue and counts towards the stats', () => {
    const { session, restarts, events, stats } = setup();
    session.begin({ mode: 'friendly', teams: { player: TEAM_LIST[0], cpu: TEAM_LIST[1] }, level: 'hard' });
    expect(restarts.at(-1)).toEqual({ twoPlayer: false });
    expect(events().onFinish!('player', shootout(true))).toBeUndefined(); // the default banner
    events().onContinue!();
    expect(restarts).toHaveLength(2);
    expect(stats.data.played).toBe(1);
  });

  it('two-player games are not counted, and there is no CPU keeper', () => {
    const { session, restarts, events, stats, hooks } = setup();
    session.begin({ mode: 'twoPlayer', teams: { player: TEAM_LIST[0], cpu: TEAM_LIST[1] }, level: 'normal' });
    expect(restarts.at(-1)).toEqual({ twoPlayer: true });
    expect(hooks.onLevel).toHaveBeenLastCalledWith(null);
    events().onKick!('player', { kind: 'goal', woodwork: null, keeperTouch: false });
    events().onFinish!('cpu', shootout(false));
    expect(stats.data).toMatchObject({ played: 0, kicksTaken: 0 });
  });

  it('online games are not counted either, and rematch on continue', () => {
    const { session, restarts, events, stats, hooks } = setup();
    session.begin({ mode: 'online', teams: { player: TEAM_LIST[2], cpu: TEAM_LIST[3] }, level: 'normal' });
    expect(restarts.at(-1)).toEqual({ twoPlayer: false, online: true });
    expect(hooks.onLevel).toHaveBeenLastCalledWith(null);
    events().onKick!('cpu', { kind: 'goal', woodwork: null, keeperTouch: false });
    expect(events().onFinish!('player', shootout(true))).toBeUndefined();
    events().onContinue!();
    expect(restarts.at(-1)).toEqual({ twoPlayer: false, online: true });
    expect(stats.data).toMatchObject({ played: 0, kicksTaken: 0 });
  });
});
