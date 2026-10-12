import type * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { Sound } from '../audio/sound';
import { Director } from '../camera/director';
import { Kickers } from '../characters/kicker';
import { loadFigure } from '../characters/skinned';
import { TUNING, type KeeperLevelName } from '../config';
import { PHYSICS_STEP } from '../constants';
import { KeeperKeys } from '../input/keeperKeys';
import { PointerInput } from '../input/pointer';
import { SpinKeys } from '../input/spinKeys';
import { Keeper } from '../keeper/keeper';
import { KeeperMesh } from '../keeper/mesh';
import { Kick } from '../match/kick';
import { Match } from '../match/match';
import { Session } from '../match/session';
import { Stats } from '../match/stats';
import { TEAMS } from '../match/teams';
import type { Net } from '../net';
import { createPhysics, type Physics } from '../physics';
import { Recorder } from '../replay/recorder';
import { Replay } from '../replay/replay';
import { Stadium } from '../stadium';
import { createScene, type GameScene } from '../scene';
import { applyAero } from '../shooting/aero';
import { Reticle } from '../shooting/aim';
import { overpower, scatterForPower } from '../shooting/power';
import { clampContact } from '../shooting/spin';
import { BallTrail } from '../trail';
import { Hints, type HintId } from '../ui/hints';
import { Hud } from '../ui/hud';
import { Menu } from '../ui/menu';
import { readDebugOptions, StatsOverlay, type DebugOptions } from './debug';
import { applyGraphics, saveLite, savedLite } from './graphics';
import { Replays } from './replays';

const LEVEL_KEYS: Record<string, KeeperLevelName> = { Digit1: 'easy', Digit2: 'normal', Digit3: 'hard' };

/**
 * The whole game, wired together: scene, physics, keeper, kickers, the match and its
 * session, menu, HUD, sound and replays. `create()` builds it; `start()` runs the loop.
 *
 * Each animation frame advances game time (scaled by slow motion and frozen by the menu
 * and replays), runs the fixed physics steps that time covers, then renders.
 */
