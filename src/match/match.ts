import * as THREE from 'three';
import type { Sound } from '../audio/sound';
import type { Director } from '../camera/director';
import { TUNING } from '../config';
import { GOAL_HEIGHT, GOAL_WIDTH } from '../constants';
import type { KeeperKeys } from '../input/keeperKeys';
import type { PointerInput } from '../input/pointer';
import type { ShooterControls } from '../input/shooter';
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
  /** Both sides human on two devices: this one plays `player`, the remote seat the other side. */
  online?: boolean;
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

/** The parts of the HUD the match drives, so a player on another device can be sent them too. */
export type MatchHud = Pick<Hud, 'setStatus' | 'showResult' | 'hideResult' | 'setScoreboard'>;

/**
 * A player on another device, playing `side`: their kicks come through `shooter`, their
 * dives through `consumeDive`, and they get their own HUD messages and camera director.
 */
export interface RemoteSeat {
  readonly side: Side;
  readonly shooter: ShooterControls;
  readonly hud: MatchHud;
  readonly director: Director;
  /** The next dive target (x, y on the goal line) they asked for, if any. */
  consumeDive(): { x: number; y: number } | null;
  clearDives(): void;
}

/**
 * A whole shootout: Intro → Kicking (one Kick per penalty, alternating sides) → Finished.
 * Owns the shootout score and drives the kick, keeper and HUD between penalties.
 *
 * Against the CPU, the player shoots for `player` and keeps goal on the CPU's kicks. In
 * two-player mode both sides are human: whoever is shooting has the mouse and whoever is
 * in goal has the arrow keys. Online, the other side is a `RemoteSeat`: this device runs
 * the match for both and tells the other what to show.
 */
