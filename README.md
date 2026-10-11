# Penalty Shootout

A 3D penalty-shootout game for the browser, built with Three.js, Rapier and TypeScript.

```bash
npm install
npm run dev
```

Open http://localhost:5173.

**Controls:** move the mouse to aim, hold the left button to charge the power meter and
release to shoot. Charging into the red zone overpowers the shot so it drifts high and
wide. **W / A / S / D** move where you strike the ball (the dot in the little ball by the
meter): hit it off-centre to curl it, at the cost of some pace and accuracy. Curling it away
from the keeper fools them; bending it in towards them doesn't. It's a best-of-five
shootout against Copper Vale, then sudden death. Click to skip a
result, **R** to restart the shootout, **1 / 2 / 3** to set the
CPU keeper to easy / normal / hard.

**In goal** (on the CPU's kicks) the view switches to behind your goal. Watch the kicker's run-up:
late on, their hips open and they lean towards the side they mean to shoot, though not
every time. The bottom meter shows the run-up too. Dive with the
arrow keys (← / → for a side, plus ↑ / ↓ for high / low; ↑ alone jumps, ↓ alone gets down)
or click where you want to dive. Go as the ball is struck: dive too early and the kicker
puts it the other way.

See `CLAUDE.md` for the architecture, conventions and roadmap.
