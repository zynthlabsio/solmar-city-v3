// Procedural layout for Solmar City. The city is a square grid of avenues:
// avenue centrelines sit on fixed coordinates, blocks live between them, and
// every block is filled from the seeded generator — most with slab towers,
// one with a park, one left as a parking lot where spare cars wait. This
// module is pure data: no rendering, no DOM, so the test suite can build a
// city in Node and check the invariants the rest of the game relies on
// (roads stay clear of buildings, mission spots sit on open ground, ...).

import { createRng, randInt, randRange, pick, chance } from './rng.js';

/** Distance between neighbouring avenue centrelines, in metres. */
export const PITCH = 80;
/** Half the width of an avenue (asphalt plus parking lane). */
export const ROAD_HALF = 10;
/** How many blocks sit along one side of the city. */
export const BLOCKS_PER_SIDE = 6;
/** Avenue centrelines: -240, -160, ..., 240. */
export const AVENUE_LINES = [];
for (let i = 0; i <= BLOCKS_PER_SIDE; i += 1) AVENUE_LINES.push((i - BLOCKS_PER_SIDE / 2) * PITCH);
/** The city spans from -CITY_EDGE to +CITY_EDGE on both axes. */
export const CITY_EDGE = (BLOCKS_PER_SIDE / 2) * PITCH + ROAD_HALF + 14;

/** Building facade hues, grouped so districts feel related rather than random. */
const FACADE_SETS = [
  [0xd9c9a3, 0xc7b299, 0xe6d7b8, 0xbfae94],
  [0x9fb4c7, 0x8ba3ba, 0xb7c9d9, 0x7e97ad],
  [0xd9a08a, 0xc78f74, 0xe6bfa8, 0xba8266],
  [0xa8b89a, 0x96a886, 0xc2d1b4, 0x87977a],
];

/** True when the point is on asphalt (inside either an avenue strip). */
export function onRoad(x, z) {
  for (const line of AVENUE_LINES) {
    if (Math.abs(x - line) < ROAD_HALF || Math.abs(z - line) < ROAD_HALF) return true;
  }
  return false;
}

/** The avenue centreline nearest to a coordinate — used to snap spawns onto roads. */
export function nearestAvenue(value) {
  let best = AVENUE_LINES[0];
  for (const line of AVENUE_LINES) {
    if (Math.abs(line - value) < Math.abs(best - value)) best = line;
  }
  return best;
}

/**
 * Build the whole city for a seed. Returns buildings (with axis-aligned
 * footprints the physics can test), lamps, trees, parked cars, sidewalk
 * waypoints for pedestrians, and named places missions point at.
 */
export function generateCity(seed) {
  const rng = createRng(seed * 7919 + 13);
  const buildings = [];
  const trees = [];
  const lamps = [];
  const parkedCars = [];
  const crates = [];

  // Lamps hug every intersection corner, offset just off the asphalt.
  for (const x of AVENUE_LINES) {
    for (const z of AVENUE_LINES) {
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          lamps.push({ x: x + sx * (ROAD_HALF + 2.5), z: z + sz * (ROAD_HALF + 2.5) });
        }
      }
    }
  }

  // Two special blocks: a park in the north-west, a car lot in the south-east.
  const parkBlock = { bx: 1, bz: 1 };
  const lotBlock = { bx: 4, bz: 4 };

  for (let bx = 0; bx < BLOCKS_PER_SIDE; bx += 1) {
    for (let bz = 0; bz < BLOCKS_PER_SIDE; bz += 1) {
      const x0 = AVENUE_LINES[bx] + ROAD_HALF;
      const z0 = AVENUE_LINES[bz] + ROAD_HALF;
      const inner = PITCH - ROAD_HALF * 2; // 60 m of buildable ground
      const cx = x0 + inner / 2;
      const cz = z0 + inner / 2;
      const facades = FACADE_SETS[(bx + bz * 2) % FACADE_SETS.length];

      if (bx === parkBlock.bx && bz === parkBlock.bz) {
        // The park: lawn, a ring of trees and a few benches (crates stand in).
        for (let t = 0; t < 14; t += 1) {
          trees.push({ x: x0 + 6 + rng() * (inner - 12), z: z0 + 6 + rng() * (inner - 12), s: randRange(rng, 0.8, 1.5) });
        }
        crates.push({ x: cx - 8, z: cz, w: 2, d: 2 });
        crates.push({ x: cx + 8, z: cz + 5, w: 2, d: 2 });
        continue;
      }

      if (bx === lotBlock.bx && bz === lotBlock.bz) {
        // The parking lot: two rows of spare cars, free for the taking.
        for (let row = 0; row < 2; row += 1) {
          for (let col = 0; col < 4; col += 1) {
            parkedCars.push({
              x: x0 + 12 + col * 11,
              z: z0 + 16 + row * 26,
              heading: row === 0 ? Math.PI / 2 : -Math.PI / 2,
              hue: randInt(rng, 0, 5),
            });
          }
        }
        continue;
      }

      // Ordinary block: either one tower on a plinth or four slabs in a quad.
      if (chance(rng, 0.3)) {
        const w = randRange(rng, 30, 40);
        const d = randRange(rng, 30, 40);
        buildings.push({
          x: cx, z: cz, w, d,
          h: randRange(rng, 55, 95),
          color: pick(rng, facades),
          roof: 0x3a3f47,
        });
      } else {
        const offs = [[-15, -15], [15, -15], [-15, 15], [15, 15]];
        for (const [ox, oz] of offs) {
          if (chance(rng, 0.12)) continue; // the odd empty corner keeps it organic
          const w = randRange(rng, 20, 27);
          const d = randRange(rng, 20, 27);
          buildings.push({
            x: cx + ox, z: cz + oz, w, d,
            h: randRange(rng, 14, 52),
            color: pick(rng, facades),
            roof: 0x424750,
          });
        }
      }

      // A crate or two in the alleys, and street trees along the south edge.
      if (chance(rng, 0.55)) {
        crates.push({ x: x0 + 4 + rng() * 8, z: z0 + 4 + rng() * (inner - 8), w: 2, d: 2 });
      }
      for (let t = 0; t < 3; t += 1) {
        trees.push({ x: x0 + 8 + t * 22, z: z0 + inner + 3.4, s: randRange(rng, 0.7, 1.1) });
      }
    }
  }

  // Named places: chosen on open ground (park, lot, intersections) so a
  // mission marker never lands inside a tower.
  const places = {
    cafe: { name: 'Sunbean Café', x: -160, z: -200 },
    dropoff: { name: 'Marina Suites', x: 240, z: 80 },
    plaza: { name: 'Founders Plaza', x: -80, z: -80 },
    hideout: { name: 'Old Depot', x: 160, z: 240 },
    raceStart: { name: 'Solmar Sprint Start', x: 0, z: 240 },
    rivalSpot: { name: 'Palm Court', x: -160 + 40, z: -160 + 40 },
  };

  return { buildings, trees, lamps, parkedCars, crates, places, seed };
}

/** Axis-aligned box overlap test used by every collision check in the game. */
export function circleHitsBox(x, z, radius, box) {
  const dx = Math.max(Math.abs(x - box.x) - box.w / 2, 0);
  const dz = Math.max(Math.abs(z - box.z) - box.d / 2, 0);
  return dx * dx + dz * dz < radius * radius;
}

/** Keep a point inside the city walls. */
export function clampToCity(value) {
  return Math.max(-CITY_EDGE, Math.min(CITY_EDGE, value));
}
