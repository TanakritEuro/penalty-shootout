# Penalty Shootout

A 3D browser penalty-shootout game. The player takes penalties against an AI keeper
(and later keeps goal against AI kickers), best of five, then sudden death.

Built with Three.js (rendering), Rapier (physics, `@dimforge/rapier3d-compat`),
TypeScript and Vite. No backend.

## Commands

- `npm install` — first-time setup
- `npm run dev` — dev server at http://localhost:5173 (hot reload)
- `npm run build` — typecheck + production build into `dist/`
- `npm run typecheck` — types only

Requires Node 20.19+ or 22.12+ (Vite 8).

## Current state

Milestone 1 (shooting) is in: mouse aim with a reticle, hold-to-charge power with
overpower drift, a kick state machine (`src/match/kick.ts`) and goal / woodwork / miss
detection from the ball's position plus Rapier contact events.

Milestone 2 (keeper) is in: a kinematic capsule keeper that reads or guesses the shot,
dives after a reaction delay with limited reach, and parries the ball through physics.
Easy / normal / hard levels live in `TUNING.keeper`; keys 1/2/3 switch level in game.

Milestone 3 (shootout) is in: `match/shootout.ts` holds the scoring rules (five each,
early finish, sudden death), `match/match.ts` the Intro → Kicking → Finished flow, and
the HUD shows a kick-by-kick scoreboard. The CPU side's kicks are taken by a simple CPU
kicker (`shooting/cpuKicker.ts`).

Milestone 4 (player as keeper) is in: on the CPU's kicks the player keeps goal, diving
with the arrow keys (`input/keeperKeys.ts`) or a click under a green reticle. The bottom
meter shows the CPU's run-up; diving more than `earlyCommitWindow` before the strike makes
the kicker go the other way. Dives steer onto a ball within `assistRadius`. Tuning is in
`TUNING.playerKeeper`. There is nothing to read the kicker by yet, so saves are guesses
until Milestone 6 adds a kicker with a run-up animation.

Milestone 5 (curve and feel) is in: quadratic drag and Magnus lift act on the ball every
step (`shooting/aero.ts`). The launch solver (`shooting/trajectory.ts`) flies a ghost ball
in a private Rapier world, so predictions match the real flight exactly; always predict
through it rather than with closed-form maths. W / A / S / D set the contact point
(`shooting/spin.ts`); the AI keeper reads the line the ball sets off on (`curveRead`).
`camera/director.ts` cuts to a goal-line camera in slow motion on close calls, and
`net.ts` ripples the net on impact.

## Layout

- `src/constants.ts` — real-world dimensions and physics constants. Use these, never magic numbers.
- `src/scene.ts` — Three.js renderer, camera, lights, pitch, markings, goal frame.
- `src/net.ts` — goal net panels and their ripple.
- `src/physics.ts` — Rapier world and colliders.
- `src/config.ts` — `TUNING`: every gameplay knob (power, spin, curve, keepers, camera, slow motion, net).
- `src/main.ts` — entry point, fixed-step loop, feeds physics contacts to the kick.
- `src/input/` — pointer input, keeper arrow keys and spin keys, latched for the fixed step.
- `src/shooting/` — aim and reticle, power model, spin, aerodynamics, launch solver, outcome
  tracker, CPU kicker.
- `src/match/` — `kick.ts` (one penalty's state machine, player or CPU), `shootout.ts` (scoring
  rules), `match.ts` (whole-shootout flow), `teams.ts` (invented teams and colours).
- `src/keeper/` — keeper body and state machine (`keeper.ts`), dive decision (`brain.ts`),
  pose maths and reach limit (`pose.ts`), placeholder mesh (`mesh.ts`).
- `src/camera/director.ts` — close-call camera cuts and slow motion (scales game time).
- `src/ui/hud.ts` — DOM HUD (power meter, spin widget, result banner, scoreboard, keeper level).

As the game grows, add modules such as `audio/`.

## Conventions

- Units are SI: metres, kilograms, seconds. +Y is up. The goal line is z = 0 and the
  kicker is on the +Z side, with the penalty spot at z = 11.
- Physics runs on a fixed timestep (`PHYSICS_STEP`); rendering is variable-rate.
  Game logic that depends on physics runs inside the fixed-step loop.
- Physics is the source of truth for the ball. Meshes copy their transform from
  rigid bodies, never the other way round.
- Keep tuning values (shot power, keeper reaction time, dive reach, curve strength)
  in one config object so they are easy to tweak during playtesting.
- Drive the match flow with an explicit state machine
  (e.g. `Aiming → Charging → BallInFlight → Result → NextKick`), not scattered flags.
- Strict TypeScript. No `any` unless there is a comment explaining why.
- No real club names, crests, kits or player names. Invented teams only.

## Assets

Placeholder geometry is fine until the gameplay is fun. When real assets are added,
use free, permissively licensed sources (Kenney, Quaternius, Poly Haven, Mixamo
characters), put them under `public/`, and record each one with its licence in
`ASSETS.md`. Prefer `.glb` for models.

## Verifying changes

- Run `npm run build` after every change; it must pass with no type errors.
- For visual or gameplay changes, run the dev server and check it in a browser
  (screenshot if possible) before calling something done. Check the console for errors.
- Game feel (power curve, keeper difficulty, camera) can't be judged by reading code.
  Ask me to playtest and describe what feels off, then tune.

## Roadmap

Work one milestone at a time and keep the game playable at the end of each.

1. **Shooting.** Mouse aim over the goal mouth with a visible reticle, hold-to-charge
   power meter, release to shoot. Overpowered shots drift high and wide. Ball hits
   posts/bar realistically. Goal / miss / post detection.
2. **Keeper.** Simple keeper body (capsule or low-poly) that picks a dive side and
   height with a reaction delay and limited reach. Saves deflect the ball. Difficulty
   levels via the tuning config.
3. **Shootout rules.** Five kicks each, alternating, sudden death, early finish when one
   side can't catch up. Scoreboard HUD with kick-by-kick dots.
4. **Player as keeper.** Swap roles on alternate kicks: AI kicker picks a target, the
   player dives with arrow keys or mouse, timed to the kick.
5. **Curve and feel.** Spin from off-centre contact, Magnus-force curve, proper air drag,
   camera cuts and slow-motion on close calls, net ripple.
6. **Characters.** Rigged kicker and keeper (e.g. Mixamo) with run-up, kick and dive
   animations, synced to the physics events.
7. **Polish.** Menus, team select (invented teams and kit colours), crowd ambience and
   sound effects, replays, mobile touch controls.
