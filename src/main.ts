// Entry point: builds the scene and physics, then runs the game loop.
// Physics and game logic run on a fixed step; rendering runs once per animation frame.

import { PHYSICS_STEP } from './constants';
import { PointerInput } from './input/pointer';
import { Kick } from './match/kick';
import { createPhysics } from './physics';
import { createScene } from './scene';
import { Reticle } from './shooting/aim';
import { describeOutcome } from './shooting/outcome';
import { overpower, scatterForPower } from './shooting/power';
import { Hud } from './ui/hud';

const canvas = document.querySelector<HTMLCanvasElement>('#game')!;

const { renderer, scene, camera, ball: ballMesh } = createScene(canvas);
const { world, ball, events, tags } = await createPhysics();
const hud = new Hud();
const input = new PointerInput(canvas);
const reticle = new Reticle();
scene.add(reticle.object);

const HINT = 'Aim with the mouse · hold to power up · release to shoot';
let goals = 0;
let shots = 0;

const kick = new Kick(ball, input, camera, {
  onShot: () => hud.setStatus(''),
  onResult: (outcome, launchSpeed) => {
    shots++;
    if (outcome.kind === 'goal') goals++;
    hud.setTally(goals, shots);
    hud.showResult(describeOutcome(outcome), `${Math.round(launchSpeed * 3.6)} km/h`, outcome.kind === 'goal');
  },
  onNextKick: () => {
    hud.hideResult();
    hud.setStatus(HINT);
  },
});

window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyR') kick.reset();
});

function fixedStep(): void {
  world.step(events);
  events.drainCollisionEvents((h1, h2, started) => {
    if (!started) return;
    const tag = tags.get(h1) ?? tags.get(h2);
    if (tag) kick.onBallContact(tag);
  });
  kick.step(PHYSICS_STEP);
}

function render(): void {
  const p = ball.translation();
  const r = ball.rotation();
  ballMesh.position.set(p.x, p.y, p.z);
  ballMesh.quaternion.set(r.x, r.y, r.z, r.w);

  const state = kick.state.kind;
  const power = state === 'charging' ? kick.power : null;
  reticle.visible = state === 'aiming' || state === 'charging';
  reticle.update(kick.aim, scatterForPower(power ?? 0), overpower(power ?? 0));
  hud.setPower(state === 'aiming' ? 0 : power);

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

hud.setTally(goals, shots);
hud.setStatus(HINT);
requestAnimationFrame(frame);
