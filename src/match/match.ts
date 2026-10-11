import * as THREE from 'three';
import type { Sound } from '../audio/sound';
import type { Director } from '../camera/director';
import { TUNING } from '../config';
import { GOAL_HEIGHT, GOAL_WIDTH } from '../constants';
import type { KeeperKeys } from '../input/keeperKeys';
import type { PointerInput } from '../input/pointer';
import type { Keeper } from '../keeper/keeper';
import type { KeeperMesh } from '../keeper/mesh';
import { aimFromPointer } from '../shooting/aim';
import { describeOutcome, type ShotOutcome } from '../shooting/outcome';
import type { Hud } from '../ui/hud';
import type { Kick } from './kick';
import { otherSide, Shootout, type Side } from './shootout';
import { keeperShirt, TEAMS } from './teams';

export type MatchState =
  | { kind: 'intro'; elapsed: number }
  | { kind: 'kicking' }
  | { kind: 'finished'; winner: Side; elapsed: number };

export interface MatchSetup {
  /** Both sides human on one keyboard: the shooter uses the mouse, the keeper the arrow keys. */
  twoPlayer: boolean;
  /** Banner before the first kick, e.g. the cup round. */
  introTitle?: string;
}

export interface FinishBanner {
  title: string;
  detail: string;
  good: boolean;
}

export interface MatchEvents {
  /** Every penalty, as it is decided. */
  onKick?: (shooter: Side, outcome: ShotOutcome) => void;
  /** The shootout is over: what to show (defaults to a plain win/lose banner). */
  onFinish?: (winner: Side, shootout: Shootout) => FinishBanner | void;
  /** The player clicked on after the result (defaults to a rematch). */
  onContinue?: () => void;
}

/**
 * A whole shootout: Intro → Kicking (one Kick per penalty, alternating sides) → Finished.
 * Owns the shootout score and drives the kick, keeper and HUD between penalties.
 *
 * Against the CPU, the player shoots for `player` and keeps goal on the CPU's kicks. In
 * two-player mode both sides are human: whoever is shooting has the mouse and whoever is
 * in goal has the arrow keys.
 */
