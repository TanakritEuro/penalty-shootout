import type * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { Sound } from '../audio/sound';
import { Director } from '../camera/director';
import { Kickers } from '../characters/kicker';
import { loadFigure } from '../characters/skinned';
import type { KeeperLevelName } from '../config';
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
import { createScene, type GameScene } from '../scene';
import { applyAero } from '../shooting/aero';
import { Reticle } from '../shooting/aim';
import { overpower, scatterForPower } from '../shooting/power';
import { clampContact } from '../shooting/spin';
import { Hud } from '../ui/hud';
import { Menu } from '../ui/menu';
import { readDebugOptions, type DebugOptions } from './debug';
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
    this.world = physics.world;
    this.ball = physics.ball;
    this.events = physics.events;
    this.tags = physics.tags;
    this.debug = readDebugOptions(location.search);

    this.keeper = new Keeper(this.world, this.tags);
    this.keeperMesh = new KeeperMesh(this.keeper, figure);
    this.kickers = new Kickers(figure);
    this.scene.add(this.keeperMesh.object, this.kickers.object, this.reticle.object);

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
      { mode: 'friendly', teams: { ...TEAMS }, level: this.keeper.level, muted: this.sound.isMuted },
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
    // Paused while the menu is open: keep rendering, but no game time passes.
    const realDt = this.menu.isOpen ? 0 : Math.min((now - this.last) / 1000, 0.25) * this.debug.timeScale;
    this.last = now;
    requestAnimationFrame((t) => this.frame(t));

    const replay = this.replays.replay;
    if (replay.active) {
      // The game is frozen during a replay; a click or tap ends it early.
      if (this.input.consumePress()) replay.finish();
      else replay.update(realDt);
      if (replay.active) {
        this.renderReplay();
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
      if (tag === 'post' || tag === 'bar') this.sound.woodwork(speedIn);
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

    this.replays.record(gameDt);
    this.renderer.render(this.scene, this.camera);
  }

  /** A replay frame: the recorder poses the scene; nothing live is updated. */
  private renderReplay(): void {
    this.reticle.visible = false;
    this.hud.setReplaying(this.replays.replay.caption);
    this.renderer.render(this.scene, this.camera);
  }
}
