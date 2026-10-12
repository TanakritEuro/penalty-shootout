# Penalty Shootout

A 3D browser penalty-shootout game. The player takes penalties against an AI keeper
(and later keeps goal against AI kickers), best of five, then sudden death.

Built with Three.js (rendering), Rapier (physics, `@dimforge/rapier3d-compat`),
TypeScript and Vite. No backend of our own: online play is peer to peer over WebRTC
(PeerJS), using the free public PeerJS server only to introduce the two browsers.

## Commands

- `npm install` — first-time setup
- `npm run dev` — dev server at http://localhost:5173 (hot reload)
- `npm run build` — typecheck + production build into `dist/`
- `npm run typecheck` — types only
- `npm test` — Vitest: shootout rules, flight solver, outcomes, keeper balance (headless physics)

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
`TUNING.playerKeeper`.

Milestone 5 (curve and feel) is in: quadratic drag and Magnus lift act on the ball every
step (`shooting/aero.ts`). The launch solver (`shooting/trajectory.ts`) flies a ghost ball
in a private Rapier world, so predictions match the real flight exactly; always predict
through it rather than with closed-form maths. W / A / S / D set the contact point
(`shooting/spin.ts`); the AI keeper reads the line the ball sets off on (`curveRead`).
`camera/director.ts` cuts to a goal-line camera in slow motion on close calls, and
`net.ts` ripples the net on impact.

Milestone 6 (characters) is in, procedurally: `characters/rig.ts` is a humanoid built in
code (joint hierarchy, low-poly limbs, kit colours, poses); it now drives Quaternius'
Mannequin (see below) rather than being shown itself. The keeper mesh
is posed from the physics pose (gloves sit on the glove colliders). `characters/kicker.ts`
derives the kicker's run-up, strike, follow-through and reaction from the Kick (`approach`,
`sinceStrike`), so the boot meets the ball on the launch step; the player's release starts
a short `striking` stride before the ball goes. On CPU kicks the director uses a camera
behind the net and the CPU kicker shows a hip/lean tell (`tellHonesty`). `?timescale=0.1`
slows the whole game for checking animation.