export class Match {
  state: MatchState = { kind: 'intro', elapsed: 0 };
  shootout: Shootout;
  events: MatchEvents = {};
  /** Where a human keeper would dive if they clicked now (only when the CPU is shooting). */
  readonly keeperAim = new THREE.Vector2(0, 1);
  private setup: MatchSetup = { twoPlayer: false };
  /** The player dived early on this kick and the CPU kicker went the other way. */
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
    private readonly sound: Sound,
  ) {
    kick.events = {
      onShot: (shot) => {
        this.sound.kick(shot.launchSpeed);
        this.hud.setStatus('');
        this.keeper.react(shot);
        this.director.onShot(shot);
      },
      onResult: (outcome, launchSpeed) => this.showResult(outcome, launchSpeed),
      onDone: (outcome) => this.kickDone(outcome.kind === 'goal'),
    };
    this.shootout = this.newShootout();
  }

  get twoPlayer(): boolean {
    return this.setup.twoPlayer;
  }

  /** Start a new shootout from the coin toss, optionally with a new setup. */
  restart(setup: MatchSetup = this.setup): void {
    this.setup = setup;
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
        if (this.keeperIsHuman(this.kick.shooter)) this.controlKeeper(dt);
        this.kick.step(dt);
        break;

      case 'finished':
        s.elapsed += dt;
        if (this.input.consumePress() && s.elapsed > 1.0) {
          if (this.events.onContinue) this.events.onContinue();
          else this.restart();
        }
        break;
    }
  }

  /** True while a human keeper can still dive with the mouse: show the dive reticle. */
  get keeperAiming(): boolean {
    return this.keeperCanDive && !this.isHuman(this.kick.shooter);
  }

  /** A human is in goal, hasn't dived yet and the kick is live. */
  private get keeperCanDive(): boolean {
    const k = this.kick.state.kind;
    return (
      this.state.kind === 'kicking' &&
      this.keeperIsHuman(this.kick.shooter) &&
      this.keeper.ready &&
      !this.director.cutAway &&
      k !== 'result' &&
      k !== 'nextKick'
    );
  }

  private isHuman(side: Side): boolean {
    return this.setup.twoPlayer || side === 'player';
  }

  private keeperIsHuman(shooter: Side): boolean {
    return this.isHuman(otherSide(shooter));
  }

  /** A human is in goal: dive on an arrow key, or a click when the mouse is free (CPU shooting). */
  private controlKeeper(dt: number): void {
    if (!this.keeperCanDive) {
      this.keys.clear();
      return;
    }
    const keyDive = this.keys.consumeDive(dt);
    // Arrow keys follow the screen: looking out from behind the keeper, screen left is +x.
    if (keyDive && this.director.keeperView) keyDive.x = -keyDive.x;

    let target = keyDive;
    if (this.keeperAiming) {
      aimFromPointer(this.input.ndc, this.camera, this.keeperAim);
      this.keeperAim.x = THREE.MathUtils.clamp(this.keeperAim.x, -GOAL_WIDTH / 2, GOAL_WIDTH / 2);
      this.keeperAim.y = Math.min(this.keeperAim.y, GOAL_HEIGHT);
      if (!target && this.input.consumePress()) target = { x: this.keeperAim.x, y: this.keeperAim.y };
    }
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
    const toss =
      first === 'player' && !this.setup.twoPlayer ? 'You won the toss: you shoot first' : `${TEAMS[first].name} shoot first`;
    this.hud.showResult(this.setup.introTitle ?? 'Penalty shootout', toss, false);
    return shootout;
  }

  private startKick(): void {
    const shooter = this.shootout.next;
    const keeperHuman = this.keeperIsHuman(shooter);
    this.keeper.reset();
    // Looking out from behind the goal only helps a human keeper read a CPU kicker.
    this.director.reset(keeperHuman && !this.isHuman(shooter) ? 'keeper' : 'main');
    this.keeper.controlledByPlayer = keeperHuman;
    this.keeperMesh.setShirt(keeperShirt(TEAMS[otherSide(shooter)], TEAMS[shooter]));
    this.keys.clear();
    this.wentEarly = false;
    this.sound.whistle();
    this.kick.start(shooter, this.isHuman(shooter));
    this.hud.setScoreboard(this.shootout, TEAMS);
    const prefix = this.shootout.suddenDeath ? 'Sudden death · ' : '';
    if (this.setup.twoPlayer) {
      const keeperTeam = TEAMS[otherSide(shooter)].name;
      this.hud.setStatus(`${prefix}${TEAMS[shooter].name} shoot (mouse) · ${keeperTeam} in goal (arrow keys)`);
    } else {
      this.hud.setStatus(
        shooter === 'player'
          ? `${prefix}Your kick · aim, hold to power up, release to shoot`
          : `${prefix}You're in goal · arrow keys, or click / tap where to dive`,
      );
    }
  }

  private showResult(outcome: ShotOutcome, launchSpeed: number): void {
    const shooter = this.kick.shooter;
    const scored = outcome.kind === 'goal';
    let detail = `${TEAMS[shooter].name} · ${Math.round(launchSpeed * 3.6)} km/h`;
    if (!this.setup.twoPlayer && shooter === 'cpu' && scored && this.wentEarly) detail += ' · you went too early';
    // Gold for good news for the player: their goals and their saves. With two players,
    // every goal is gold and the crowd enjoys both goals and saves.
    const good = this.setup.twoPlayer ? scored : shooter === 'player' ? scored : !scored;
    this.hud.showResult(describeOutcome(outcome), detail, good);
    const crowdLikes = this.setup.twoPlayer ? outcome.kind === 'goal' || outcome.kind === 'saved' : good;
    this.sound.react(outcome.kind === 'woodwork' ? 'ooh' : crowdLikes ? 'cheer' : 'groan');
    this.events.onKick?.(shooter, outcome);
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
    this.hud.setStatus('');
    const banner = this.events.onFinish?.(winner, this.shootout) ?? this.defaultBanner(winner);
    this.sound.react(banner.good || this.setup.twoPlayer ? 'roar' : 'groan');
    this.hud.showResult(banner.title, banner.detail, banner.good);
  }

  private defaultBanner(winner: Side): FinishBanner {
    const score = `${this.shootout.goals('player')}–${this.shootout.goals('cpu')}`;
    const youWon = winner === 'player' && !this.setup.twoPlayer;
    return {
      title: youWon ? 'You win!' : `${TEAMS[winner].name} win`,
      detail: `${score} on penalties · click to play again`,
      good: youWon || this.setup.twoPlayer,
    };
  }
}
