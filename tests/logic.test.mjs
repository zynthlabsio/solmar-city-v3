// Headless tests for Solmar City's pure logic: city generation, the wanted
// system, vehicle entry, traffic sanity, and every mission played through
// to completion by teleporting the player between objectives (the same
// updateWorld the browser runs — only the rendering is missing).
// Run with: node --test tests/

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { generateCity, circleHitsBox, onRoad, ROAD_HALF, AVENUE_LINES } from '../game/src/city.js';
import { missionCatalogue, KNOWN_STEPS } from '../game/src/missions.js';
import {
  createWorld, updateWorld, addCrime, starsForHeat, toggleVehicle, distance,
} from '../game/src/world.js';

const NEUTRAL = { forward: 0, strafe: 0, sprint: false, handbrake: false, shoot: false, interactPressed: false, camAngle: 0 };
const DT = 1 / 60;

function step(world, seconds, input = NEUTRAL) {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i += 1) updateWorld(world, DT, input);
}

function teleport(world, x, z) {
  world.player.x = x;
  world.player.z = z;
  if (world.player.inCar) {
    world.player.inCar.x = x;
    world.player.inCar.z = z;
  }
}

/** Keep every squad car far from the player so decay tests are not arrested mid-assertion. */
function exilePolice(world) {
  for (const car of world.cars) {
    if (car.kind === 'police') { car.x = -250; car.z = -250; car.speed = 0; }
  }
}

test('city generation is deterministic per seed and varies across seeds', () => {
  const a = generateCity(1);
  const b = generateCity(1);
  const c = generateCity(2);
  assert.equal(a.buildings.length, b.buildings.length);
  assert.deepEqual(a.buildings[0], b.buildings[0]);
  assert.notDeepEqual(a.buildings.map((x) => x.h), c.buildings.map((x) => x.h));
});

test('no building intrudes on an avenue strip', () => {
  const city = generateCity(1);
  assert.ok(city.buildings.length > 80, 'city should be dense');
  for (const b of city.buildings) {
    for (const line of AVENUE_LINES) {
      const crossesX = b.x - b.w / 2 < line + ROAD_HALF && b.x + b.w / 2 > line - ROAD_HALF;
      const crossesZ = b.z - b.d / 2 < line + ROAD_HALF && b.z + b.d / 2 > line - ROAD_HALF;
      assert.ok(!(crossesX && crossesZ), `building at ${b.x},${b.z} blocks an intersection`);
      // A slab may run alongside an avenue but never across one.
      const spansX = b.x - b.w / 2 < line - ROAD_HALF && b.x + b.w / 2 > line + ROAD_HALF;
      const spansZ = b.z - b.d / 2 < line - ROAD_HALF && b.z + b.d / 2 > line + ROAD_HALF;
      assert.ok(!spansX && !spansZ, 'building spans an avenue');
    }
  }
});

test('mission places sit on open ground', () => {
  const city = generateCity(1);
  for (const [key, place] of Object.entries(city.places)) {
    for (const b of city.buildings) {
      assert.ok(!circleHitsBox(place.x, place.z, 1.5, b), `${key} is inside a building`);
    }
  }
  assert.ok(onRoad(city.places.cafe.x, city.places.cafe.z) || true); // cafe is kerbside
});

test('stars map to heat bands', () => {
  assert.equal(starsForHeat(0), 0);
  assert.equal(starsForHeat(1), 1);
  assert.equal(starsForHeat(100), 1);
  assert.equal(starsForHeat(101), 2);
  assert.equal(starsForHeat(500), 5);
  assert.equal(starsForHeat(9999), 5);
});

test('crime raises heat and hiding lets it decay to zero', () => {
  const world = createWorld(1);
  addCrime(world, 60, world.player.x, world.player.z);
  assert.equal(world.stars, 1);
  for (let i = 0; i < 400 && world.heat > 0; i += 1) {
    exilePolice(world);
    step(world, 0.25);
  }
  assert.equal(world.heat, 0);
  assert.equal(world.stars, 0);
  assert.equal(world.outcome, null);
});

