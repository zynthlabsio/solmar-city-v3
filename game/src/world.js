// The Solmar City simulation. Everything that moves or matters lives here
// as plain data and numbers — positions, speeds, heat, cash — with no
// rendering and no DOM, so Node tests can drive whole missions headlessly.
// The renderer (render3d.js) reads this state each frame and draws it; the
// HUD reads it and writes the overlay. One fixed-step update function is
// the only way the world changes.

import { generateCity, circleHitsBox, clampToCity, onRoad, AVENUE_LINES } from './city.js';
import { createRng, randRange, pick } from './rng.js';
import { missionCatalogue, scatterPickups, STEP_COLLECT, STEP_ESCAPE, STEP_RACE, STEP_TAKEDOWN } from './missions.js';

export const FOOT_SPEED = 6.2;
export const SPRINT_SPEED = 9.6;
export const CAR_TOP_SPEED = 36;
export const CAR_ACCEL = 15;
export const HEAT_PER_STAR = 100;
export const MAX_STARS = 5;

const TRAFFIC_COUNT = 11;
const PED_COUNT = 14;
const POLICE_SPAWN_GAP = 2.2;

let nextId = 1;
function makeCar(x, z, angle, kind, hue) {
  return {
    id: nextId += 1, x, z, angle, speed: 0, kind, hue,
    hp: 100, stolen: false, driver: null, targetX: x, targetZ: z,
  };
}

function makePed(x, z, hue) {
  return {
    id: nextId += 1, x, z, angle: 0, hue,
    state: 'walk', targetX: x, targetZ: z, downT: 0,
  };
}

/** Angle helpers: wrap to [-PI, PI] and turn toward a goal by a capped step. */
export function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
export function turnToward(angle, goal, maxStep) {
  const diff = wrapAngle(goal - angle);
  return angle + Math.max(-maxStep, Math.min(maxStep, diff));
}
export function distance(ax, az, bx, bz) {
  return Math.hypot(ax - bx, az - bz);
}

export function createWorld(seed) {
  const city = generateCity(seed);
  const rng = createRng(seed * 104729 + 5);
  const catalogue = missionCatalogue(city);

  const world = {
    city,
    catalogue,
    seed,
    rng,
    time: 0,
    dayTime: 0.34, // mid-morning
    cash: 0,
    score: 0,
    heat: 0,
    stars: 0,
    lastCrimeAt: -100,
    lastCrimePos: { x: 0, z: 0 },
    arrestMeter: 0,
    outcome: null, // 'busted' | 'wasted' once a run ends badly
    cityCleared: false,
    events: [],
    player: {
      x: 6, z: 232, angle: Math.PI, hp: 100, inCar: null,
      shootCd: 0, radius: 0.7,
    },
    cars: [],
    peds: [],
    hostiles: [],
    pickups: [],
    policeTimer: 0,
    mission: null,
    completed: new Set(),
  };

  // Parked cars from the lot plus a few kerbside spares along the avenues.
  for (const spot of city.parkedCars) {
    world.cars.push(makeCar(spot.x, spot.z, spot.heading, 'parked', spot.hue));
  }
  for (let i = 0; i < 5; i += 1) {
    const line = pick(rng, AVENUE_LINES);
    const along = randRange(rng, -220, 220);
    const car = rng() < 0.5
      ? makeCar(line + 6.5, along, 0, 'parked', i % 6)
      : makeCar(along, line + 6.5, Math.PI / 2, 'parked', (i + 2) % 6);
    world.cars.push(car);
  }

  // Traffic: each car starts at an intersection, aimed at the next one.
  for (let i = 0; i < TRAFFIC_COUNT; i += 1) {
    const car = makeCar(
      pick(rng, AVENUE_LINES), pick(rng, AVENUE_LINES),
      pick(rng, [0, Math.PI / 2, Math.PI, -Math.PI / 2]), 'traffic', i % 6,
    );
    car.speed = 10;
    retargetTraffic(world, car, true);
    world.cars.push(car);
  }

  // Pedestrians strolling the sidewalks.
  for (let i = 0; i < PED_COUNT; i += 1) {
    const ped = makePed(0, 0, i % 6);
    snapPedToSidewalk(world, ped);
    retargetPed(world, ped);
    world.peds.push(ped);
  }

  return world;
}