export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly ballMesh: THREE.Mesh;
  private readonly net: Net;
  private readonly world: RAPIER.World;
  private readonly ball: RAPIER.RigidBody;
  private readonly events: RAPIER.EventQueue;
  private readonly tags: Physics['tags'];

  private readonly keeper: Keeper;
  private readonly keeperMesh: KeeperMesh;
  private readonly kickers: Kickers;
  private readonly hud = new Hud();
  private readonly input: PointerInput;
  private readonly reticle = new Reticle();
  private readonly kick: Kick;
  private readonly sound = new Sound();
  private readonly director: Director;
  private readonly match: Match;
  private readonly stats = new Stats();
  private readonly session: Session;
  private readonly menu: Menu;
  private readonly replays: Replays;
  private readonly debug: DebugOptions;
  private readonly statsOverlay: StatsOverlay | null;
  private readonly stadium = new Stadium();
  private readonly trail = new BallTrail();
  private readonly hints: Hints;
  /** The kicker-cam has cut to this kick's scorer. */
  private celebrated = false;
  private readonly setNight: (night: boolean) => void;
  /** The teams the crowd is dressed for, to notice when the matchup changes. */
  private dressedFor: string | null = null;

  /** A match has been kicked off (so the menu can offer Resume). */
  private matchStarted = false;
  private last = 0;
  private accumulator = 0;

  static async create(canvas: HTMLCanvasElement): Promise<Game> {
    const scene = createScene(canvas);
    const physics = await createPhysics();
    // Quaternius' Mannequin (CC0, see ASSETS.md); the built-in figures stand in if it fails to load.
    const figure = await loadFigure(`${import.meta.env.BASE_URL}models/mannequin.glb`);
    return new Game(canvas, scene, physics, figure);
  }

  private constructor(canvas: HTMLCanvasElement, s: GameScene, physics: Physics, figure: Awaited<ReturnType<typeof loadFigure>>) {
    this.renderer = s.renderer;
    this.scene = s.scene;
    this.camera = s.camera;
    this.ballMesh = s.ball;
    this.net = s.net;
    this.setNight = s.setNight;
    this.world = physics.world;
    this.ball = physics.ball;
    this.events = physics.events;
    this.tags = physics.tags;
    this.debug = readDebugOptions(location.search);
    this.statsOverlay = this.debug.stats ? new StatsOverlay() : null;
    this.hints = new Hints(this.debug.hints);

    this.keeper = new Keeper(this.world, this.tags);
    this.keeperMesh = new KeeperMesh(this.keeper, figure);
    this.kickers = new Kickers(figure);
    this.scene.add(this.keeperMesh.object, this.kickers.object, this.reticle.object, this.stadium.object, this.trail.object);
    // The crowd you see follows the crowd you hear.
    this.sound.onReact = (kind) => this.stadium.react(kind);

    this.input = new PointerInput(canvas);
    this.kick = new Kick(this.ball, this.input, this.camera, new SpinKeys());
    this.director = new Director(this.camera);
    this.match = new Match(this.kick, this.keeper, this.keeperMesh, this.input, new KeeperKeys(), this.camera, this.hud, this.director, this.sound);

    // The session runs friendlies, cups and two-player games and keeps the stats.
    this.session = new Session(this.match, this.keeper, this.stats, {
      onLevel: (level) => this.hud.setKeeperLevel(level, this.debug.keys),
      openMenu: () => {
        this.matchStarted = false;
        this.openMenu();
      },
    });
    // The menu starts the game and pauses it (Esc).
    this.menu = new Menu(
      { mode: 'friendly', teams: { ...TEAMS }, level: this.keeper.level, muted: this.sound.isMuted, lite: savedLite() },
      {
        onPlay: (choice) => {
          this.sound.unlock(); // inside a click: browsers only start audio from a user gesture
          this.session.begin(choice);
          this.matchStarted = true;
          this.menu.close();
        },
        onResume: () => this.menu.close(),
        onSound: (muted) => this.sound.setMuted(muted),
        onResetStats: () => {
          this.stats.reset();
          this.menu.setStats(this.stats.summary());
        },
        onNight: (night) => {
          this.setNight(night);
          this.stadium.setNight(night);
        },
        onLite: (lite) => {
          saveLite(lite);
          applyGraphics(this.renderer, this.scene, this.stadium, lite);
        },
      },
    );

    // Replays: record each kick; replay the last one, or every kick as highlights at the end.
    const recorder = new Recorder([this.ballMesh, this.keeperMesh.object, this.kickers.object], this.net);
    this.replays = new Replays(this.match, this.kick, recorder, new Replay(recorder, this.director, this.net));

    this.hud.onReplayClick(() => this.replays.toggle());
    this.hud.onMenuClick(() => this.openMenu());
    this.hud.onContactTap((x, y) => {
      const k = this.kick.state.kind;
      if (k === 'aiming' || k === 'charging') this.kick.contact = clampContact(x, y);
    });
    window.addEventListener('keydown', (e) => this.onKey(e));
    window.addEventListener('resize', () => this.director.refit());
    this.hud.setKeeperLevel(this.keeper.level, this.debug.keys);
    applyGraphics(this.renderer, this.scene, this.stadium, savedLite());
  }

  /** Show the menu and start the loop. */
  start(): void {
    this.openMenu();
    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  /** Open the menu with the latest stats; Resume only while a match is in progress. */
  private openMenu(): void {
    this.menu.setStats(this.stats.summary());
    this.menu.open(this.matchStarted);
  }

  private onKey(e: KeyboardEvent): void {
    if (e.code === 'Escape') {
      if (this.menu.isOpen && this.matchStarted) this.menu.close();
      else this.openMenu();
      return;
    }
    if (this.menu.isOpen) return;
    if (e.code === 'Space') {
      e.preventDefault();
      this.replays.toggle();
      return;
    }
    if (this.replays.replay.active) return;
    if (e.code === 'KeyM') {
      this.sound.setMuted(!this.sound.isMuted);
      this.menu.setMuted(this.sound.isMuted);
    }
    if (!this.debug.keys) return;
    if (e.code === 'KeyR') this.match.restart();
    const level = LEVEL_KEYS[e.code];
    if (level) {
      this.keeper.level = level;
      this.hud.setKeeperLevel(level, true);
    }
  }

  private frame(now: number): void {
    const started = performance.now();
    this.step(now);
    this.statsOverlay?.frame(performance.now() - started, this.renderer.info.render);
  }

  private step(now: number): void {
    const elapsed = Math.min((now - this.last) / 1000, 0.25);
    // Paused while the menu is open: keep rendering, but no game time passes.
    const realDt = this.menu.isOpen ? 0 : elapsed * this.debug.timeScale;
    this.last = now;
    requestAnimationFrame((t) => this.frame(t));
    // The crowd keeps moving whatever the game is doing (menu, replays, slow motion).
    this.dressCrowd();
    this.stadium.update(elapsed);

    const replay = this.replays.replay;
    if (replay.active) {
      // The game is frozen during a replay; a click or tap ends it early.
      if (this.input.consumePress()) replay.finish();
      else replay.update(realDt);
      if (replay.active) {
        this.renderReplay(realDt * replay.playbackSpeed);
        return;
      }
      this.input.consumeRelease();
    }

    this.director.update(realDt, this.ball.translation(), this.kick.state.kind === 'ballInFlight', this.keeper);
    // Slow motion: the same fixed physics step, just fewer of them per real second.
    const gameDt = realDt * this.director.timeScale;
    this.accumulator += gameDt;
    while (this.accumulator >= PHYSICS_STEP) {
      this.fixedStep();
      this.accumulator -= PHYSICS_STEP;
    }
    this.celebrate();
    this.render(gameDt);
  }

  private fixedStep(): void {
    this.keeper.step(PHYSICS_STEP);
    applyAero(this.ball);
    // Speed going into the step: a net contact has already soaked most of it up afterwards.
    const v = this.ball.linvel();
    const speedIn = Math.hypot(v.x, v.y, v.z);
    this.world.step(this.events);
    this.events.drainCollisionEvents((h1, h2, started) => {
      if (!started) return;
      const tag = this.tags.get(h1) ?? this.tags.get(h2);
      if (!tag) return;
      this.kick.onBallContact(tag);
      if (tag === 'net') {
        this.net.hit(this.ball.translation(), speedIn);
        this.sound.net(speedIn);
      }
      if (tag === 'post' || tag === 'bar') {
        this.sound.woodwork(speedIn);
        this.director.shake(speedIn);
      }
      if (tag === 'keeper') this.sound.parry(speedIn);
    });
    this.match.step(PHYSICS_STEP);
    this.net.step(PHYSICS_STEP);
  }

  private render(gameDt: number): void {
    const p = this.ball.translation();
    const r = this.ball.rotation();
    this.ballMesh.position.set(p.x, p.y, p.z);
    this.ballMesh.quaternion.set(r.x, r.y, r.z, r.w);
    this.trail.update(this.ballMesh.position, gameDt, this.camera.position);
    this.keeperMesh.update(gameDt);
    this.kickers.update(gameDt, this.kick);

    const kick = this.kick;
    const state = kick.state.kind;
    const aiming = state === 'aiming' || state === 'charging';
    const power = state === 'charging' ? kick.power : null;
    this.reticle.keeperMode = this.match.keeperAiming;
    this.reticle.visible = aiming || this.match.keeperAiming;
    if (this.match.keeperAiming) this.reticle.update(this.match.keeperAim, 0, 0);
    else this.reticle.update(kick.aim, scatterForPower(power ?? 0), overpower(power ?? 0));
    this.hud.setContact(aiming ? kick.contact : null);
    if (kick.runUp !== null) this.hud.setRunUp(kick.runUp);
    else this.hud.setPower(state === 'aiming' ? 0 : power);
    this.hud.setReplay(this.replays.offer);
    this.coach();

    this.replays.record(gameDt);
    this.renderer.render(this.scene, this.camera);
  }

  /** Re-dress the crowd when the matchup changes (a new match or cup round). */
  private dressCrowd(): void {
    const key = `${TEAMS.player.name}|${TEAMS.cpu.name}`;
    if (key === this.dressedFor) return;
    this.dressedFor = key;
    this.stadium.setTeams(TEAMS.player.colour, TEAMS.cpu.colour);
  }

  /** A human kicker's goal: once the result has been up a moment, cut to them celebrating. */
  private celebrate(): void {
    const s = this.kick.state;
    if (s.kind !== 'result') {
      this.celebrated = false;
      return;
    }
    if (this.celebrated || s.outcome.kind !== 'goal' || !this.match.isHuman(this.kick.shooter)) return;
    if (s.elapsed < TUNING.director.kickerCamera.delay) return;
    this.celebrated = true;
    this.director.celebrate(this.kickers.position);
  }

  /** First-time tips: retire the ones the player has just shown they know, then pick one for now. */
  private coach(): void {
    const k = this.kick.state.kind;
    const hints = this.hints;
    const shooterHuman = this.match.isHuman(this.kick.shooter);
    if (shooterHuman && (k === 'striking' || k === 'ballInFlight')) hints.learned('shoot', 'power');
    if (shooterHuman && (this.kick.contact.x !== 0 || this.kick.contact.y !== 0)) hints.learned('spin');
    if (!shooterHuman && !this.keeper.ready) hints.learned('keep');
    if (this.replays.replay.active) hints.learned('replay');

    let tip: HintId | null = null;
    if (this.match.state.kind === 'kicking') {
      if (shooterHuman && k === 'aiming') tip = hints.retired('shoot') ? 'spin' : 'shoot';
      else if (shooterHuman && k === 'charging') tip = 'power';
      else if (!shooterHuman && !this.match.twoPlayer && k === 'cpuRunUp') tip = 'keep';
      else if (k === 'result' && this.replays.offer === 'replay') tip = 'replay';
    }
    hints.show(tip);
  }

  /** A replay frame (`dt`: seconds of the recording played): the recorder poses the scene. */
  private renderReplay(dt: number): void {
    this.trail.update(this.ballMesh.position, dt, this.camera.position);
    this.reticle.visible = false;
    this.hud.setReplaying(this.replays.replay.caption);
    this.renderer.render(this.scene, this.camera);
  }
}