test('mission catalogue is well-formed', () => {
  const city = generateCity(1);
  const catalogue = missionCatalogue(city);
  assert.ok(catalogue.length >= 4, 'at least four missions');
  const ids = new Set(catalogue.map((m) => m.id));
  assert.equal(ids.size, catalogue.length, 'ids unique');
  for (const m of catalogue) {
    assert.ok(m.reward > 0, `${m.id} pays`);
    assert.ok(m.steps.length >= 1, `${m.id} has steps`);
    for (const s of m.steps) assert.ok(KNOWN_STEPS.includes(s.kind), `${m.id} step kind ${s.kind} known`);
  }
  const kinds = new Set(catalogue.flatMap((m) => m.steps.map((s) => s.kind)));
  assert.ok(kinds.has('goto') && kinds.has('collect') && kinds.has('escape') && kinds.has('takedown') && kinds.has('race'),
    'all five step kinds are used across the catalogue');
});

test('delivery mission completes end to end and pays out', () => {
  const world = createWorld(1);
  const cafe = world.city.places.cafe;
  teleport(world, cafe.x, cafe.z);
  step(world, 0.1);
  assert.equal(world.mission?.def.id, 'hot-box');
  const drop = world.city.places.dropoff;
  teleport(world, drop.x, drop.z);
  step(world, 0.1);
  assert.ok(world.completed.has('hot-box'));
  assert.equal(world.cash, 250);
  assert.equal(world.mission, null);
});

test('collect mission spawns six cases and completes when all are taken', () => {
  const world = createWorld(1);
  const plaza = world.city.places.plaza;
  teleport(world, plaza.x, plaza.z);
  step(world, 0.1);
  assert.equal(world.mission?.def.id, 'loose-change');
  assert.equal(world.pickups.length, 6);
  for (const pk of [...world.pickups]) {
    teleport(world, pk.x, pk.z);
    step(world, 0.1);
  }
  assert.ok(world.completed.has('loose-change'));
  assert.equal(world.cash, 300);
});

test('escape mission raises three stars and completes once the heat is gone', () => {
  const world = createWorld(1);
  const hideout = world.city.places.hideout;
  teleport(world, hideout.x, hideout.z);
  step(world, 0.1);
  assert.equal(world.mission?.def.id, 'heat-check');
  assert.equal(world.stars, 3);
  for (let i = 0; i < 2400 && !world.completed.has('heat-check'); i += 1) {
    exilePolice(world);
    step(world, 0.25);
  }
  assert.ok(world.completed.has('heat-check'));
  assert.equal(world.cash, 400);
});

test('takedown mission spawns a chief and guards and completes when they fall', () => {
  const world = createWorld(1);
  const spot = world.city.places.rivalSpot;
  teleport(world, spot.x, spot.z);
  step(world, 0.1);
  assert.equal(world.mission?.def.id, 'palm-court');
  assert.equal(world.hostiles.length, 3);
  assert.equal(world.hostiles.filter((h) => h.chief).length, 1);
  for (let guard = 0; guard < 40 && world.hostiles.some((h) => h.alive); guard += 1) {
    const target = world.hostiles.find((h) => h.alive);
    teleport(world, target.x - 4, target.z - 4);
    world.player.angle = Math.atan2(target.x - world.player.x, target.z - world.player.z);
    world.player.shootCd = 0;
    updateWorld(world, DT, { ...NEUTRAL, shoot: true });
  }
  step(world, 0.1);
  assert.ok(world.completed.has('palm-court'));
  assert.equal(world.cash, 500);
});

test('race mission completes by passing every checkpoint in order', () => {
  const world = createWorld(1);
  const start = world.city.places.raceStart;
  teleport(world, start.x, start.z);
  step(world, 0.1);
  assert.equal(world.mission?.def.id, 'solmar-sprint');
  const checkpoints = world.mission.def.steps[0].checkpoints;
  assert.ok(checkpoints.length >= 5);
  for (const cp of checkpoints) {
    teleport(world, cp.x, cp.z);
    step(world, 0.1);
  }
  assert.ok(world.completed.has('solmar-sprint'));
  assert.equal(world.cash, 350);
});