export class Match {
  state: MatchState = { kind: 'intro', elapsed: 0 };
  shootout: Shootout;
  events: MatchEvents = {};
  /** Where a keeper on this device would dive if they clicked now (when the mouse is theirs). */
  readonly keeperAim = new THREE.Vector2(0, 1);
  /** The player on another device, when playing online. */
  remote: RemoteSeat | null = null;
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
        this.eachHud((hud) => hud.setStatus(''));
        this.keeper.react(shot);
        this.director.onShot(shot);
        this.remote?.director.onShot(shot);
      },
      onResult: (outcome, launchSpeed) => this.showResult(outcome, launchSpeed),
      onDone: (outcome) => this.kickDone(outcome.kind === 'goal'),
    };
    this.shootout = this.newShootout();
  }

  get twoPlayer(): boolean {
    return this.setup.twoPlayer;
  }

  get online(): boolean {
    return !!this.setup.online && this.remote !== null;
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
        if ((this.anyPress() && s.elapsed > 0.4) || s.elapsed > TUNING.match.introDuration) {
          this.eachHud((hud) => hud.hideResult());
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
        if (this.anyPress() && s.elapsed > 1.0) {
          if (this.events.onContinue) this.events.onContinue();
          else this.restart();
        }
        break;
    }
  }

  /** A click on this device or the remote one (both are consumed). */
  private anyPress(): boolean {
    const local = this.input.consumePress();
    const remote = this.online && this.remote!.shooter.consumePress();
    return local || remote;
  }

  /** True while a keeper on this device can still dive with the mouse: show the dive reticle. */
  get keeperAiming(): boolean {
    const keeper = otherSide(this.kick.shooter);
    return this.isLocal(keeper) && !this.isLocal(this.kick.shooter) && this.keeperCanDive(this.director);
  }

  /** True while the remote player is in goal and can still dive. */
  get remoteKeeperAiming(): boolean {
    const remote = this.remote;
    return !!remote && this.online && otherSide(this.kick.shooter) === remote.side && this.keeperCanDive(remote.director);
  }

  /** A human is in goal, hasn't dived yet and the kick is live (and their camera hasn't cut away). */
  private keeperCanDive(director: Director): boolean {
    const k = this.kick.state.kind;
    return (
      this.state.kind === 'kicking' &&
      this.keeperIsHuman(this.kick.shooter) &&
      this.keeper.ready &&
      !director.cutAway &&
      k !== 'result' &&
      k !== 'nextKick'
    );
  }

  /** Whether `side` is played by a person (both are, with two players or online). */
  isHuman(side: Side): boolean {
    return this.setup.twoPlayer || this.online || side === 'player';
  }

  /** Whether `side` is played by a person at this device. */
  isLocal(side: Side): boolean {
    if (this.online) return side !== this.remote!.side;
    return this.isHuman(side);
  }

  private keeperIsHuman(shooter: Side): boolean {
    return this.isHuman(otherSide(shooter));
  }

  /** A human is in goal: dive on an arrow key, or a click when the mouse is free; or the remote keeper's dive. */
  private controlKeeper(dt: number): void {
    const remote = this.remote;
    if (remote && this.online && otherSide(this.kick.shooter) === remote.side) {
      if (!this.keeperCanDive(remote.director)) {
        remote.clearDives();
        return;
      }
      const dive = remote.consumeDive();
      if (dive) this.dive(dive);
      return;
    }

    if (!this.keeperCanDive(this.director)) {
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
    if (target) this.dive(target);
  }

  private dive(target: { x: number; y: number }): void {
    this.keeper.playerDive(target.x, target.y);
    this.wentEarly = this.kick.keeperCommitted(target.x);
  }

  /**
   * Every HUD the match is shown on, with whose point of view to write it from: this
   * device's (`player`, or nobody's in particular with two players at one keyboard) and,
   * online, the remote player's.
   */
  private eachHud(show: (hud: MatchHud, viewer: Side | null) => void): void {
    show(this.hud, this.setup.twoPlayer ? null : 'player');
    if (this.online) show(this.remote!.hud, this.remote!.side);
  }

  private newShootout(): Shootout {
    const first: Side = Math.random() < 0.5 ? 'player' : 'cpu';
    const shootout = new Shootout(first);
    this.kick.stop(first);
    this.keeper.reset();
    this.director.reset();
    this.remote?.director.reset();
    this.keeperMesh.setShirt(keeperShirt(TEAMS[otherSide(first)], TEAMS[first]));
    this.input.consumePress();
    this.remote?.shooter.clear();
    this.state = { kind: 'intro', elapsed: 0 };
    this.shootout = shootout;
    this.eachHud((hud, viewer) => {
      hud.setScoreboard(shootout, TEAMS);
      hud.setStatus('');
      const toss = first === viewer ? 'You won the toss: you shoot first' : `${TEAMS[first].name} shoot first`;
      hud.showResult(this.setup.introTitle ?? 'Penalty shootout', toss, false);
    });
    return shootout;
  }

  private startKick(): void {
    const shooter = this.shootout.next;
    const keeperSide = otherSide(shooter);
    this.keeper.reset();
    // Looking out from behind the goal helps someone in goal read a kicker on another
    // device (or the CPU); with both players at one screen, keep the shooter's view.
    this.director.reset(this.isLocal(keeperSide) && !this.isLocal(shooter) ? 'keeper' : 'main');
    const remote = this.online ? this.remote! : null;
    remote?.director.reset(keeperSide === remote.side ? 'keeper' : 'main');
    this.keeper.controlledByPlayer = this.keeperIsHuman(shooter);
    this.keeperMesh.setShirt(keeperShirt(TEAMS[keeperSide], TEAMS[shooter]));
    this.keys.clear();
    remote?.clearDives();
    this.wentEarly = false;
    this.sound.whistle();
    this.kick.start(shooter, this.isHuman(shooter), remote && shooter === remote.side ? remote.shooter : undefined);
    const prefix = this.shootout.suddenDeath ? 'Sudden death · ' : '';
    this.eachHud((hud, viewer) => {
      hud.setScoreboard(this.shootout, TEAMS);
      if (viewer === null) {
        const keeperTeam = TEAMS[keeperSide].name;
        hud.setStatus(`${prefix}${TEAMS[shooter].name} shoot (mouse) · ${keeperTeam} in goal (arrow keys)`);
      } else {
        hud.setStatus(
          shooter === viewer
            ? `${prefix}Your kick · aim, hold to power up, release to shoot`
            : `${prefix}You're in goal · arrow keys, or click / tap where to dive`,
        );
      }
    });
  }

  private showResult(outcome: ShotOutcome, launchSpeed: number): void {
    const shooter = this.kick.shooter;
    const scored = outcome.kind === 'goal';
    let detail = `${TEAMS[shooter].name} · ${Math.round(launchSpeed * 3.6)} km/h`;
    if (!this.setup.twoPlayer && !this.online && shooter === 'cpu' && scored && this.wentEarly) detail += ' · you went too early';
    // Gold for news the viewer wants: their goals and their saves. With two players at one
    // screen, every goal is gold.
    this.eachHud((hud, viewer) => {
      const good = viewer === null ? scored : shooter === viewer ? scored : !scored;
      hud.showResult(describeOutcome(outcome), detail, good);
    });
    // With two humans the crowd enjoys both goals and saves.
    const neutral = this.setup.twoPlayer || this.online;
    const crowdLikes = neutral ? outcome.kind === 'goal' || outcome.kind === 'saved' : shooter === 'player' ? scored : !scored;
    this.sound.react(outcome.kind === 'woodwork' ? 'ooh' : crowdLikes ? 'cheer' : 'groan');
    this.events.onKick?.(shooter, outcome);
  }

  private kickDone(scored: boolean): void {
    this.eachHud((hud) => hud.hideResult());
    this.shootout.record(scored);
    this.eachHud((hud) => hud.setScoreboard(this.shootout, TEAMS));

    const winner = this.shootout.winner;
    if (!winner) {
      this.startKick();
      return;
    }
    this.state = { kind: 'finished', winner, elapsed: 0 };
    this.kick.stop();
    this.keeper.reset();
    const custom = this.events.onFinish?.(winner, this.shootout);
    let localGood = false;
    this.eachHud((hud, viewer) => {
      const banner = custom ?? this.defaultBanner(winner, viewer);
      if (hud === this.hud) localGood = banner.good;
      hud.setStatus('');
      hud.showResult(banner.title, banner.detail, banner.good);
    });
    this.sound.react(localGood || this.setup.twoPlayer || this.online ? 'roar' : 'groan');
  }

  private defaultBanner(winner: Side, viewer: Side | null): FinishBanner {
    const score = `${this.shootout.goals('player')}–${this.shootout.goals('cpu')}`;
    const youWon = winner === viewer;
    return {
      title: youWon ? 'You win!' : `${TEAMS[winner].name} win`,
      detail: `${score} on penalties · click to play again`,
      good: youWon || viewer === null,
    };
  }
}
