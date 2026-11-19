// The three screenshot scenes behind ?shot=start|play|end. Each one drives
// the real simulation forward from a fresh world with a small scripted
// driver, so the frame is an honest moment of play and the same seed
// always stages the same scene.

import { updateWorld, startMission, toggleVehicle, addCrime, wrapAngle, distance } from './world.js';
import { objectivePoint } from './world.js';

const STEP = 1 / 60;
const NEUTRAL = { forward: 0, strafe: 0, sprint: false, handbrake: false, shoot: false, interactPressed: false, camAngle: 0 };

function runSeconds(world, seconds, driver) {
  const steps = Math.round(seconds / STEP);
  for (let i = 0; i < steps; i += 1) {
    updateWorld(world, STEP, driver ? driver(world) : NEUTRAL);
  }
}

/** A tiny autopilot: aim the car at the objective, keep the throttle down. */
function driveTowardObjective(world) {
  const car = world.player.inCar;
  if (!car) return { ...NEUTRAL, interactPressed: false };
  const target = objectivePoint(world) || { x: 0, z: 0 };
  const desired = Math.atan2(target.x - car.x, target.z - car.z);
  const diff = wrapAngle(desired - car.angle);
  return {
    ...NEUTRAL,
    forward: 1,
    strafe: Math.max(-1, Math.min(1, diff * 2.2)),
    handbrake: Math.abs(diff) > 2.4,
  };
}

export function stageShot(name, world) {
  if (name === 'play') {
    // Mid-delivery: the player has the hot box, a car, and two stars of
    // heat, photographed at golden hour with the chase in frame.
    world.dayTime = 0.7;
    const delivery = world.catalogue.find((d) => d.id === 'hot-box');
    world.player.x = delivery.marker.x;
    world.player.z = delivery.marker.z;
    startMission(world, delivery);
    // Complete the pickup step instantly by standing on it, then find a car.
    runSeconds(world, 0.2, null);
    let nearest = null;
    let bestD = Infinity;
    for (const car of world.cars) {
      if (car.kind !== 'parked') continue;
      const d = distance(world.player.x, world.player.z, car.x, car.z);
      if (d < bestD) { bestD = d; nearest = car; }
    }
    if (nearest) {
      world.player.x = nearest.x + 1.5;
      world.player.z = nearest.z;
      toggleVehicle(world);
    }
    addCrime(world, 200, world.player.x, world.player.z);
    runSeconds(world, 7, driveTowardObjective);
    return { screen: 'play', camMode: 'follow' };
  }

  if (name === 'end') {
    // The city cleared: every job done, the money banked, golden hour over the plaza.
    world.dayTime = 0.68;
    for (const def of world.catalogue) {
      world.completed.add(def.id);
      world.cash += def.reward;
      world.score += def.reward;
    }
    world.cityCleared = true;
    world.player.x = -80;
    world.player.z = -66;
    world.player.angle = Math.PI * 0.75;
    runSeconds(world, 3, null);
    return { screen: 'cleared', camMode: 'follow' };
  }

  // start: the title screen over a slow orbit of the morning city.
  runSeconds(world, 4, null);
  return { screen: 'title', camMode: 'orbit' };
}
