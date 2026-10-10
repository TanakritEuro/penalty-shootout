// Entry point: builds the scene and physics, then runs the game loop.
// Physics and game logic run on a fixed step; rendering runs once per animation frame.

import type { KeeperLevelName } from './config';
import { PHYSICS_STEP } from './constants';
import { KeeperKeys } from './input/keeperKeys';
import { PointerInput } from './input/pointer';
import { Keeper } from './keeper/keeper';
import { KeeperMesh } from './keeper/mesh';
import { Kick } from './match/kick';
import { Match } from './match/match';
import { createPhysics } from './physics';
import { createScene } from './scene';
import { Reticle } from './shooting/aim';
import { overpower, scatterForPower } from './shooting/power';
import { Hud } from './ui/hud';

const canvas = document.querySelector<HTMLCanvasElement>('#game')!;

const { renderer, scene, camera, ball: ballMesh } = createScene(canvas);
const { world, ball, events, tags } = await createPhysics();
const keeper = new Keeper(world, tags);
const keeperMesh = new KeeperMesh(keeper);
scene.add(keeperMesh.object);
const hud = new Hud();
const input = new PointerInput(canvas);
const reticle = new Reticle();
scene.add(reticle.object);

const kick = new Kick(ball, input, camera);
const match = new Match(kick, keeper, keeperMesh, input, new KeeperKeys(), camera, hud);

const LEVEL_KEYS: Record<string, KeeperLevelName> = { Digit1: 'easy', Digit2: 'normal', Digit3: 'hard' };

window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyR') match.restart();
  const level = LEVEL_KEYS[e.code];
  if (level) {
    keeper.level = level;
    hud.setKeeperLevel(level);
  }
});

function fixedStep(): void {
  keeper.step(PHYSICS_STEP);
  world.step(events);
  events.drainCollisionEvents((h1, h2, started) => {
    if (!started) return;
    const tag = tags.get(h1) ?? tags.get(h2);
    if (tag) kick.onBallContact(tag);
  });
  match.step(PHYSICS_STEP);
}

function render(): void {
  const p = ball.translation();
  const r = ball.rotation();
  ballMesh.position.set(p.x, p.y, p.z);
  ballMesh.quaternion.set(r.x, r.y, r.z, r.w);
  keeperMesh.update();

  const state = kick.state.kind;
  const power = state === 'charging' ? kick.power : null;
  reticle.keeperMode = match.keeperAiming;
  reticle.visible = state === 'aiming' || state === 'charging' || match.keeperAiming;
  if (match.keeperAiming) reticle.update(match.keeperAim, 0, 0);
  else reticle.update(kick.aim, scatterForPower(power ?? 0), overpower(power ?? 0));
  if (kick.runUp !== null) hud.setRunUp(kick.runUp);
  else hud.setPower(state === 'aiming' ? 0 : power);

  renderer.render(scene, camera);
}

let last = performance.now();
let accumulator = 0;

function frame(now: number): void {
  accumulator += Math.min((now - last) / 1000, 0.25);
  last = now;
  while (accumulator >= PHYSICS_STEP) {
    fixedStep();
    accumulator -= PHYSICS_STEP;
  }
  render();
  requestAnimationFrame(frame);
}

hud.setKeeperLevel(keeper.level);
requestAnimationFrame(frame);
