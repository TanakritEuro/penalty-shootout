# Penalty Shootout

A 3D penalty-shootout game for the browser, built with Three.js, Rapier and TypeScript.

```bash
npm install
npm run dev
```

Open http://localhost:5173.

**Controls:** move the mouse to aim, hold the left button to charge the power meter and
release to shoot. Charging into the red zone overpowers the shot so it drifts high and
wide. It's a best-of-five shootout against Copper Vale, then sudden death. Click to skip a
result, **R** to restart the shootout, **1 / 2 / 3** to set the
CPU keeper to easy / normal / hard.

**In goal** (on the CPU's kicks): the bottom meter shows the kicker's run-up. Dive with the
arrow keys (← / → for a side, plus ↑ / ↓ for high / low; ↑ alone jumps, ↓ alone gets down)
or click where you want to dive. Go as the ball is struck: dive too early and the kicker
puts it the other way.

See `CLAUDE.md` for the architecture, conventions and roadmap.
