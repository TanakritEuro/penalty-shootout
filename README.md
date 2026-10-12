# Penalty Shootout

A 3D penalty-shootout game for the browser, built with Three.js, Rapier and TypeScript.

```bash
npm install
npm run dev
```

Open http://localhost:5173.

Pick a mode in the menu, then **Kick off**. Every shootout is best of five, then sudden death.

- **Friendly:** one shootout against the CPU; pick both teams and how good their keeper is.
- **Cup:** quarter-final, semi-final and final against drawn opponents, with the keeper
  getting better each round. Lose once and you're out.
- **2 players** (one keyboard): whoever is shooting aims with the mouse, whoever is in goal
  dives with the arrow keys; you swap every kick.

Your record against the CPU (wins, streaks, scoring and saving rates, cups) is kept in this
browser and shown in the menu. The menu also has an afternoon or floodlit night kick-off, and
**Lite** graphics for slower devices (the default on phones and tablets).

**Shooting:** move the mouse to aim, hold the left button to charge the power meter and
release to shoot. Let go in the bright band (the meter glows) for full pace on target;
charging into the red zone overpowers the shot so it drifts high and wide. **W / A / S / D** move where you strike the ball (the dot in the little ball by the
meter): hit it off-centre to curl it, at the cost of some pace and accuracy. Curling it away
from the keeper fools them; bending it in towards them doesn't.

**Other keys:** **Space** replays the last kick in slow motion (after the final whistle, it
plays the highlights: every kick of the shootout), **Esc** opens the menu,
**M** mutes. Click to skip a result.

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
keeper level), `?hints` to see the first-time tips again, `?timescale=0.1` to run the whole game at a tenth of the speed, and `?stats` for
frame rate, frame time, draw calls and triangles.

See `CLAUDE.md` for the architecture, conventions and roadmap.
