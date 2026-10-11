// Entry point: builds the scene and physics, then runs the game loop.
// Physics and game logic run on a fixed step; rendering runs once per animation frame.

import { Sound } from './audio/sound';
import { Director } from './camera/director';
import { Kickers } from './characters/kicker';
import type { KeeperLevelName } from './config';
import { PHYSICS_STEP } from './constants';
import { KeeperKeys } from './input/keeperKeys';
import { PointerInput } from './input/pointer';
import { SpinKeys } from './input/spinKeys';
import { Keeper } from './keeper/keeper';
import { KeeperMesh } from './keeper/mesh';
import { Kick } from './match/kick';
import { Match } from './match/match';
import { Session } from './match/session';
import { Stats } from './match/stats';
import { TEAMS } from './match/teams';
import { createPhysics } from './physics';
import { createScene } from './scene';
import { applyAero } from './shooting/aero';
import { Reticle } from './shooting/aim';
import { overpower, scatterForPower } from './shooting/power';
import { clampContact } from './shooting/spin';
import { Recorder } from './replay/recorder';
import { Replay } from './replay/replay';
import { Hud } from './ui/hud';
import { Menu } from './ui/menu';

const canvas = document.querySelector<HTMLCanvasElement>('#game')!;

const { renderer, scene, camera, ball: ballMesh, net } = createScene(canvas);
const { world, ball, events, tags } = await createPhysics();
const keeper = new Keeper(world, tags);
const keeperMesh = new KeeperMesh(keeper);
scene.add(keeperMesh.object);
const kickers = new Kickers();
scene.add(kickers.object);
const hud = new Hud();
const input = new PointerInput(canvas);
const reticle = new Reticle();
scene.add(reticle.object);

const kick = new Kick(ball, input, camera, new SpinKeys());
const sound = new Sound();
const director = new Director(camera);
const match = new Match(kick, keeper, keeperMesh, input, new KeeperKeys(), camera, hud, director, sound);

// Debug aids, off unless the URL has ?debug: R restarts the shootout, 1 / 2 / 3 set the CPU
// keeper level. (?timescale=0.1 slows the game; see the loop below.)
const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');
const LEVEL_KEYS: Record<string, KeeperLevelName> = { Digit1: 'easy', Digit2: 'normal', Digit3: 'hard' };

// The menu starts the game and pauses it (Esc); the session runs friendlies, cups and
// two-player games and keeps the stats.
let matchStarted = false;
const stats = new Stats();
const session = new Session(match, keeper, stats, {
  onLevel: (level) => hud.setKeeperLevel(level, DEBUG),
  openMenu: () => {
    matchStarted = false;
    openMenu();
  },
});
const menu = new Menu(
  { mode: 'friendly', teams: { ...TEAMS }, level: keeper.level, muted: sound.isMuted },
  {
    onPlay: (choice) => {
      sound.unlock(); // inside a click: browsers only start audio from a user gesture
      session.begin(choice);
      matchStarted = true;
      menu.close();
    },
    onResume: () => menu.close(),
    onSound: (muted) => sound.setMuted(muted),
    onResetStats: () => {
      stats.reset();
      menu.setStats(stats.summary());
    },
  },
);
menu.setStats(stats.summary());

/** Open the menu with the latest stats; Resume only while a match is in progress. */
function openMenu(): void {
  menu.setStats(stats.summary());
  menu.open(matchStarted);
}

window.addEventListener('keydown', (e) => {
  if (e.code === 'Escape') {
    if (menu.isOpen && matchStarted) menu.close();
    else openMenu();
    return;
  }
  if (menu.isOpen) return;
  if (e.code === 'Space') {
    e.preventDefault();
    toggleReplay();
    return;
  }
  if (replay.active) return;
  if (e.code === 'KeyR') match.restart();
  if (e.code === 'KeyM') {
    sound.setMuted(!sound.isMuted);
    menu.setMuted(sound.isMuted);
  }
  const level = LEVEL_KEYS[e.code];
  if (level) {
    keeper.level = level;
    hud.setKeeperLevel(level, DEBUG);
  }
});