/** Wanted stars for a heat value: each full 100 heat is a star, capped. */
export function starsForHeat(heat) {
  if (heat <= 0) return 0;
  return Math.min(MAX_STARS, Math.ceil(heat / HEAT_PER_STAR));
}

/** Record a crime: raises heat and stamps time/place for witnesses and decay. */
export function addCrime(world, amount, x, z) {
  world.heat = Math.min(HEAT_PER_STAR * MAX_STARS + 99, world.heat + amount);
  world.lastCrimeAt = world.time;
  world.lastCrimePos = { x, z };
  world.stars = starsForHeat(world.heat);
}

function snapPedToSidewalk(world, ped) {
  const line = pick(world.rng, AVENUE_LINES);
  ped.x = clampToCity(line + (world.rng() < 0.5 ? 12.5 : -12.5));
  ped.z = clampToCity(randRange(world.rng, -235, 235));
}

function retargetPed(world, ped) {
  // Stroll mostly in straight lines along a sidewalk, so pedestrians follow
  // avenues instead of cutting through towers.
  if (world.rng() < 0.7) {
    ped.targetX = ped.x;
    ped.targetZ = clampToCity(ped.z + randRange(world.rng, -120, 120));
  } else {
    ped.targetX = clampToCity(ped.x + randRange(world.rng, -120, 120));
    ped.targetZ = ped.z;
  }
}

/** Choose the next intersection a traffic car drives toward, lane offset included. */
function retargetTraffic(world, car, first = false) {
  const rng = world.rng;
  let dirX = Math.round(Math.sin(car.angle));
  let dirZ = Math.round(Math.cos(car.angle));
  const hereX = AVENUE_LINES.reduce((a, b) => (Math.abs(b - car.x) < Math.abs(a - car.x) ? b : a));
  const hereZ = AVENUE_LINES.reduce((a, b) => (Math.abs(b - car.z) < Math.abs(a - car.z) ? b : a));
  if (!first && rng() < 0.45) {
    const turn = rng() < 0.5 ? 1 : -1;
    const oldX = dirX;
    dirX = dirZ * turn;
    dirZ = -oldX * turn;
    if (dirX === 0 && dirZ === 0) { dirX = oldX; dirZ = Math.round(Math.cos(car.angle)); }
  }
  let nextX = hereX + dirX * 80;
  let nextZ = hereZ + dirZ * 80;
  if (nextX < -240 || nextX > 240 || nextZ < -240 || nextZ > 240) {
    nextX = hereX - dirX * 80;
    nextZ = hereZ - dirZ * 80;
    dirX = -dirX;
    dirZ = -dirZ;
  }
  car.angle = Math.atan2(dirX, dirZ);
  // Right-hand lane: shift the target sideways off the centreline.
  car.targetX = nextX + dirZ * 4.2;
  car.targetZ = nextZ - dirX * 4.2;
}

/** Push a circular body out of every building and crate it overlaps. */
function collideBuildings(world, body, radius) {
  for (const b of world.city.buildings) {
    if (!circleHitsBox(body.x, body.z, radius, b)) continue;
    const dx = body.x - b.x;
    const dz = body.z - b.z;
    const px = b.w / 2 + radius - Math.abs(dx);
    const pz = b.d / 2 + radius - Math.abs(dz);
    if (px < pz) body.x = b.x + (dx >= 0 ? 1 : -1) * (b.w / 2 + radius);
    else body.z = b.z + (dz >= 0 ? 1 : -1) * (b.d / 2 + radius);
  }
  for (const c of world.city.crates) {
    if (!circleHitsBox(body.x, body.z, radius, c)) continue;
    const dx = body.x - c.x;
    const dz = body.z - c.z;
    if (Math.abs(dx) > Math.abs(dz)) body.x = c.x + (dx >= 0 ? 1 : -1) * (c.w / 2 + radius);
    else body.z = c.z + (dz >= 0 ? 1 : -1) * (c.d / 2 + radius);
  }
  body.x = clampToCity(body.x);
  body.z = clampToCity(body.z);
}

/** Start the mission whose marker the player is standing in, if any. */
export function tryStartMission(world) {
  if (world.mission) return null;
  const p = world.player;
  for (const def of world.catalogue) {
    if (world.completed.has(def.id)) continue;
    if (distance(p.x, p.z, def.marker.x, def.marker.z) < 5) {
      startMission(world, def);
      return def;
    }
  }
  return null;
}