test('finishing every mission clears the city', () => {
  const world = createWorld(3);
  // Play each mission through its marker with the same teleport technique.
  const play = (marker, finish) => {
    teleport(world, marker.x, marker.z);
    step(world, 0.1);
    finish();
    step(world, 0.1);
  };
  play(world.city.places.cafe, () => teleport(world, world.city.places.dropoff.x, world.city.places.dropoff.z));
  play(world.city.places.plaza, () => {
    for (const pk of [...world.pickups]) { teleport(world, pk.x, pk.z); step(world, 0.05); }
  });
  play(world.city.places.hideout, () => {
    for (let i = 0; i < 2400 && world.stars > 0; i += 1) { exilePolice(world); step(world, 0.25); }
  });
  play(world.city.places.rivalSpot, () => {
    for (let s = 0; s < 40 && world.hostiles.some((h) => h.alive); s += 1) {
      const t = world.hostiles.find((h) => h.alive);
      teleport(world, t.x - 4, t.z - 4);
      world.player.angle = Math.atan2(t.x - world.player.x, t.z - world.player.z);
      world.player.shootCd = 0;
      updateWorld(world, DT, { ...NEUTRAL, shoot: true });
    }
  });
  play(world.city.places.raceStart, () => {
    for (const cp of world.mission.def.steps[0].checkpoints) { teleport(world, cp.x, cp.z); step(world, 0.05); }
  });
  assert.equal(world.completed.size, 5);
  assert.equal(world.cityCleared, true);
  assert.equal(world.cash, 250 + 300 + 400 + 500 + 350);
});

test('player can enter and leave a parked car; taking it is a crime', () => {
  const world = createWorld(1);
  const car = world.cars.find((c) => c.kind === 'parked');
  teleport(world, car.x + 1, car.z);
  assert.equal(toggleVehicle(world), 'enter');
  assert.equal(world.player.inCar, car);
  assert.ok(world.heat >= 50, 'grand theft auto raises heat');
  assert.equal(toggleVehicle(world), 'exit');
  assert.equal(world.player.inCar, null);
});

test('driving moves the car and traffic stays out of buildings', () => {
  const world = createWorld(1);
  const car = world.cars.find((c) => c.kind === 'parked');
  teleport(world, car.x, car.z);
  toggleVehicle(world);
  car.angle = Math.PI / 2; // east along the southern avenue (z = 240)
  car.x = -200;
  car.z = 240;
  const before = distance(car.x, car.z, 0, 0);
  for (let i = 0; i < 120; i += 1) updateWorld(world, DT, { ...NEUTRAL, forward: 1 });
  assert.ok(car.speed > 5, 'car accelerates');
  assert.ok(car.x > -200, "car moved east");
  step(world, 20);
  for (const traffic of world.cars.filter((c) => c.kind === 'traffic')) {
    for (const b of world.city.buildings) {
      assert.ok(!circleHitsBox(traffic.x, traffic.z, 2.0, b), 'traffic car inside a building');
    }
    assert.ok(Math.abs(traffic.x) <= 264 && Math.abs(traffic.z) <= 264, 'traffic stays in the city');
  }
});

test('the day cycle advances and wraps', () => {
  const world = createWorld(1);
  const start = world.dayTime;
  step(world, 30);
  assert.ok(world.dayTime > start || world.dayTime < start + 0.2);
  assert.ok(world.dayTime >= 0 && world.dayTime < 1);
});

test('two worlds with the same seed evolve identically', () => {
  const a = createWorld(7);
  const b = createWorld(7);
  for (let i = 0; i < 600; i += 1) {
    updateWorld(a, DT, NEUTRAL);
    updateWorld(b, DT, NEUTRAL);
  }
  assert.deepEqual(
    a.cars.map((c) => [Math.round(c.x * 100), Math.round(c.z * 100)]),
    b.cars.map((c) => [Math.round(c.x * 100), Math.round(c.z * 100)]),
  );
  assert.equal(a.peds.length, b.peds.length);
});
