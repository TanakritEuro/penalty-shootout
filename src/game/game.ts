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
import { OnlinePlay } from './online';
import { Replays } from './replays';

const LEVEL_KEYS: Record<string, KeeperLevelName> = { Digit1: 'easy', Digit2: 'normal', Digit3: 'hard' };

/**
 * The whole game, wired together: scene, physics, keeper, kickers, the match and its
 * session, menu, HUD, sound, replays and online play. `create()` builds it; `start()`
 * runs the loop.
 *
 * Each animation frame advances game time (scaled by slow motion and frozen by the menu
 * and replays), runs the fixed physics steps that time covers, then renders. As the guest
 * in an online game, it shows what the host sends instead.
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
  private readonly spinKeys = new SpinKeys();
  private readonly keeperKeys = new KeeperKeys();
  private readonly reticle = new Reticle();
  private readonly kick: Kick;
  private readonly sound = new Sound();
  private readonly director: Director;
  private readonly match: Match;
  private readonly stats = new Stats();
  private readonly session: Session;
  private readonly menu: Menu;
  private readonly replays: Replays;
  private readonly recorder: Recorder;
  private readonly online: OnlinePlay;
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
    this.kick = new Kick(this.ball, this.input, this.camera, this.spinKeys);
    this.director = new Director(this.camera);
    this.match = new Match(this.kick, this.keeper, this.keeperMesh, this.input, this.keeperKeys, this.camera, this.hud, this.director, this.sound);

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
          this.online.leave();
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
        onHost: (team) => void this.online.hostRoom(team),
        onJoin: (code, team) => void this.online.join(code, team),
        onLeaveOnline: () => this.online.leave(),
      },
    );

    // Replays: record each kick; replay the last one, or every kick as highlights at the end.
    // Online, the same recording of what's on screen is what the host sends the guest.
    this.recorder = new Recorder([this.ballMesh, this.keeperMesh.object, this.kickers.object], this.net);
    this.replays = new Replays(this.match, this.kick, this.recorder, new Replay(this.recorder, this.director, this.net));

    this.online = new OnlinePlay(
      {
        menu: this.menu,
        match: this.match,
        session: this.session,
        sound: this.sound,
        net: this.net,
        hud: this.hud,
        recorder: this.recorder,
        camera: this.camera,
        reticle: this.reticle,
        pointer: this.input,
        spinKeys: this.spinKeys,
        keeperKeys: this.keeperKeys,
        keeperMesh: this.keeperMesh,
        kickers: this.kickers,
      },
      {
        started: () => {
          this.matchStarted = this.online.host !== null;
          this.menu.close();
        },
        ended: () => {
          this.matchStarted = false;
          this.director.reset();
          this.reticle.visible = false;
          this.hud.hideResult();
          this.hud.setStatus('');
          this.hud.setPower(null);
          this.hud.setContact(null);
          this.openMenu();
        },
      },
    );

    this.hud.onReplayClick(() => this.toggleReplay());
    this.hud.onMenuClick(() => this.openMenu());
    this.hud.onContactTap((x, y) => {
      const k = this.kick.state.kind;
      if (this.online.guest) this.online.guest.setContact(x, y);
      else if ((k === 'aiming' || k === 'charging') && this.match.isLocal(this.kick.shooter)) this.kick.local.point = clampContact(x, y);
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
    this.menu.open(this.canResume);
  }

  private get canResume(): boolean {
    return this.matchStarted || this.online.active;
  }

  /** Replays freeze the game, so there are none online (the other player's would stop too). */
  private toggleReplay(): void {
    if (!this.online.active) this.replays.toggle();
  }

  private onKey(e: KeyboardEvent): void {
    if (e.code === 'Escape') {
      if (this.menu.isOpen && this.canResume) this.menu.close();
      else this.openMenu();
      return;
    }
    if (this.menu.isOpen) return;
    if (e.code === 'Space') {
      e.preventDefault();
      this.toggleReplay();
      return;
    }
    if (this.replays.replay.active) return;
    if (e.code === 'KeyM') {
      this.sound.setMuted(!this.sound.isMuted);
      this.menu.setMuted(this.sound.isMuted);
    }
    if (!this.debug.keys || this.online.guest) return;
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
    // Paused while the menu is open: keep rendering, but no game time passes. Online games
    // don't pause: the other player is still playing.
    const realDt = this.menu.isOpen && !this.online.active ? 0 : elapsed * this.debug.timeScale;
    this.last = now;
    requestAnimationFrame((t) => this.frame(t));
    // The crowd keeps moving whatever the game is doing (menu, replays, slow motion).
    this.dressCrowd();
    this.stadium.update(elapsed);

    const guest = this.online.guest;
    if (guest) {
      const played = guest.update(realDt);
      this.trail.update(this.ballMesh.position, played, this.camera.position);
      this.renderer.render(this.scene, this.camera);
      return;
    }

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

    const inFlight = this.kick.state.kind === 'ballInFlight';
    this.director.update(realDt, this.ball.translation(), inFlight, this.keeper);
    this.online.host?.director.update(realDt, this.ball.translation(), inFlight, this.keeper);
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
        this.online.host?.director.shake(speedIn);
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
    // Aiming on this device (online, the other player aims on theirs).
    const aiming = (state === 'aiming' || state === 'charging') && this.match.isLocal(kick.shooter);
    const power = state === 'charging' && aiming ? kick.power : null;
    this.reticle.keeperMode = this.match.keeperAiming;
    this.reticle.visible = aiming || this.match.keeperAiming;
    if (this.match.keeperAiming) this.reticle.update(this.match.keeperAim, 0, 0);
    else this.reticle.update(kick.aim, scatterForPower(power ?? 0), overpower(power ?? 0));
    this.hud.setContact(aiming ? kick.contact : null);
    if (kick.runUp !== null) this.hud.setRunUp(kick.runUp);
    else this.hud.setPower(aiming ? (state === 'aiming' ? 0 : power) : null);
    this.hud.setReplay(this.online.active ? null : this.replays.offer);
    this.coach();

    this.replays.record(gameDt);
    this.online.host?.sendFrame(performance.now() / 1000, {
      match: this.match.state.kind,
      kick: state,
      shooter: kick.shooter,
      canDive: this.match.remoteKeeperAiming,
    });
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
    this.online.host?.director.celebrate(this.kickers.position);
  }

  /** First-time tips: retire the ones the player has just shown they know, then pick one for now. */
  private coach(): void {
    const k = this.kick.state.kind;
    const hints = this.hints;
    const shooterHuman = this.match.isLocal(this.kick.shooter);
    if (shooterHuman && (k === 'striking' || k === 'ballInFlight')) hints.learned('shoot', 'power');
    if (shooterHuman && (this.kick.contact.x !== 0 || this.kick.contact.y !== 0)) hints.learned('spin');
    if (!shooterHuman && !this.keeper.ready) hints.learned('keep');
    if (this.replays.replay.active) hints.learned('replay');

    let tip: HintId | null = null;
    if (this.match.state.kind === 'kicking') {
      if (shooterHuman && k === 'aiming') tip = hints.retired('shoot') ? 'spin' : 'shoot';
      else if (shooterHuman && k === 'charging') tip = 'power';
      else if (!shooterHuman && !this.match.twoPlayer && k === 'cpuRunUp') tip = 'keep';
      else if (k === 'result' && !this.online.active && this.replays.offer === 'replay') tip = 'replay';
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