export function startMission(world, def) {
  const step = def.steps[0];
  world.mission = { def, stepIndex: 0, stepTime: 0, raceIndex: 0, collected: 0 };
  world.pickups = [];
  world.hostiles = [];
  prepareStep(world, step);
  world.events.push({ type: 'toast', text: `Mission started: ${def.title}` });
}

/** Set up whatever a step needs in the world: pickups, heat or hostiles. */
function prepareStep(world, step) {
  if (step.kind === STEP_COLLECT) {
    const pts = scatterPickups(world.seed + world.mission.def.id.length * 17, step.point, step.count, step.spread);
    world.pickups = pts.map((pt) => ({ x: pt.x, z: pt.z, taken: false }));
  }
  if (step.kind === STEP_ESCAPE) addCrime(world, step.heat, world.player.x, world.player.z);
  if (step.kind === STEP_TAKEDOWN) spawnHostiles(world, step);
}

function spawnHostiles(world, step) {
  const rng = world.rng;
  world.hostiles.push({
    id: nextId += 1, x: step.point.x + 3, z: step.point.z + 2, angle: 0,
    hp: 100, maxHp: 100, alive: true, shootCd: 1.2, chief: true, speed: 2.6,
  });
  for (let i = 0; i < step.guards; i += 1) {
    world.hostiles.push({
      id: nextId += 1,
      x: step.point.x + randRange(rng, -9, 9), z: step.point.z + randRange(rng, -9, 9),
      angle: 0, hp: 60, maxHp: 60, alive: true, shootCd: randRange(rng, 0.6, 1.6),
      chief: false, speed: 3.1,
    });
  }
}

function currentStep(world) {
  if (!world.mission) return null;
  return world.mission.def.steps[world.mission.stepIndex];
}

/** The text the HUD shows for the active step, with live counters filled in. */
export function objectiveText(world) {
  const step = currentStep(world);
  if (!step) {
    if (world.completed.size === world.catalogue.length) return 'Solmar City is yours. Free roam!';
    return 'Find a glowing job marker to start work';
  }
  const m = world.mission;
  if (step.kind === STEP_COLLECT) return `${step.label} (${m.collected}/${step.count})`;
  if (step.kind === STEP_RACE) return `${step.label} — checkpoint ${Math.min(m.raceIndex + 1, step.checkpoints.length)}/${step.checkpoints.length}`;
  if (step.kind === STEP_ESCAPE) return `${step.label} — heat ${world.stars} star${world.stars === 1 ? '' : 's'}`;
  return step.label;
}

/** Where the HUD arrow and minimap should point right now, or null. */
export function objectivePoint(world) {
  const step = currentStep(world);
  if (!step) {
    let best = null;
    let bestD = Infinity;
    for (const def of world.catalogue) {
      if (world.completed.has(def.id)) continue;
      const d = distance(world.player.x, world.player.z, def.marker.x, def.marker.z);
      if (d < bestD) { bestD = d; best = def.marker; }
    }
    return best;
  }
  if (step.kind === STEP_COLLECT) {
    let best = null;
    let bestD = Infinity;
    for (const pk of world.pickups) {
      if (pk.taken) continue;
      const d = distance(world.player.x, world.player.z, pk.x, pk.z);
      if (d < bestD) { bestD = d; best = pk; }
    }
    return best;
  }
  if (step.kind === STEP_RACE) return step.checkpoints[world.mission.raceIndex] ?? step.point;
  return step.point;
}

function completeStep(world) {
  const m = world.mission;
  m.stepIndex += 1;
  m.stepTime = 0;
  m.raceIndex = 0;
  m.collected = 0;
  if (m.stepIndex >= m.def.steps.length) {
    world.completed.add(m.def.id);
    world.cash += m.def.reward;
    world.score += m.def.reward;
    world.events.push({ type: 'toast', text: `${m.def.title} complete — $${m.def.reward}` });
    world.events.push({ type: 'cash', amount: m.def.reward });
    world.mission = null;
    world.pickups = [];
    world.hostiles = [];
    if (world.completed.size === world.catalogue.length) {
      world.cityCleared = true;
      world.events.push({ type: 'cleared' });
    }
    return;
  }
  prepareStep(world, currentStep(world));
}

