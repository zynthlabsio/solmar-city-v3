# Solmar City

[![make.fun gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/c/gta6-01)
[![rank](https://make.fun/badge/gta6-01/maungzy86/solmar-city-v3/rank.svg)](https://make.fun/c/gta6-01)
[![reward](https://make.fun/badge/gta6-01/maungzy86/solmar-city-v3/reward.svg)](https://make.fun/c/gta6-01)

An open-world crime sandbox that runs in the browser. Solmar City is a
procedurally generated coastal grid of avenues, towers, a park and a car
lot — and you are the newest driver-for-hire on its streets. Take jobs from
the glowing markers, earn cash, shake the police when the heat rises, and
work your way through every crew in town until the city is yours.

Built with three.js for rendering and a hand-written, fully deterministic
simulation (city generation, traffic, police AI, wanted system and mission
logic are plain JavaScript modules with no rendering in them, which is
also what the test suite drives headlessly).

## How to play

Open the game, press **Enter**, and walk to a glowing blue job marker.
Jobs pay cash; finishing all five clears the city.

### Controls

| Input | Action |
| --- | --- |
| W A S D / arrow keys | Walk, or drive when in a car |
| Shift | Sprint on foot |
| E | Get into / out of the nearest car |
| F or mouse click | Shoot (on foot) |
| Space | Handbrake (in a car) |
| P or Esc | Pause |

### What is in the city

- **Procedural city** — a seeded 6×6 block grid of avenues with slab
  towers and landmark towers, a park, a parking lot full of spare cars,
  street lamps, trees and alley crates. The same seed always builds the
  same city.
- **On foot and driving** — walk anywhere, take any parked car (the owner
  will report it), or carjack traffic. Arcade driving physics with
  collisions, damage and a handbrake.
- **Wanted system** — crimes (theft, collisions, gunfire, hit-and-runs)
  raise your heat through five stars. Squad cars spawn and hunt you;
  break line of sight, stop offending, and the heat decays. Get pinned on
  foot and the arrest meter fills — busted. Get shot or wreck at speed —
  wasted. Either costs a $100 fine.
- **Traffic and pedestrians** — cars cruise the avenue grid on right-hand
  lanes, turning at intersections; pedestrians stroll the sidewalks and
  flee from fresh crime scenes.
- **Five jobs** — a timed hot-box delivery, a six-case cash collection, a
  three-star escape test, a park takedown against an armed rival chief
  and two guards, and the nine-checkpoint Solmar Sprint race against the
  clock.
- **Combat** — hitscan shooting with tracers; rivals and guards shoot
  back, police ram and arrest.
- **Day–night cycle** — a full day every ~4.5 minutes: sunrise, noon,
  golden dusk, then lamps, lit windows and stars at night.
- **HUD** — cash, health, wanted stars, the active objective with a
  direction arrow and distance, mission timer, a speedometer while
  driving, and a live minimap with jobs, traffic, police and hostiles.

## Run it locally

Requires Node 22 (standard library only, no install step):

```sh
node serve.ts            # serves game/ on http://localhost:8080
```

Then open <http://localhost:8080> in a desktop browser. The game itself
loads three.js from a CDN (pinned in the import map in
`game/index.html`), so the first load needs a network connection.

Useful URLs while developing:

- `http://localhost:8080/?seed=7` — a different city layout
- `http://localhost:8080/?shot=play&seed=1` — the staged screenshot scenes
  (`start`, `play`, `end`)

## Tests

The simulation is engine-free, so the whole rule set is testable in Node:

```sh
node --test tests/logic.test.mjs
```

Sixteen tests cover city determinism and road clearance, the heat/star
bands and decay, vehicle entry, traffic sanity, and every mission played
through to completion — including a full five-mission city clear.

## Handing it in (make.fun kit)

`node main.ts` copies `game/` and `screenshots/` to the output directory
and writes the dossier (`MAKEFUN_OUTPUT_DIR` overrides `/output` outside
the grader's container).

## Layout

```
game/index.html        page, HUD DOM, import map
game/src/main.js       boot, main loop, screens
game/src/world.js      the simulation: player, cars, police, wanted, missions
game/src/city.js       procedural city generation (pure data)
game/src/missions.js   mission catalogue and step definitions (pure data)
game/src/rng.js        seeded random generator
game/src/render3d.js   three.js scene, camera, day/night lighting
game/src/hud.js        HUD, minimap, toasts, panels
game/src/input.js      keyboard/pointer input
game/src/shots.js      staged screenshot scenes
tests/logic.test.mjs   headless logic tests
serve.ts               local static server
main.ts                kit entry: copies the game and writes the dossier
```
