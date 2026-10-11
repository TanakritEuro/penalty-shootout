# Penalty Shootout

A 3D penalty-shootout game for the browser, built with Three.js, Rapier and TypeScript.

```bash
npm install
npm run dev
```

Open http://localhost:5173.

Pick your team, the opponent and how good their keeper is in the menu, then **Kick off**.
It's a best-of-five penalty shootout, then sudden death.

**Shooting:** move the mouse to aim, hold the left button to charge the power meter and
release to shoot. Charging into the red zone overpowers the shot so it drifts high and
wide. **W / A / S / D** move where you strike the ball (the dot in the little ball by the
meter): hit it off-centre to curl it, at the cost of some pace and accuracy. Curling it away
from the keeper fools them; bending it in towards them doesn't.

**Other keys:** **Space** replays the last kick in slow motion, **Esc** opens the menu,
**M** mutes, **R** restarts the shootout, **1 / 2 / 3** set the CPU keeper to easy / normal /
hard. Click to skip a result.

**In goal** (on the CPU's kicks) the view switches to behind your goal. Watch the kicker's run-up:
late on, their hips open and they lean towards the side they mean to shoot, though not
every time. The bottom meter shows the run-up too. Dive with the
arrow keys (← / → for a side, plus ↑ / ↓ for high / low; ↑ alone jumps, ↓ alone gets down)
or click where you want to dive. Go as the ball is struck: dive too early and the kicker
puts it the other way.

**On a phone or tablet** (landscape works best): touch and drag to aim, hold to power up,
lift to shoot; tap the little ball to set spin; tap in the goal to dive; ☰ opens the menu.

Play it online at https://tanakriteuro.github.io/penalty-shootout/ (every push to `main` redeploys).

**Debugging:** add `?debug` to the URL for **R** (restart the shootout) and **1 / 2 / 3** (CPU
keeper level), and `?timescale=0.1` to run the whole game at a tenth of the speed.

See `CLAUDE.md` for the architecture, conventions and roadmap.