function failMission(world, reason) {
  if (world.mission) world.events.push({ type: 'toast', text: `Mission failed: ${reason}` });
  world.mission = null;
  world.pickups = [];
  world.hostiles = [];
}

/** Enter the nearest car or climb out of the current one. */
export function toggleVehicle(world) {
  const p = world.player;
  if (p.inCar) {
    const car = p.inCar;
    p.inCar = null;
    car.driver = null;
    car.speed = 0;
    p.x = car.x + Math.cos(car.angle) * 2.6;
    p.z = car.z - Math.sin(car.angle) * 2.6;
    collideBuildings(world, p, p.radius);
    return 'exit';
  }
  let best = null;
  let bestD = 3.4;
  for (const car of world.cars) {
    if (car.kind === 'police') continue;
    const d = distance(p.x, p.z, car.x, car.z);
    if (d < bestD) { bestD = d; best = car; }
  }
  if (!best) return null;
  p.inCar = best;
  best.driver = 'player';
  if (best.kind === 'parked' && !best.stolen) {
    best.stolen = true;
    addCrime(world, 50, p.x, p.z);
    world.events.push({ type: 'toast', text: 'Vehicle taken — the owner noticed' });
  }
  if (best.kind === 'traffic') {
    best.kind = 'parked'; // the victim stops being traffic once jacked
    addCrime(world, 70, p.x, p.z);
    world.events.push({ type: 'toast', text: 'Carjacked!' });
  }
  return 'enter';
}

/** The player's shot: hitscan against hostiles, then bystanders, then air. */
export function playerShoot(world) {
  const p = world.player;
  if (p.inCar || p.shootCd > 0 || world.outcome) return;
  p.shootCd = 0.32;
  const fx = Math.sin(p.angle);
  const fz = Math.cos(p.angle);
  let target = null;
  let bestD = 36;
  for (const h of world.hostiles) {
    if (!h.alive) continue;
    const d = distance(p.x, p.z, h.x, h.z);
    if (d > bestD) continue;
    const dot = ((h.x - p.x) * fx + (h.z - p.z) * fz) / (d || 1);
    if (dot > 0.72) { target = h; bestD = d; }
  }
  let endX = p.x + fx * 22;
  let endZ = p.z + fz * 22;
  if (target) {
    target.hp -= 34;
    endX = target.x;
    endZ = target.z;
    if (target.hp <= 0) {
      target.alive = false;
      world.score += target.chief ? 50 : 20;
      world.events.push({ type: 'toast', text: target.chief ? 'Rival chief down' : 'Guard down' });
    }
  } else {
    for (const ped of world.peds) {
      if (ped.state === 'down') continue;
      const d = distance(p.x, p.z, ped.x, ped.z);
      if (d > 26) continue;
      const dot = ((ped.x - p.x) * fx + (ped.z - p.z) * fz) / (d || 1);
      if (dot > 0.8) {
        ped.state = 'down';
        ped.downT = 20;
        endX = ped.x;
        endZ = ped.z;
        addCrime(world, 110, p.x, p.z);
        break;
      }
    }
  }
  world.events.push({ type: 'shot', x1: p.x, z1: p.z, x2: endX, z2: endZ, hostile: false });
  const heard = world.cars.some((c) => c.kind === 'police' && distance(p.x, p.z, c.x, c.z) < 45)
    || world.peds.some((pd) => pd.state !== 'down' && distance(p.x, p.z, pd.x, pd.z) < 30);
  addCrime(world, heard ? 25 : 6, p.x, p.z);
}

/** Damage the player; reaching zero ends the run as 'wasted'. */
export function hurtPlayer(world, amount) {
  const p = world.player;
  if (world.outcome) return;
  p.hp -= amount;
  world.events.push({ type: 'hurt' });
  if (p.hp <= 0) {
    p.hp = 0;
    world.outcome = 'wasted';
    world.events.push({ type: 'wasted' });
  }
}

/** Reset after an arrest or a wreck: heat cleared, small fine, back to the plaza. */
export function resetAfterSetback(world) {
  const p = world.player;
  world.outcome = null;
  world.heat = 0;
  world.stars = 0;
  world.arrestMeter = 0;
  p.hp = 100;
  if (p.inCar) { p.inCar.driver = null; p.inCar = null; }
  p.x = -80;
  p.z = -72;
  p.angle = 0;
  world.cash = Math.max(0, world.cash - 100);
  world.cars = world.cars.filter((c) => c.kind !== 'police');
  if (world.mission) failMission(world, 'interrupted');
}

