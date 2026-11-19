// The three.js renderer for Solmar City. It builds the static city once
// (ground painted onto one big canvas texture, towers as textured boxes,
// instanced lamps/trees/crates) and then, every frame, syncs a small pool
// of dynamic meshes — cars, people, markers, tracers — to the simulation
// state. All game rules live in world.js; this file only draws them and
// owns the camera and the day/night lighting rig.

import * as THREE from 'three';
import { AVENUE_LINES, ROAD_HALF, CITY_EDGE } from './city.js';
import { wrapAngle } from './world.js';

const CAR_COLORS = [0xc23b2e, 0x2e6fc2, 0xe0a51f, 0x3fae5a, 0x8e44ad, 0xd7d9dc];
const PED_COLORS = [0xe8b04b, 0x4b9be8, 0xe84b6a, 0x6ae84b, 0xe8e0d0, 0x9b4be8];
const WORLD_SPAN = CITY_EDGE * 2 + 40;

/** Paint a building facade: base colour, a grid of windows, a few lit. */
function facadeTexture(hex, floors, cols, seedSalt) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 256;
  const g = canvas.getContext('2d');
  const base = `#${hex.toString(16).padStart(6, '0')}`;
  g.fillStyle = base;
  g.fillRect(0, 0, 128, 256);
  g.fillStyle = 'rgba(0,0,0,0.18)';
  g.fillRect(0, 0, 128, 10);
  let salt = seedSalt * 2654435761 % 4294967296;
  const rand = () => {
    salt = (salt * 1664525 + 1013904223) >>> 0;
    return salt / 4294967296;
  };
  const ww = 128 / cols;
  const hh = 256 / floors;
  for (let r = 0; r < floors; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const lit = rand() < 0.28;
      g.fillStyle = lit ? '#ffd98a' : 'rgba(38,52,68,0.85)';
      g.fillRect(c * ww + ww * 0.22, r * hh + hh * 0.24, ww * 0.56, hh * 0.5);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Paint the whole ground plane: asphalt avenues, dashes, sidewalks, the park, the lot. */
function groundTexture(city) {
  const SIZE = 2048;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const g = canvas.getContext('2d');
  const toPx = (v) => ((v + WORLD_SPAN / 2) / WORLD_SPAN) * SIZE;
  const scale = SIZE / WORLD_SPAN;

  g.fillStyle = '#565b52'; // outskirts scrub beyond the streets
  g.fillRect(0, 0, SIZE, SIZE);

  // Block pavement first, then the park lawn on top of its block.
  g.fillStyle = '#7d7f7c';
  for (let bx = 0; bx < 6; bx += 1) {
    for (let bz = 0; bz < 6; bz += 1) {
      const x = AVENUE_LINES[bx] + ROAD_HALF;
      const z = AVENUE_LINES[bz] + ROAD_HALF;
      const inner = 80 - ROAD_HALF * 2;
      const isPark = bx === 1 && bz === 1;
      const isLot = bx === 4 && bz === 4;
      g.fillStyle = isPark ? '#4d7c43' : isLot ? '#5c5f63' : '#7d7f7c';
      g.fillRect(toPx(x), toPx(z), inner * scale, inner * scale);
      if (isLot) {
        g.strokeStyle = 'rgba(240,240,240,0.5)';
        g.lineWidth = 2;
        for (let row = 0; row < 2; row += 1) {
          for (let col = 0; col < 4; col += 1) {
            g.strokeRect(toPx(x + 8 + col * 11), toPx(z + 11 + row * 26), 9 * scale, 5 * scale);
          }
        }
      }
    }
  }

  // Asphalt avenues with a dashed centreline.
  g.fillStyle = '#33373d';
  for (const line of AVENUE_LINES) {
    g.fillRect(toPx(line - ROAD_HALF), 0, ROAD_HALF * 2 * scale, SIZE);
    g.fillRect(0, toPx(line - ROAD_HALF), SIZE, ROAD_HALF * 2 * scale);
  }
  g.fillStyle = '#d8d8ce';
  for (const line of AVENUE_LINES) {
    for (let d = -WORLD_SPAN / 2; d < WORLD_SPAN / 2; d += 14) {
      g.fillRect(toPx(line) - 1, toPx(d), 2, 7 * scale);
      g.fillRect(toPx(d), toPx(line) - 1, 7 * scale, 2);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** A low-poly person: legs, torso, head. Shirt colour varies. */
function makePerson(shirtHex, skinHex = 0xd9a066) {
  const group = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: shirtHex });
  const dark = new THREE.MeshLambertMaterial({ color: 0x2c2f36 });
  const skin = new THREE.MeshLambertMaterial({ color: skinHex });
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.8, 0.3), dark);
  legs.position.y = 0.4;
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.75, 0.34), mat);
  torso.position.y = 1.17;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.21, 10, 8), skin);
  head.position.y = 1.78;
  group.add(legs, torso, head);
  group.userData.torso = torso;
  return group;
}