function fixedStep(): void {
  keeper.step(PHYSICS_STEP);
  applyAero(ball);
  // Speed going into the step: a net contact has already soaked most of it up afterwards.
  const v = ball.linvel();
  const speedIn = Math.hypot(v.x, v.y, v.z);
  world.step(events);
  events.drainCollisionEvents((h1, h2, started) => {
    if (!started) return;
    const tag = tags.get(h1) ?? tags.get(h2);
    if (tag) kick.onBallContact(tag);
    if (tag === 'net') {
      net.hit(ball.translation(), speedIn);
      sound.net(speedIn);
    }
    if (tag === 'post' || tag === 'bar') sound.woodwork(speedIn);
    if (tag === 'keeper') sound.parry(speedIn);
  });
  match.step(PHYSICS_STEP);
  net.step(PHYSICS_STEP);
}

// Replays: record each kick from its start; play the last one back on request.
const recorder = new Recorder([ballMesh, keeperMesh.object, kickers.object], net);
const replay = new Replay(recorder, director, net);
let lastKickState = kick.state.kind;

function toggleReplay(): void {
  if (replay.active) replay.finish();
  else if (kick.state.kind === 'result') replay.begin();
}
hud.onReplayClick(toggleReplay);
hud.onMenuClick(openMenu);
hud.onContactTap((x, y) => {
  if (kick.state.kind === 'aiming' || kick.state.kind === 'charging') kick.contact = clampContact(x, y);
});

/** Start, mark and stop the recording as the kick moves through its states. */
function trackRecording(): void {
  const k = kick.state.kind;
  if (k === lastKickState) return;
  if (k === 'aiming' || k === 'cpuRunUp') recorder.start();
  if (k === 'ballInFlight') recorder.markStrike();
  if (k === 'nextKick') recorder.stop();
  lastKickState = k;
}

function render(gameDt: number): void {
  const p = ball.translation();
  const r = ball.rotation();
  ballMesh.position.set(p.x, p.y, p.z);
  ballMesh.quaternion.set(r.x, r.y, r.z, r.w);
  keeperMesh.update(gameDt);
  kickers.update(gameDt, kick);

  const state = kick.state.kind;
  const power = state === 'charging' ? kick.power : null;
  reticle.keeperMode = match.keeperAiming;
  reticle.visible = state === 'aiming' || state === 'charging' || match.keeperAiming;
  if (match.keeperAiming) reticle.update(match.keeperAim, 0, 0);
  else reticle.update(kick.aim, scatterForPower(power ?? 0), overpower(power ?? 0));
  hud.setContact(state === 'aiming' || state === 'charging' ? kick.contact : null);
  if (kick.runUp !== null) hud.setRunUp(kick.runUp);
  else hud.setPower(state === 'aiming' ? 0 : power);
  hud.setReplay(state === 'result' && replay.available ? 'available' : null);

  trackRecording();
  recorder.capture(gameDt);
  renderer.render(scene, camera);
}

/** A replay frame: the recorder poses the scene; nothing live is updated. */
function renderReplay(): void {
  reticle.visible = false;
  hud.setReplay('playing');
  renderer.render(scene, camera);
}

let last = performance.now();
let accumulator = 0;

// Debug aid: ?timescale=0.1 runs the whole game at a tenth of the speed, for checking animation.
const debugTimeScale = Number(new URLSearchParams(location.search).get('timescale') ?? 1) || 1;

function frame(now: number): void {
  // Paused while the menu is open: keep rendering, but no game time passes.
  const realDt = menu.isOpen ? 0 : Math.min((now - last) / 1000, 0.25) * debugTimeScale;
  last = now;
  if (replay.active) {
    // The game is frozen during a replay; a click or tap ends it early.
    if (input.consumePress()) replay.finish();
    else replay.update(realDt);
    if (replay.active) {
      renderReplay();
      requestAnimationFrame(frame);
      return;
    }
    input.consumeRelease();
  }
  director.update(realDt, ball.translation(), kick.state.kind === 'ballInFlight', keeper);
  // Slow motion: the same fixed physics step, just fewer of them per real second.
  const gameDt = realDt * director.timeScale;
  accumulator += gameDt;
  while (accumulator >= PHYSICS_STEP) {
    fixedStep();
    accumulator -= PHYSICS_STEP;
  }
  render(gameDt);
  requestAnimationFrame(frame);
}

window.addEventListener('resize', () => director.refit());
hud.setKeeperLevel(keeper.level, DEBUG);
document.getElementById('loading')?.remove();
menu.open(false);
requestAnimationFrame(frame);