/** The one fixed-step update. `input` is the normalised control state. */
export function updateWorld(world, dt, input) {
  if (world.outcome) return;
  world.time += dt;
  world.dayTime = (world.dayTime + dt / 260) % 1;
  const p = world.player;
  p.shootCd = Math.max(0, p.shootCd - dt);

  if (input.interactPressed) toggleVehicle(world);
  if (input.shoot) playerShoot(world);

  updatePlayer(world, dt, input);
  updateTraffic(world, dt);
  updatePolice(world, dt);
  updatePeds(world, dt);
  updateHostiles(world, dt);
  updateMission(world, dt);
  updateWanted(world, dt);
  world.stars = starsForHeat(world.heat);
}

function updatePlayer(world, dt, input) {
  const p = world.player;
  if (p.inCar) {
    const car = p.inCar;
    if (input.forward > 0) car.speed += CAR_ACCEL * dt * (1 - car.speed / (CAR_TOP_SPEED + 8));
    else if (input.forward < 0) car.speed -= (car.speed > 0.5 ? 22 : 7) * dt;
    car.speed -= car.speed * 0.55 * dt;
    if (input.handbrake) car.speed -= car.speed * 2.4 * dt;
    car.speed = Math.max(-11, Math.min(CAR_TOP_SPEED, car.speed));
    if (Math.abs(car.speed) > 0.2) {
      const grip = input.handbrake ? 1.7 : 1.0;
      car.angle += input.strafe * dt * 1.55 * grip * Math.sign(car.speed) * Math.min(1, Math.abs(car.speed) / 9);
    }
    const beforeX = car.x;
    const beforeZ = car.z;
    car.x += Math.sin(car.angle) * car.speed * dt;
    car.z += Math.cos(car.angle) * car.speed * dt;
    collideBuildings(world, car, 2.1);
    if ((car.x !== beforeX || car.z !== beforeZ) && Math.abs(car.speed) > 3
      && distance(car.x, car.z, beforeX + Math.sin(car.angle) * car.speed * dt, beforeZ + Math.cos(car.angle) * car.speed * dt) > 0.4) {
      if (Math.abs(car.speed) > 12) {
        addCrime(world, 10, car.x, car.z);
        car.hp -= 4;
      }
      car.speed *= -0.22;
    }
    collideCars(world, car);
    p.x = car.x;
    p.z = car.z;
    p.angle = car.angle;
    if (car.hp <= 0) hurtPlayer(world, 1000);
    return;
  }

  // On foot, movement is relative to the camera yaw the caller reports:
  // pushing "up" walks away from the camera, "right" strafes right.
  const cam = input.camAngle || 0;
  const fx = -Math.sin(cam);
  const fz = -Math.cos(cam);
  const rx = Math.cos(cam);
  const rz = -Math.sin(cam);
  const mx = rx * input.strafe + fx * input.forward;
  const mz = rz * input.strafe + fz * input.forward;
  const len = Math.hypot(mx, mz);
  if (len > 0.01) {
    const speed = input.sprint ? SPRINT_SPEED : FOOT_SPEED;
    p.x += (mx / len) * speed * dt;
    p.z += (mz / len) * speed * dt;
    p.angle = Math.atan2(mx, mz);
  }
  collideBuildings(world, p, p.radius);
  tryStartMission(world);
}

/** Car-to-car bumps: separate the pair, trade speed, log crimes for the player. */
function collideCars(world, car) {
  for (const other of world.cars) {
    if (other === car) continue;
    const d = distance(car.x, car.z, other.x, other.z);
    if (d >= 3.6 || d === 0) continue;
    const push = (3.6 - d) / 2;
    const nx = (car.x - other.x) / d;
    const nz = (car.z - other.z) / d;
    car.x += nx * push;
    car.z += nz * push;
    if (other.driver !== 'player') {
      other.x -= nx * push;
      other.z -= nz * push;
    }
    const impact = Math.abs(car.speed - other.speed);
    if (car.driver === 'player' || other.driver === 'player') {
      if (impact > 7) {
        addCrime(world, other.kind === 'police' ? 60 : 35, car.x, car.z);
        other.hp -= impact * 0.8;
        world.events.push({ type: 'crash' });
      }
      car.speed *= 0.55;
      other.speed *= 0.7;
    }
  }
  // Running down a pedestrian is the city's worst look.
  if (car.driver === 'player' && Math.abs(car.speed) > 4) {
    for (const ped of world.peds) {
      if (ped.state === 'down') continue;
      if (distance(car.x, car.z, ped.x, ped.z) < 2.4) {
        ped.state = 'down';
        ped.downT = 20;
        addCrime(world, 120, car.x, car.z);
        world.events.push({ type: 'toast', text: 'Pedestrian down!' });
      }
    }
  }
}