Milestone 7 (polish) is in: a start/pause menu (`ui/menu.ts`) picks both teams from six
invented ones in `match/teams.ts` (`TEAMS` is the current matchup) and the CPU keeper's
level. All audio is synthesised with Web Audio in `audio/sound.ts` (crowd bed and
reactions, whistle, kick, woodwork, net, parry); it starts on the Kick off click.
`replay/` records each kick's on-screen transforms and plays the last one back in slow
motion from a side camera (Space). Touch works through pointer events; the HUD compacts on
phone-sized screens and the director widens the field of view on narrow ones (`fitFov`).
All seven roadmap milestones are done. Since then: modes (`match/session.ts`: friendly, a
three-round cup, two players on one keyboard), saved stats (`match/stats.ts`, localStorage),
end-of-shootout highlights (every kick's clip, played back to back), Vitest tests and a
GitHub Actions workflow that tests, builds and deploys to GitHub Pages, and Quaternius'
Mannequin as the kicker and keeper model (`characters/skinned.ts`: the procedural rig still
computes every pose and drives the model's skeleton; the model's idle, jog and dance clips
blend in where they fit; the capsule rig shows if the model fails to load). Rebuild the
model with `scripts/prepare-models.mjs`. A stadium surrounds the pitch (`stadium.ts`), with a
night option and Full / Lite graphics. Feedback: a faint trail behind hard shots (`trail.ts`),
camera shake off the woodwork, a cut to the scorer celebrating after a human's goal
(`director.celebrate`), a sweet-spot band on the power meter and first-time tips
(`ui/hints.ts`, shown until acted on or twice, remembered per browser).

Online play (`src/online/`, menu mode Online): one player creates a room and shares a
four-character code, the other joins with it (`link.ts`: PeerJS, a reliable `events`
channel and an unordered `frames` channel, heartbeats). The host is authoritative: its
browser runs physics and the Match as usual, with the guest as a `RemoteSeat` playing the
`cpu` side (`host.ts`). The guest's device runs no physics; it plays back the host's
on-screen transforms (the replay recorder's snapshot, 16-bit, 30 a second, `frames.ts`)
about 0.1 s behind with interpolation, and gets its own camera (a second Director on the
host), HUD text written from its point of view, and sounds (`Sound.echo`). The guest aims
and charges locally and sends only the release (with the power its own meter reached) and
dives, so its controls don't lag (`guest.ts`). No replays or pausing online. Bump
`PROTOCOL` in `protocol.ts` when a message changes. What's left is
playtesting and tuning.

## Layout

- `src/constants.ts` — real-world dimensions and physics constants. Use these, never magic numbers.
- `src/scene.ts` — Three.js renderer, camera, lights, pitch, markings, goal frame.
- `src/net.ts` — goal net panels and their ripple.
- `src/trail.ts` — the streak behind hard shots (follows the ball mesh, so replays have it too).
- `src/stadium.ts` — stands, the instanced crowd (animated in its vertex shader), ad boards with
  invented sponsors, floodlights.
- `src/physics.ts` — Rapier world and colliders.
- `src/config.ts` — `TUNING`: every gameplay knob (power, spin, curve, keepers, camera, slow motion, net).
- `src/main.ts` — entry point: builds the `Game` and starts it.
- `src/game/` — `game.ts` (wires everything; frame loop: fixed physics steps, then render),
  `online.ts` (create / join / leave an online game),
  `replays.ts` (per-kick recording, replay and highlights offers), `debug.ts` (URL debug flags and
  the `?stats` overlay), `graphics.ts` (Full / Lite graphics, remembered per browser).
- `src/input/` — pointer input, keeper arrow keys and spin keys, latched for the fixed step.
- `src/shooting/` — aim and reticle, power model, spin, aerodynamics, launch solver, outcome
  tracker, CPU kicker.
- `src/match/` — `kick.ts` (one penalty's state machine, human or CPU), `shootout.ts` (scoring
  rules), `match.ts` (whole-shootout flow), `session.ts` (modes and the cup), `stats.ts`
  (saved record), `teams.ts` (invented teams and kits).
- `src/keeper/` — keeper body and state machine (`keeper.ts`), dive decision (`brain.ts`),
  pose maths and reach limit (`pose.ts`), rigged mesh posed from the physics (`mesh.ts`).
- `src/characters/` — procedural humanoid rig (`rig.ts`) that computes every pose, the skinned
  Quaternius model it drives (`skinned.ts`) and the animated kickers (`kicker.ts`).
- `public/models/` — the trimmed character model; `scripts/prepare-models.mjs` rebuilds it.
- `src/camera/director.ts` — main / keeper's-eye cameras, close-call cuts and slow motion.
- `src/ui/hud.ts` — DOM HUD (power meter, spin widget, result banner, scoreboard, replay button).
- `src/ui/hints.ts` — first-time tips; `Game.coach()` decides which one fits the moment.
- `src/ui/menu.ts` — start / pause menu: teams, CPU keeper level, sound.
- `src/audio/sound.ts` — synthesised crowd and sound effects.
- `src/replay/` — per-kick recorder (clips) and playback of a replay or the highlights reel.
- `src/online/` — online play: `link.ts` (PeerJS rooms), `protocol.ts` (messages, checked on
  arrival), `frames.ts` (frame packing), `host.ts` (the guest's seat on the host), `guest.ts`.
- `src/input/shooter.ts` — `ShooterControls`: a human kick's input, local or from the network.
- `tests/` — Vitest; `helpers.ts` fires real shots through headless Rapier and has an in-memory
  `Link` pair for online tests.

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

- Run `npm run build` and `npm test` after every change; both must pass. Tests run
  headless Rapier (`tests/helpers.ts` fires real shots); statistical ones seed `Math.random`.
- CI (`.github/workflows/deploy.yml`) runs both on every push and pull request, and deploys
  `main` to GitHub Pages.
- `?hints` shows the first-time tips again. `?stats` shows fps, frame time, draw calls and triangles. The scene is ~310k triangles and
  65 draw calls on Full, ~156k and 55 on Lite; keep an eye on these when adding to it.
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
