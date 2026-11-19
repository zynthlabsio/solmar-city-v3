// Boot and the main loop for Solmar City. The world advances in fixed
// 1/60 s steps (several per slow frame, none per fast one); input, HUD and
// renderer are wired around it here and nowhere else. Screens: title,
// play, paused, busted, wasted and cleared — the last three are panels
// over the frozen or living city, dismissed with Enter.
//
// ?seed=N fixes the city layout. ?shot=start|play|end (with &seed=N)
// stages a screenshot scene instead of running the interactive loop and
// sets window.__shotReady once it has painted.

import { createWorld, updateWorld, resetAfterSetback, objectivePoint } from './world.js';
import { createInput } from './input.js';
import { createRenderer } from './render3d.js';
import { createHud } from './hud.js';
import { stageShot } from './shots.js';

const STEP = 1 / 60;
const MAX_FRAME = 0.25;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : 20261;

const canvas = document.getElementById('scene');
const status = document.getElementById('status');
const world = createWorld(seed);
const renderer = createRenderer(canvas);
renderer.setWorld(world);
renderer.resize();
const hud = createHud();

const PANELS = {
  title: {
    title: 'SOLMAR CITY',
    lines: [
      'An open-world crime sandbox in your browser.',
      'Take jobs from the glowing markers. Earn. Survive the heat.',
      '',
      'WASD — move / drive · E — enter car · F or click — shoot',
      'Shift — sprint · Space — handbrake · P — pause',
    ],
    prompt: 'Press Enter or click to play',
  },
  paused: { title: 'PAUSED', lines: ['The city waits.'], prompt: 'Press P to resume' },
  busted: { title: 'BUSTED', lines: ['The squad got you. Fine: $100. Jobs in progress are lost.'], prompt: 'Press Enter to continue' },
  wasted: { title: 'WASTED', lines: ['You wake up at Founders Plaza. Fine: $100.'], prompt: 'Press Enter to continue' },
  cleared: {
    title: 'CITY CLEARED',
    lines: ['Every job in Solmar City is done. The streets are yours.'],
    prompt: 'Press Enter to keep roaming',
  },
};

function drainEvents(events, onCleared) {
  for (const ev of events) {
    if (ev.type === 'toast') hud.toast(ev.text);
    else if (ev.type === 'shot') renderer.addTracer(ev.x1, ev.z1, ev.x2, ev.z2, ev.hostile);
    else if (ev.type === 'cleared' && onCleared) onCleared();
  }
  events.length = 0;
}

if (shot) {
  const scene = stageShot(shot, world);
  drainEvents(world.events, null);
  renderer.setObjectivePoint(objectivePoint(world));
  hud.setOverlay(scene.screen === 'play' ? null : PANELS[scene.screen]);
  if (scene.screen !== 'title') hud.update(world, renderer.camYaw());
  document.getElementById('hud').style.display = scene.screen === 'title' ? 'none' : '';
  let painted = 0;
  const paint = () => {
    // Settle the camera on the staged scene before declaring readiness.
    renderer.draw(0.5, scene.camMode);
    renderer.draw(0.016, scene.camMode);
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else window.__shotReady = true;
  };
  requestAnimationFrame(paint);
} else {
  const input = createInput(canvas);
  let screen = 'title';
  let accumulator = 0;
  let last = performance.now();
  let prevConfirmHeld = false;

  hud.setOverlay(PANELS.title);
  status.textContent = 'Solmar City. Press Enter to play.';

  function setScreen(next) {
    screen = next;
    // A click spent shooting must not also dismiss the panel it caused.
    if (next === 'busted' || next === 'wasted') input.takeConfirm();
    hud.setOverlay(next === 'play' ? null : PANELS[next]);
    if (next === 'busted') status.textContent = 'Busted.';
    if (next === 'wasted') status.textContent = 'Wasted.';
    if (next === 'cleared') status.textContent = 'City cleared.';
  }

  function confirmPressed() {
    const heldNow = input.confirmHeld();
    const edge = heldNow && !prevConfirmHeld;
    prevConfirmHeld = heldNow;
    return input.takeConfirm() || edge;
  }

  function frame(now) {
    requestAnimationFrame(frame);
    const frameDt = Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    accumulator += frameDt;

    if (input.takePause()) {
      if (screen === 'play') setScreen('paused');
      else if (screen === 'paused') setScreen('play');
    }

    if (screen === 'title' || screen === 'busted' || screen === 'wasted' || screen === 'cleared') {
      if (confirmPressed()) {
        if (screen === 'busted' || screen === 'wasted') resetAfterSetback(world);
        setScreen('play');
      }
    }

    const playing = screen === 'play' || screen === 'title' || screen === 'cleared';
    if (playing) {
      while (accumulator >= STEP) {
        const controls = screen === 'play'
          ? input.poll(renderer.camYaw())
          : { forward: 0, strafe: 0, sprint: false, handbrake: false, shoot: false, interactPressed: false, camAngle: renderer.camYaw() };
        updateWorld(world, STEP, controls);
        accumulator -= STEP;
        if (world.outcome && screen === 'play') {
          setScreen(world.outcome);
          break;
        }
      }
      drainEvents(world.events, () => { if (screen === 'play') setScreen('cleared'); });
    } else {
      accumulator = 0;
      world.events.length = 0;
    }

    renderer.setObjectivePoint(objectivePoint(world));
    renderer.draw(frameDt, screen === 'title' ? 'orbit' : 'follow');
    if (screen !== 'title') hud.update(world, renderer.camYaw());
    document.getElementById('hud').style.display = screen === 'title' ? 'none' : '';
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && screen === 'play') setScreen('paused');
  });

  requestAnimationFrame(frame);
}