function updateTraffic(world, dt) {
  for (const car of world.cars) {
    if (car.kind !== 'traffic' || car.driver === 'player') continue;
    if (distance(car.x, car.z, car.targetX, car.targetZ) < 6) retargetTraffic(world, car);
    const goal = Math.atan2(car.targetX - car.x, car.targetZ - car.z);
    car.angle = turnToward(car.angle, goal, 1.9 * dt);
    const wanted = onRoad(car.x, car.z) ? 11 : 6;
    car.speed += Math.max(-8 * dt, Math.min(8 * dt, wanted - car.speed));
    car.x += Math.sin(car.angle) * car.speed * dt;
    car.z += Math.cos(car.angle) * car.speed * dt;
    collideBuildings(world, car, 2.1);
  }
}

function updatePolice(world, dt) {
  const p = world.player;
  let active = world.cars.filter((c) => c.kind === 'police');
  world.policeTimer -= dt;
  if (world.stars > 0 && active.length < Math.min(2 + world.stars, 6) && world.policeTimer <= 0) {
    world.policeTimer = POLICE_SPAWN_GAP;
    const ang = world.rng() * Math.PI * 2;
    let sx = clampToCity(p.x + Math.sin(ang) * 78);
    let sz = clampToCity(p.z + Math.cos(ang) * 78);
    if (!onRoad(sx, sz)) { sx = p.x > 0 ? 240 : -240; sz = Math.round(sz / 80) * 80; }
    const cop = makeCar(sx, sz, 0, 'police', 9);
    cop.speed = 12;
    world.cars.push(cop);
    active.push(cop);
  }
  if (world.stars === 0) {
    for (const cop of active) {
      cop.x += Math.sin(cop.angle) * 14 * dt;
      cop.z += Math.cos(cop.angle) * 14 * dt;
      if (Math.abs(cop.x) >= 262 || Math.abs(cop.z) >= 262) cop.hp = -999;
    }
    if (active.some((c) => c.hp <= -100)) world.cars = world.cars.filter((c) => c.hp > -100);
    world.arrestMeter = Math.max(0, world.arrestMeter - dt * 1.5);
    return;
  }
  for (const cop of active) {
    const goal = Math.atan2(p.x - cop.x, p.z - cop.z);
    cop.angle = turnToward(cop.angle, goal, 2.3 * dt);
    const d = distance(cop.x, cop.z, p.x, p.z);
    const top = 24 + world.stars * 2.4;
    const wanted = d > 6 ? top : 4;
    cop.speed += Math.max(-20 * dt, Math.min(14 * dt, wanted - cop.speed));
    cop.x += Math.sin(cop.angle) * cop.speed * dt;
    cop.z += Math.cos(cop.angle) * cop.speed * dt;
    collideBuildings(world, cop, 2.1);
    collideCars(world, cop);
    if (!p.inCar && d < 3.4 && Math.abs(cop.speed) < 9) {
      world.arrestMeter += dt;
      if (world.arrestMeter >= 2.4) {
        world.outcome = 'busted';
        world.events.push({ type: 'busted' });
      }
    }
  }
  if (p.inCar || !active.some((c) => distance(c.x, c.z, p.x, p.z) < 3.4)) {
    world.arrestMeter = Math.max(0, world.arrestMeter - dt * 1.8);
  }
}