/** A simple sedan: body, cabin, four wheels; police get a light bar. */
function makeCarMesh(car) {
  const group = new THREE.Group();
  const isPolice = car.kind === 'police';
  const bodyColor = isPolice ? 0xf2f3f5 : CAR_COLORS[car.hue % CAR_COLORS.length];
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(1.9, 0.55, 4.3),
    new THREE.MeshLambertMaterial({ color: bodyColor }),
  );
  body.position.y = 0.55;
  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(1.7, 0.5, 2.1),
    new THREE.MeshLambertMaterial({ color: isPolice ? 0x22262c : 0x1d2733 }),
  );
  cabin.position.set(0, 1.05, -0.2);
  group.add(body, cabin);
  const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.25, 10);
  const wheelMat = new THREE.MeshLambertMaterial({ color: 0x14161a });
  for (const [wx, wz] of [[-0.95, 1.35], [0.95, 1.35], [-0.95, -1.35], [0.95, -1.35]]) {
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(wx, 0.36, wz);
    group.add(wheel);
  }
  if (isPolice) {
    const bar = new THREE.Group();
    const red = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.18, 0.5),
      new THREE.MeshBasicMaterial({ color: 0xff2a2a }));
    red.position.x = -0.3;
    const blue = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.18, 0.5),
      new THREE.MeshBasicMaterial({ color: 0x2a5aff }));
    blue.position.x = 0.3;
    bar.add(red, blue);
    bar.position.y = 1.4;
    bar.position.z = -0.2;
    group.add(bar);
    group.userData.lightBar = bar;
  }
  return group;
}

