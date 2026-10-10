import { TUNING } from '../config';
import type { PointerInput } from '../input/pointer';
import type { Keeper } from '../keeper/keeper';
import type { KeeperMesh } from '../keeper/mesh';
import { describeOutcome } from '../shooting/outcome';
import type { Hud } from '../ui/hud';
import type { Kick } from './kick';
import { otherSide, Shootout, type Side } from './shootout';
import { TEAMS } from './teams';

export type MatchState =
  | { kind: 'intro'; elapsed: number }
  | { kind: 'kicking' }
  | { kind: 'finished'; winner: Side; elapsed: number };

/**
 * A whole shootout: Intro → Kicking (one Kick per penalty, alternating sides) → Finished.
 * Owns the shootout score and drives the kick, keeper and HUD between penalties.
 */
export class Match {
  state: MatchState = { kind: 'intro', elapsed: 0 };
  shootout: Shootout;

  constructor(
    private readonly kick: Kick,
    private readonly keeper: Keeper,
    private readonly keeperMesh: KeeperMesh,
    private readonly input: PointerInput,
    private readonly hud: Hud,
  ) {
    kick.events = {
      onShot: (shot) => {
        this.hud.setStatus('');
        this.keeper.react(shot);
      },
      onResult: (outcome, launchSpeed) => {
        const team = TEAMS[this.kick.shooter].name;
        this.hud.showResult(describeOutcome(outcome), `${team} · ${Math.round(launchSpeed * 3.6)} km/h`, outcome.kind === 'goal');
      },
      onDone: (outcome) => this.kickDone(outcome.kind === 'goal'),
    };
    this.shootout = this.newShootout();
  }

  /** Start a new shootout from the coin toss. */
  restart(): void {
    this.shootout = this.newShootout();
  }

  step(dt: number): void {
    const s = this.state;
    switch (s.kind) {
      case 'intro':
        s.elapsed += dt;
        if ((this.input.consumePress() && s.elapsed > 0.4) || s.elapsed > TUNING.match.introDuration) {
          this.hud.hideResult();
          this.state = { kind: 'kicking' };
          this.startKick();
        }
        break;

      case 'kicking':
        this.kick.step(dt);
        break;

      case 'finished':
        s.elapsed += dt;
        if (this.input.consumePress() && s.elapsed > 1.0) this.restart();
        break;
    }
  }

  private newShootout(): Shootout {
    const first: Side = Math.random() < 0.5 ? 'player' : 'cpu';
    const shootout = new Shootout(first);
    this.kick.stop();
    this.keeper.reset();
    this.keeperMesh.setShirt(TEAMS[otherSide(first)].keeperShirt);
    this.input.consumePress();
    this.state = { kind: 'intro', elapsed: 0 };
    this.hud.setScoreboard(shootout, TEAMS);
    this.hud.setStatus('');
    this.hud.showResult(
      'Penalty shootout',
      first === 'player' ? 'You won the toss: you shoot first' : `${TEAMS.cpu.name} shoot first`,
      false,
    );
    return shootout;
  }

  private startKick(): void {
    const shooter = this.shootout.next;
    this.keeper.reset();
    // The keeper in goal belongs to the side that isn't shooting.
    this.keeperMesh.setShirt(TEAMS[otherSide(shooter)].keeperShirt);
    this.kick.start(shooter);
    this.hud.setScoreboard(this.shootout, TEAMS);
    const prefix = this.shootout.suddenDeath ? 'Sudden death · ' : '';
    this.hud.setStatus(
      shooter === 'player'
        ? `${prefix}Your kick · aim with the mouse, hold to power up, release to shoot`
        : `${prefix}${TEAMS.cpu.name} to shoot…`,
    );
  }

  private kickDone(scored: boolean): void {
    this.hud.hideResult();
    this.shootout.record(scored);
    this.hud.setScoreboard(this.shootout, TEAMS);

    const winner = this.shootout.winner;
    if (!winner) {
      this.startKick();
      return;
    }
    this.state = { kind: 'finished', winner, elapsed: 0 };
    this.kick.stop();
    this.keeper.reset();
    const score = `${this.shootout.goals('player')}–${this.shootout.goals('cpu')}`;
    this.hud.setStatus('');
    this.hud.showResult(
      winner === 'player' ? 'You win!' : `${TEAMS.cpu.name} win`,
      `${score} on penalties · click to play again`,
      winner === 'player',
    );
  }
}
