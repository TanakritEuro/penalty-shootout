import RAPIER from '@dimforge/rapier3d-compat';
import {
  BALL_MASS,
  BALL_RADIUS,
  GOAL_DEPTH,
  GOAL_HEIGHT,
  GOAL_WIDTH,
  GRAVITY,
  PHYSICS_STEP,
  POST_RADIUS,
} from './constants';

export interface Physics {
  world: RAPIER.World;
  ball: RAPIER.RigidBody;
}

export async function createPhysics(): Promise<Physics> {
  await RAPIER.init();

  const world = new RAPIER.World({ x: 0, y: GRAVITY, z: 0 });
  world.timestep = PHYSICS_STEP;

  // Ground
  world.createCollider(
    RAPIER.ColliderDesc.cuboid(40, 0.1, 40)
      .setTranslation(0, -0.1, 20)
      .setFriction(0.6)
      .setRestitution(0.5),
  );

  // Goal frame: posts and crossbar bounce the ball hard.
  const halfW = GOAL_WIDTH / 2 + POST_RADIUS;
  const topY = GOAL_HEIGHT + POST_RADIUS;
  for (const x of [-halfW, halfW]) {
    world.createCollider(
      RAPIER.ColliderDesc.cylinder(topY / 2, POST_RADIUS)
        .setTranslation(x, topY / 2, 0)
        .setRestitution(0.7),
    );
  }
  const s = Math.SQRT1_2; // quaternion for 90° about Z (cylinder axis Y -> X)
  world.createCollider(
    RAPIER.ColliderDesc.cylinder(halfW + POST_RADIUS, POST_RADIUS)
      .setTranslation(0, topY, 0)
      .setRotation({ x: 0, y: 0, z: s, w: s })
      .setRestitution(0.7),
  );

  // Net: thin walls that soak up the ball's energy (placeholder for a real net).
  const t = 0.02;
  const net = (hx: number, hy: number, hz: number, x: number, y: number, z: number) =>
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(hx, hy, hz)
        .setTranslation(x, y, z)
        .setRestitution(0.05)
        // Use the net's own (low) bounce instead of averaging it with the ball's.
        .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min)
        .setFriction(0.9),
    );
  net(halfW, topY / 2, t, 0, topY / 2, -GOAL_DEPTH); // back
  net(halfW, t, GOAL_DEPTH / 2, 0, topY, -GOAL_DEPTH / 2); // roof
  net(t, topY / 2, GOAL_DEPTH / 2, -halfW, topY / 2, -GOAL_DEPTH / 2); // left side
  net(t, topY / 2, GOAL_DEPTH / 2, halfW, topY / 2, -GOAL_DEPTH / 2); // right side

  // Ball
  const ball = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setLinearDamping(0.05) // crude air drag; replace with a proper drag + Magnus model
      .setAngularDamping(0.4)
      .setCcdEnabled(true), // fast shots must not tunnel through posts or net
  );
  world.createCollider(
    RAPIER.ColliderDesc.ball(BALL_RADIUS).setMass(BALL_MASS).setRestitution(0.6).setFriction(0.5),
    ball,
  );

  return { world, ball };
}