export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87b5d9);
  scene.fog = new THREE.Fog(0x87b5d9, 180, 620);
  const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 1500);

  const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x54503e, 0.9);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff2d8, 1.6);
  scene.add(sun);
  scene.add(sun.target);

  // Stars for the night sky, faded in by the day cycle.
  const starGeo = new THREE.BufferGeometry();
  {
    const pts = [];
    let salt = 1234567;
    const rand = () => { salt = (salt * 1664525 + 1013904223) >>> 0; return salt / 4294967296; };
    for (let i = 0; i < 700; i += 1) {
      const a = rand() * Math.PI * 2;
      const e = rand() * Math.PI * 0.48 + 0.05;
      pts.push(Math.cos(a) * Math.cos(e) * 900, Math.sin(e) * 900, Math.sin(a) * Math.cos(e) * 900);
    }
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  }
  const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0 });
  const stars = new THREE.Points(starGeo, starMat);
  scene.add(stars);
  const moon = new THREE.Mesh(new THREE.SphereGeometry(18, 12, 10), new THREE.MeshBasicMaterial({ color: 0xe8ecf2 }));
  scene.add(moon);

  let world = null;
  let built = false;
  const carMeshes = new Map();
  const pedMeshes = new Map();
  const hostileMeshes = new Map();
  let playerMesh = null;
  let markerGroup = null;
  let pickupGroup = null;
  let objectiveMesh = null;
  let lampHeadMat = null;
  const facadeMats = [];
  const tracers = [];

  function buildCity() {
    const city = world.city;
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(WORLD_SPAN, WORLD_SPAN),
      new THREE.MeshLambertMaterial({ map: groundTexture(city) }),
    );
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);

    // Towers. Facade materials are cached per colour/height bucket so the
    // whole district shares a handful of textures.
    const matCache = new Map();
    for (const b of city.buildings) {
      const floors = Math.max(3, Math.round(b.h / 3.4));
      const cols = Math.max(3, Math.round(b.w / 4));
      const key = `${b.color}-${floors}-${cols}`;
      if (!matCache.has(key)) {
        const tex = facadeTexture(b.color, floors, cols, b.x * 31 + b.z);
        const mat = new THREE.MeshLambertMaterial({ map: tex, emissive: 0xffc37a, emissiveMap: tex, emissiveIntensity: 0 });
        matCache.set(key, mat);
        facadeMats.push(mat);
      }
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), matCache.get(key));
      mesh.position.set(b.x, b.h / 2, b.z);
      scene.add(mesh);
      const roof = new THREE.Mesh(
        new THREE.BoxGeometry(b.w + 0.6, 0.7, b.d + 0.6),
        new THREE.MeshLambertMaterial({ color: b.roof }),
      );
      roof.position.set(b.x, b.h + 0.35, b.z);
      scene.add(roof);
    }

    // Lamps: instanced poles, instanced glowing heads.
    const poleGeo = new THREE.CylinderGeometry(0.09, 0.12, 5.4, 6);
    const poleMat = new THREE.MeshLambertMaterial({ color: 0x3a3f45 });
    const poles = new THREE.InstancedMesh(poleGeo, poleMat, city.lamps.length);
    lampHeadMat = new THREE.MeshBasicMaterial({ color: 0x554f38 });
    const headGeo = new THREE.SphereGeometry(0.32, 8, 6);
    const heads = new THREE.InstancedMesh(headGeo, lampHeadMat, city.lamps.length);
    const m4 = new THREE.Matrix4();
    city.lamps.forEach((lamp, i) => {
      m4.makeTranslation(lamp.x, 2.7, lamp.z);
      poles.setMatrixAt(i, m4);
      m4.makeTranslation(lamp.x, 5.5, lamp.z);
      heads.setMatrixAt(i, m4);
    });
    scene.add(poles, heads);

    // Trees and crates, also instanced.
    const trunkGeo = new THREE.CylinderGeometry(0.16, 0.22, 1.6, 6);
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x6b4a2f });
    const leafGeo = new THREE.IcosahedronGeometry(1.9, 0);
    const leafMat = new THREE.MeshLambertMaterial({ color: 0x3f7031 });
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, city.trees.length);
    const leaves = new THREE.InstancedMesh(leafGeo, leafMat, city.trees.length);
    city.trees.forEach((tree, i) => {
      m4.makeScale(tree.s, tree.s, tree.s);
      m4.setPosition(tree.x, 0.8 * tree.s, tree.z);
      trunks.setMatrixAt(i, m4);
      m4.makeScale(tree.s, tree.s, tree.s);
      m4.setPosition(tree.x, (1.6 + 1.4) * tree.s, tree.z);
      leaves.setMatrixAt(i, m4);
    });
    scene.add(trunks, leaves);

    const crateGeo = new THREE.BoxGeometry(2, 2, 2);
    const crateMat = new THREE.MeshLambertMaterial({ color: 0x9a7433 });
    const crateMesh = new THREE.InstancedMesh(crateGeo, crateMat, Math.max(1, city.crates.length));
    city.crates.forEach((crate, i) => {
      m4.identity();
      m4.setPosition(crate.x, 1, crate.z);
      crateMesh.setMatrixAt(i, m4);
    });
    scene.add(crateMesh);

    playerMesh = makePerson(0x20409e);
    scene.add(playerMesh);
    markerGroup = new THREE.Group();
    pickupGroup = new THREE.Group();
    scene.add(markerGroup, pickupGroup);
    objectiveMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(3.4, 3.4, 26, 20, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffd23e, transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false }),
    );
    scene.add(objectiveMesh);
    built = true;
  }

  function syncMarkers() {
    markerGroup.clear();
    for (const def of world.catalogue) {
      if (world.completed.has(def.id) || (world.mission && world.mission.def.id === def.id)) continue;
      const ring = new THREE.Mesh(
        new THREE.CylinderGeometry(3, 3, 14, 18, 1, true),
        new THREE.MeshBasicMaterial({ color: 0x3ec6ff, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false }),
      );
      ring.position.set(def.marker.x, 7, def.marker.z);
      markerGroup.add(ring);
    }
    pickupGroup.clear();
    for (const pk of world.pickups) {
      if (pk.taken) continue;
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(0.9, 0.6, 0.9),
        new THREE.MeshBasicMaterial({ color: 0x53ff7a }),
      );
      box.position.set(pk.x, 1 + Math.sin(world.time * 3 + pk.x) * 0.25, pk.z);
      box.rotation.y = world.time * 1.8;
      pickupGroup.add(box);
    }
    // The race's next checkpoint gets a floating ring to drive through.
    const step = world.mission ? world.mission.def.steps[world.mission.stepIndex] : null;
    if (step && step.kind === 'race') {
      const cp = step.checkpoints[world.mission.raceIndex];
      if (cp) {
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(5, 0.45, 8, 22),
          new THREE.MeshBasicMaterial({ color: 0xff9f1c }),
        );
        ring.position.set(cp.x, 3.4, cp.z);
        pickupGroup.add(ring);
      }
    }
  }

  function syncEntities() {
    const seen = new Set();
    for (const car of world.cars) {
      seen.add(car.id);
      let mesh = carMeshes.get(car.id);
      if (!mesh) {
        mesh = makeCarMesh(car);
        carMeshes.set(car.id, mesh);
        scene.add(mesh);
      }
      mesh.position.set(car.x, 0, car.z);
      mesh.rotation.y = car.angle;
      if (mesh.userData.lightBar) {
        const phase = Math.floor(world.time * 6) % 2 === 0;
        mesh.userData.lightBar.children[0].visible = phase;
        mesh.userData.lightBar.children[1].visible = !phase;
      }
      const damageTilt = car.hp < 45 ? 0.05 : 0;
      mesh.rotation.z = damageTilt;
    }
    for (const [id, mesh] of carMeshes) {
      if (!seen.has(id)) {
        scene.remove(mesh);
        carMeshes.delete(id);
      }
    }

    const p = world.player;
    playerMesh.visible = !p.inCar;
    playerMesh.position.set(p.x, 0, p.z);
    playerMesh.rotation.y = p.angle;

    const seenPeds = new Set();
    for (const ped of world.peds) {
      seenPeds.add(ped.id);
      let mesh = pedMeshes.get(ped.id);
      if (!mesh) {
        mesh = makePerson(PED_COLORS[ped.hue % PED_COLORS.length]);
        pedMeshes.set(ped.id, mesh);
        scene.add(mesh);
      }
      mesh.position.set(ped.x, ped.state === 'down' ? -0.55 : 0, ped.z);
      mesh.rotation.set(ped.state === 'down' ? Math.PI / 2 : 0, ped.angle, 0);
    }
    for (const [id, mesh] of pedMeshes) {
      if (!seenPeds.has(id)) { scene.remove(mesh); pedMeshes.delete(id); }
    }

    const seenH = new Set();
    for (const h of world.hostiles) {
      seenH.add(h.id);
      let mesh = hostileMeshes.get(h.id);
      if (!mesh) {
        mesh = makePerson(h.chief ? 0xb02020 : 0x30303a);
        hostileMeshes.set(h.id, mesh);
        scene.add(mesh);
      }
      mesh.position.set(h.x, h.alive ? 0 : -0.55, h.z);
      mesh.rotation.set(h.alive ? 0 : Math.PI / 2, h.angle, 0);
    }
    for (const [id, mesh] of hostileMeshes) {
      if (!seenH.has(id)) { scene.remove(mesh); hostileMeshes.delete(id); }
    }
    if (world.hostiles.length === 0 && hostileMeshes.size > 0) {
      for (const [id, mesh] of hostileMeshes) { scene.remove(mesh); hostileMeshes.delete(id); }
    }
  }

  function updateLighting() {
    // dayTime 0 = midnight, 0.25 = sunrise, 0.5 = noon, 0.75 = sunset.
    const sunAngle = (world.dayTime - 0.25) * Math.PI * 2;
    const elevation = Math.sin(sunAngle);
    const azimuth = Math.cos(sunAngle);
    sun.position.set(world.player.x + azimuth * 260, Math.max(18, elevation * 300), world.player.z + 120);
    sun.target.position.set(world.player.x, 0, world.player.z);
    const day = THREE.MathUtils.clamp(elevation * 1.6 + 0.25, 0, 1);
    sun.intensity = 0.12 + day * 1.5;
    hemi.intensity = 0.22 + day * 0.75;
    const skyDay = new THREE.Color(0x87b5d9);
    const skyDusk = new THREE.Color(0xe88a4e);
    const skyNight = new THREE.Color(0x0b1026);
    const sky = elevation > 0.12
      ? skyDay.clone().lerp(skyDusk, 1 - Math.min(1, elevation * 3))
      : skyNight.clone().lerp(skyDusk, Math.max(0, (elevation + 0.25) * 2.4));
    scene.background.copy(sky);
    scene.fog.color.copy(sky);
    starMat.opacity = THREE.MathUtils.clamp(0.25 - elevation, 0, 1) * 0.95;
    stars.position.set(world.player.x, 0, world.player.z);
    moon.position.set(world.player.x - azimuth * 700, Math.max(60, -elevation * 500), world.player.z - 300);
    const night = day < 0.35;
    if (lampHeadMat) lampHeadMat.color.setHex(night ? 0xffd98a : 0x554f38);
    for (const mat of facadeMats) mat.emissiveIntensity = night ? 0.85 : 0.0;
  }

  function updateTracers(dt) {
    for (let i = tracers.length - 1; i >= 0; i -= 1) {
      const tr = tracers[i];
      tr.ttl -= dt;
      tr.line.material.opacity = Math.max(0, tr.ttl / 0.14);
      if (tr.ttl <= 0) {
        scene.remove(tr.line);
        tr.line.geometry.dispose();
        tr.line.material.dispose();
        tracers.splice(i, 1);
      }
    }
  }

  let camYaw = Math.PI;
  let camPos = new THREE.Vector3(0, 30, -60);

  function updateCamera(dt, mode) {
    const p = world.player;
    if (mode === 'orbit') {
      const a = world.time * 0.07;
      const target = new THREE.Vector3(0, 8, 0);
      camPos.set(target.x + Math.cos(a) * 135, 58 + Math.sin(world.time * 0.16) * 6, target.z + Math.sin(a) * 135);
      camera.position.lerp(camPos, 1);
      camera.lookAt(target);
      camYaw = a + Math.PI / 2;
      return;
    }
    const focusAngle = p.inCar ? p.inCar.angle : p.angle;
    let diff = wrapAngle(focusAngle - camYaw);
    if (Math.abs(diff) > 2.6) camYaw = focusAngle; // hard cut after a teleport/respawn
    else camYaw += diff * Math.min(1, dt * (p.inCar ? 3.2 : 2.2));
    const dist = p.inCar ? 11.5 : 7.5;
    const height = p.inCar ? 4.6 : 3.4;
    const back = new THREE.Vector3(
      p.x - Math.sin(camYaw) * dist,
      height,
      p.z - Math.cos(camYaw) * dist,
    );
    camPos.lerp(back, Math.min(1, dt * 7));
    camera.position.copy(camPos);
    camera.lookAt(p.x + Math.sin(camYaw) * 6, 1.7, p.z + Math.cos(camYaw) * 6);
  }

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);

  return {
    setWorld(next) {
      world = next;
      if (!built) buildCity();
    },
    addTracer(x1, z1, x2, z2, hostile) {
      const geo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(x1, 1.45, z1),
        new THREE.Vector3(x2, 1.3, z2),
      ]);
      const mat = new THREE.LineBasicMaterial({ color: hostile ? 0xff5340 : 0xffe066, transparent: true, opacity: 1 });
      const line = new THREE.Line(geo, mat);
      scene.add(line);
      tracers.push({ line, ttl: 0.14 });
    },
    camYaw() {
      return camYaw;
    },
    draw(dt, camMode) {
      if (!world) return;
      syncEntities();
      syncMarkers();
      updateLighting();
      updateTracers(dt);
      updateCamera(dt, camMode);
      const objective = world.mission || world.completed.size < world.catalogue.length;
      objectiveMesh.visible = !!objective;
      if (objective) {
        // Lazy import-free lookup: main passes the point through userData.
        const pt = objectiveMesh.userData.point;
        if (pt) objectiveMesh.position.set(pt.x, 13, pt.z);
        else objectiveMesh.visible = false;
      }
      renderer.render(scene, camera);
    },
    setObjectivePoint(pt) {
      objectiveMesh.userData.point = pt;
    },
    resize,
  };
}