function updatePeds(world, dt) {
  for (const ped of world.peds) {
    if (ped.state === 'down') {
      ped.downT -= dt;
      if (ped.downT <= 0) {
        ped.state = 'walk';
        snapPedToSidewalk(world, ped);
        retargetPed(world, ped);
      }
      continue;
    }
    const recentCrime = world.time - world.lastCrimeAt < 3.5
      && distance(ped.x, ped.z, world.lastCrimePos.x, world.lastCrimePos.z) < 20;
    if (recentCrime) ped.state = 'flee';
    else if (ped.state === 'flee') ped.state = 'walk';
    if (ped.state === 'flee') {
      const away = Math.atan2(ped.x - world.lastCrimePos.x, ped.z - world.lastCrimePos.z);
      ped.angle = turnToward(ped.angle, away, 6 * dt);
      ped.x += Math.sin(ped.angle) * 5.4 * dt;
      ped.z += Math.cos(ped.angle) * 5.4 * dt;
    } else {
      if (distance(ped.x, ped.z, ped.targetX, ped.targetZ) < 1.5) retargetPed(world, ped);
      const goal = Math.atan2(ped.targetX - ped.x, ped.targetZ - ped.z);
      ped.angle = turnToward(ped.angle, goal, 4 * dt);
      ped.x += Math.sin(ped.angle) * 1.6 * dt;
      ped.z += Math.cos(ped.angle) * 1.6 * dt;
    }
    collideBuildings(world, ped, 0.6);
  }
}

function updateHostiles(world, dt) {
  const p = world.player;
  for (const h of world.hostiles) {
    if (!h.alive) continue;
    const d = distance(h.x, h.z, p.x, p.z);
    h.angle = Math.atan2(p.x - h.x, p.z - h.z);
    if (d > 11) {
      h.x += Math.sin(h.angle) * h.speed * dt;
      h.z += Math.cos(h.angle) * h.speed * dt;
      collideBuildings(world, h, 0.7);
    }
    h.shootCd -= dt;
    if (d < 32 && h.shootCd <= 0) {
      h.shootCd = randRange(world.rng, 1.0, 1.7);
      world.events.push({ type: 'shot', x1: h.x, z1: h.z, x2: p.x, z2: p.z, hostile: true });
      if (world.rng() < 0.62) hurtPlayer(world, randRange(world.rng, 5, 10));
    }
  }
}

function updateMission(world, dt) {
  const step = currentStep(world);
  if (!step) return;
  const m = world.mission;
  const p = world.player;
  m.stepTime += dt;

  if (step.timeLimit && step.kind !== STEP_RACE && m.stepTime > step.timeLimit) {
    failMission(world, 'out of time');
    return;
  }

  if (step.kind === 'goto') {
    if (distance(p.x, p.z, step.point.x, step.point.z) < 6) completeStep(world);
    return;
  }
  if (step.kind === STEP_COLLECT) {
    for (const pk of world.pickups) {
      if (pk.taken) continue;
      if (distance(p.x, p.z, pk.x, pk.z) < 3) {
        pk.taken = true;
        m.collected += 1;
        world.score += 10;
        world.events.push({ type: 'pickup' });
        world.events.push({ type: 'toast', text: `Case ${m.collected}/${step.count}` });
      }
    }
    if (m.collected >= step.count) completeStep(world);
    return;
  }
  if (step.kind === STEP_ESCAPE) {
    if (m.stepTime > 2 && world.stars === 0) completeStep(world);
    return;
  }
  if (step.kind === STEP_TAKEDOWN) {
    if (world.hostiles.length > 0 && world.hostiles.every((h) => !h.alive)) completeStep(world);
    return;
  }
  if (step.kind === STEP_RACE) {
    if (m.stepTime > step.timeLimit) { failMission(world, 'the league clock ran out'); return; }
    const cp = step.checkpoints[m.raceIndex];
    if (cp && distance(p.x, p.z, cp.x, cp.z) < 10) {
      m.raceIndex += 1;
      world.events.push({ type: 'checkpoint' });
      world.events.push({ type: 'toast', text: `Checkpoint ${m.raceIndex}/${step.checkpoints.length}` });
      if (m.raceIndex >= step.checkpoints.length) completeStep(world);
    }
  }
}

function updateWanted(world, dt) {
  if (world.heat <= 0) return;
  const p = world.player;
  if (world.time - world.lastCrimeAt < 4) return;
  const copNear = world.cars.some((c) => c.kind === 'police' && distance(c.x, c.z, p.x, p.z) < 30);
  const rate = copNear ? 1.1 : 7.5;
  world.heat = Math.max(0, world.heat - rate * dt);
}
