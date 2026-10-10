// Scaffold entry point: renders the pitch and goal, and fires a random test shot
// so you can confirm rendering + physics work. Replace the test-kick logic with the
// real game (see CLAUDE.md, Milestone 1).

import { BALL_RADIUS, GOAL_HEIGHT, GOAL_WIDTH, GRAVITY, PENALTY_SPOT_Z, PHYSICS_STEP } from './constants';
import { createPhysics } from './physics';
import { createScene } from './scene';

const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
const status = document.querySelector<HTMLDivElement>('#status')!;

const { renderer, scene, camera, ball: ballMesh } = createScene(canvas);
const { world, ball } = await createPhysics();

let scored = false;

function resetBall(): void {
  ball.setTranslation({ x: 0, y: BALL_RADIUS, z: PENALTY_SPOT_Z }, true);
  ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
  ball.setAngvel({ x: 0, y: 0, z: 0 }, true);
  scored = false;
  status.textContent = 'Space: test shot · R: reset';
}

/** Launch the ball so it arrives at (tx, ty) on the goal line at roughly `speed` m/s. */
function testKick(): void {
  const tx = (Math.random() - 0.5) * (GOAL_WIDTH + 1.5);
  const ty = 0.3 + Math.random() * (GOAL_HEIGHT + 0.3);
  const speed = 24;

  const p = ball.translation();
  const dx = tx - p.x;
  const dz = 0 - p.z;
  const horizontal = Math.hypot(dx, dz);
  const time = horizontal / speed;
  const vy = (ty - p.y - 0.5 * GRAVITY * time * time) / time;

  ball.setLinvel({ x: (dx / horizontal) * speed, y: vy, z: (dz / horizontal) * speed }, true);
  status.textContent = 'Shot!';
}

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    resetBall();
    testKick();
  } else if (e.code === 'KeyR') {
    resetBall();
  }
});

function checkGoal(): void {
  if (scored) return;
  const p = ball.translation();
  // Whole ball over the line, between the posts, under the bar.
  if (p.z < -BALL_RADIUS && Math.abs(p.x) < GOAL_WIDTH / 2 && p.y < GOAL_HEIGHT) {
    scored = true;
    status.textContent = 'GOAL!';
  }
}

// Fixed-timestep physics, variable-rate rendering.
let last = performance.now();
let accumulator = 0;

function frame(now: number): void {
  accumulator += Math.min((now - last) / 1000, 0.25);
  last = now;

  while (accumulator >= PHYSICS_STEP) {
    world.step();
    checkGoal();
    accumulator -= PHYSICS_STEP;
  }

  const p = ball.translation();
  const r = ball.rotation();
  ballMesh.position.set(p.x, p.y, p.z);
  ballMesh.quaternion.set(r.x, r.y, r.z, r.w);

  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

resetBall();
requestAnimationFrame(frame);
