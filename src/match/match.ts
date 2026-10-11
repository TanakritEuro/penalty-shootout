import * as THREE from 'three';
import type { Director } from '../camera/director';
import { TUNING } from '../config';
import { GOAL_HEIGHT, GOAL_WIDTH } from '../constants';
import type { KeeperKeys } from '../input/keeperKeys';
import type { PointerInput } from '../input/pointer';
import type { Keeper } from '../keeper/keeper';
import type { KeeperMesh } from '../keeper/mesh';
import { aimFromPointer } from '../shooting/aim';
import { describeOutcome } from '../shooting/outcome';
import type { Hud } from '../ui/hud';
import type { Kick } from './kick';
import { otherSide, Shootout, type Side } from './shootout';
import { keeperShirt, TEAMS } from './teams';

export type MatchState =
  | { kind: 'intro'; elapsed: number }
  | { kind: 'kicking' }
  | { kind: 'finished'; winner: Side; elapsed: number };

/**
 * A whole shootout: Intro → Kicking (one Kick per penalty, alternating sides) → Finished.
 * Owns the shootout score and drives the kick, keeper and HUD between penalties. On the
 * CPU's kicks the player keeps goal.
 */
export class Match {
  state: MatchState = { kind: 'intro', elapsed: 0 };
  shootout: Shootout;
  /** Where the player's keeper would dive if they clicked now (on the CPU's kicks). */
  readonly keeperAim = new THREE.Vector2(0, 1);
  /** The player dived early on this kick and the kicker went the other way. */
  private wentEarly = false;

  constructor(
    private readonly kick: Kick,
    private readonly keeper: Keeper,
    private readonly keeperMesh: KeeperMesh,
    private readonly input: PointerInput,
    private readonly keys: KeeperKeys,
    private readonly camera: THREE.Camera,
    private readonly hud: Hud,
    private readonly director: Director,
  ) {
    kick.events = {
      onShot: (shot) => {
        this.hud.setStatus('');
        this.keeper.react(shot);
        this.director.onShot(shot);
      },
      onResult: (outcome, launchSpeed) => {
        const shooter = this.kick.shooter;
        const scored = outcome.kind === 'goal';
        let detail = `${TEAMS[shooter].name} · ${Math.round(launchSpeed * 3.6)} km/h`;
        if (shooter === 'cpu' && scored && this.wentEarly) detail += ' · you went too early';
        // Gold for whatever is good news for the player: their goals and their saves.
        this.hud.showResult(describeOutcome(outcome), detail, shooter === 'player' ? scored : !scored);
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
        // Before the kick steps, so a click is a dive rather than being swallowed by the run-up.
        if (this.kick.shooter === 'cpu') this.controlKeeper(dt);
        this.kick.step(dt);
        break;

      case 'finished':
        s.elapsed += dt;
        if (this.input.consumePress() && s.elapsed > 1.0) this.restart();
        break;
    }
  }

  /** True while the player can still dive on a CPU kick: show the dive reticle. */
  get keeperAiming(): boolean {
    const k = this.kick.state.kind;
    return (
      this.state.kind === 'kicking' &&
      this.kick.shooter === 'cpu' &&
      this.keeper.ready &&
      !this.director.cutAway &&
      (k === 'cpuRunUp' || k === 'ballInFlight')
    );
  }

  /** The player is in goal: track the dive reticle and dive on an arrow key or a click. */
  private controlKeeper(dt: number): void {
    if (!this.keeperAiming) {
      this.keys.clear();
      return;
    }
    aimFromPointer(this.input.ndc, this.camera, this.keeperAim);
    this.keeperAim.x = THREE.MathUtils.clamp(this.keeperAim.x, -GOAL_WIDTH / 2, GOAL_WIDTH / 2);
    this.keeperAim.y = Math.min(this.keeperAim.y, GOAL_HEIGHT);

    const keyDive = this.keys.consumeDive(dt);
    // Arrow keys follow the screen: looking out from behind the keeper, screen left is +x.
    if (keyDive && this.director.keeperView) keyDive.x = -keyDive.x;
    const target = keyDive ?? (this.input.consumePress() ? { x: this.keeperAim.x, y: this.keeperAim.y } : null);
    if (!target) return;
    this.keeper.playerDive(target.x, target.y);
    this.wentEarly = this.kick.keeperCommitted(target.x);
  }

  private newShootout(): Shootout {
    const first: Side = Math.random() < 0.5 ? 'player' : 'cpu';
    const shootout = new Shootout(first);
    this.kick.stop(first);
    this.keeper.reset();
    this.director.reset();
    this.keeperMesh.setShirt(keeperShirt(TEAMS[otherSide(first)], TEAMS[first]));
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
    this.director.reset(shooter === 'cpu' ? 'keeper' : 'main');
    // The keeper in goal belongs to the side that isn't shooting; on the CPU's kicks that's you.
    this.keeper.controlledByPlayer = shooter === 'cpu';
    this.keeperMesh.setShirt(keeperShirt(TEAMS[otherSide(shooter)], TEAMS[shooter]));
    this.keys.clear();
    this.wentEarly = false;
    this.kick.start(shooter);
    this.hud.setScoreboard(this.shootout, TEAMS);
    const prefix = this.shootout.suddenDeath ? 'Sudden death · ' : '';
    this.hud.setStatus(
      shooter === 'player'
        ? `${prefix}Your kick · aim with the mouse, hold to power up, release to shoot`
        : `${prefix}You're in goal · dive with the arrow keys, or click where to dive`,
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
