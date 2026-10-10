// Real-world football dimensions, in metres / kilograms / seconds.
// World axes: +Y up, goal line on z = 0, kicker stands on the +Z side.

export const GOAL_WIDTH = 7.32; // inside post to inside post
export const GOAL_HEIGHT = 2.44; // ground to underside of crossbar
export const GOAL_DEPTH = 2.0; // how far the net extends behind the goal line
export const POST_RADIUS = 0.06; // posts are 12 cm wide

export const PENALTY_SPOT_Z = 11.0;
export const SIX_YARD_DEPTH = 5.5;
export const PENALTY_AREA_DEPTH = 16.5;
export const PENALTY_AREA_HALF_WIDTH = GOAL_WIDTH / 2 + 16.5;
export const SIX_YARD_HALF_WIDTH = GOAL_WIDTH / 2 + 5.5;
export const PENALTY_ARC_RADIUS = 9.15;

export const BALL_RADIUS = 0.11;
export const BALL_MASS = 0.43;

export const GRAVITY = -9.81;
export const PHYSICS_STEP = 1 / 60;
/** Rapier linear damping on the ball: crude air drag until Milestone 5 adds a real model. */
export const BALL_LINEAR_DAMPING = 0.05;
