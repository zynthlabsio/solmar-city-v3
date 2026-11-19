// Mission definitions for Solmar City. Each mission is a short chain of
// steps; the world simulation walks the chain as the player satisfies each
// step. Keeping the definitions as plain data (separate from the simulation)
// means the test suite can verify every mission is well-formed — markers
// exist, rewards are positive, step kinds are known — without a browser.
//
// Step kinds the simulation understands:
//   goto     — reach the point (on foot or driving), optional time limit
//   collect  — pick up N glowing cases scattered by the scatter function
//   escape   — the heat is raised on purpose; get the wanted level back to 0
//   takedown — defeat the marked rival and their guards at the point
//   race     — pass every checkpoint in order before the clock runs out

import { createRng, randRange } from './rng.js';

export const STEP_GOTO = 'goto';
export const STEP_COLLECT = 'collect';
export const STEP_ESCAPE = 'escape';
export const STEP_TAKEDOWN = 'takedown';
export const STEP_RACE = 'race';
export const KNOWN_STEPS = [STEP_GOTO, STEP_COLLECT, STEP_ESCAPE, STEP_TAKEDOWN, STEP_RACE];

/** Scatter `count` pickup points on avenues around a centre, seeded. */
export function scatterPickups(seed, centre, count, spread) {
  const rng = createRng(seed * 31 + 7);
  const lines = [-240, -160, -80, 0, 80, 160, 240];
  const points = [];
  for (let i = 0; i < count; i += 1) {
    // Snap each scatter point onto the nearest avenue crossing so a case
    // never lands inside a building: one axis takes an avenue line, the
    // other stays near the centre.
    const alongX = rng() < 0.5;
    const line = lines[Math.floor(rng() * lines.length)];
    const near = Math.max(-230, Math.min(230, (alongX ? centre.z : centre.x) + randRange(rng, -spread, spread)));
    points.push(alongX ? { x: near, z: line } : { x: line, z: near });
  }
  return points;
}

/** Checkpoint loop for the sprint: a tour of intersections around the centre. */
export function raceCheckpoints() {
  return [
    { x: 0, z: 160 }, { x: 80, z: 160 }, { x: 80, z: 80 }, { x: 160, z: 80 },
    { x: 160, z: 0 }, { x: 80, z: 0 }, { x: 80, z: -80 }, { x: 0, z: -80 },
    { x: 0, z: 0 },
  ];
}

/**
 * The full mission list. `marker` names a place in city.places where the
 * job can be picked up; `steps` are built against the same places so the
 * data can be checked statically.
 */
export function missionCatalogue(city) {
  const p = city.places;
  return [
    {
      id: 'hot-box',
      title: 'Hot Box Delivery',
      giver: 'Sunbean Café',
      blurb: 'A catering box that cannot get cold. Pick it up, then run it across town.',
      reward: 250,
      marker: p.cafe,
      steps: [
        { kind: STEP_GOTO, point: p.cafe, label: 'Pick up the hot box at Sunbean Café' },
        { kind: STEP_GOTO, point: p.dropoff, label: 'Deliver to Marina Suites', timeLimit: 95 },
      ],
    },
    {
      id: 'loose-change',
      title: 'Loose Change',
      giver: 'A nervous courier',
      blurb: 'Six cash cases fell off a van all over downtown. Grab them before anyone else does.',
      reward: 300,
      marker: p.plaza,
      steps: [
        { kind: STEP_COLLECT, point: p.plaza, count: 6, spread: 190, label: 'Collect the cash cases' },
      ],
    },
    {
      id: 'heat-check',
      title: 'Heat Check',
      giver: 'The Old Depot crew',
      blurb: 'Prove you can shake the law: draw three stars of heat, then disappear.',
      reward: 400,
      marker: p.hideout,
      steps: [
        { kind: STEP_ESCAPE, point: p.hideout, heat: 300, label: 'Lose the police' },
      ],
    },
    {
      id: 'palm-court',
      title: 'Palm Court Rival',
      giver: 'A wronged florist',
      blurb: 'A rival crew chief holds court in the park. Walk in and end the argument.',
      reward: 500,
      marker: p.rivalSpot,
      steps: [
        { kind: STEP_TAKEDOWN, point: p.rivalSpot, guards: 2, label: 'Defeat the Palm Court chief' },
      ],
    },
    {
      id: 'solmar-sprint',
      title: 'Solmar Sprint',
      giver: 'The midnight league',
      blurb: 'Nine checkpoints, one clock. Beat the league time and the pot is yours.',
      reward: 350,
      marker: p.raceStart,
      steps: [
        { kind: STEP_RACE, point: p.raceStart, checkpoints: raceCheckpoints(), timeLimit: 85, label: 'Finish the Solmar Sprint' },
      ],
    },
  ];
}
