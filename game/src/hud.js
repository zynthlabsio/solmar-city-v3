// The heads-up display: DOM bars and labels up top, a canvas minimap in the
// corner, toast messages, and the full-screen panels for title / pause /
// busted / wasted / city-cleared. The simulation knows none of this — main
// hands the world in each frame and this module writes what changed.

import { CITY_EDGE, AVENUE_LINES } from './city.js';
import { objectiveText, objectivePoint, distance } from './world.js';

const MAP_SIZE = 190;
const MAP_SPAN = CITY_EDGE * 2 + 30;

export function createHud() {
  const el = (id) => document.getElementById(id);
  const cashEl = el('cash');
  const starsEl = el('stars');
  const healthFill = el('health-fill');
  const objectiveEl = el('objective');
  const timerEl = el('mission-timer');
  const speedEl = el('speedo');
  const promptEl = el('prompt');
  const toastEl = el('toast');
  const arrestWrap = el('arrest');
  const arrestFill = el('arrest-fill');
  const overlay = el('overlay');
  const overlayTitle = el('overlay-title');
  const overlayLines = el('overlay-lines');
  const overlayPrompt = el('overlay-prompt');
  const mapCanvas = el('minimap');
  const mapCtx = mapCanvas.getContext('2d');

  let toastText = '';
  let toastUntil = 0;
  let staticMap = null;

  function buildStaticMap(world) {
    staticMap = document.createElement('canvas');
    staticMap.width = MAP_SIZE;
    staticMap.height = MAP_SIZE;
    const g = staticMap.getContext('2d');
    const toPx = (v) => ((v + MAP_SPAN / 2) / MAP_SPAN) * MAP_SIZE;
    g.fillStyle = '#20242b';
    g.fillRect(0, 0, MAP_SIZE, MAP_SIZE);
    g.fillStyle = '#3a3f47';
    for (const b of world.city.buildings) {
      g.fillRect(toPx(b.x - b.w / 2), toPx(b.z - b.d / 2), (b.w / MAP_SPAN) * MAP_SIZE, (b.d / MAP_SPAN) * MAP_SIZE);
    }
    g.strokeStyle = '#596270';
    g.lineWidth = 2;
    for (const line of AVENUE_LINES) {
      g.beginPath();
      g.moveTo(toPx(line), 0);
      g.lineTo(toPx(line), MAP_SIZE);
      g.stroke();
      g.beginPath();
      g.moveTo(0, toPx(line));
      g.lineTo(MAP_SIZE, toPx(line));
      g.stroke();
    }
    g.fillStyle = '#4d7c43';
    g.fillRect(toPx(-150), toPx(-150), (60 / MAP_SPAN) * MAP_SIZE, (60 / MAP_SPAN) * MAP_SIZE);
  }

  function drawMinimap(world, camYaw) {
    if (!staticMap) buildStaticMap(world);
    const g = mapCtx;
    const toPx = (v) => ((v + MAP_SPAN / 2) / MAP_SPAN) * MAP_SIZE;
    g.clearRect(0, 0, MAP_SIZE, MAP_SIZE);
    g.drawImage(staticMap, 0, 0);
    // Job markers in cyan, the live objective in gold.
    for (const def of world.catalogue) {
      if (world.completed.has(def.id)) continue;
      g.fillStyle = '#3ec6ff';
      g.beginPath();
      g.arc(toPx(def.marker.x), toPx(def.marker.z), 3, 0, Math.PI * 2);
      g.fill();
    }
    const target = objectivePoint(world);
    if (target) {
      g.fillStyle = '#ffd23e';
      g.beginPath();
      g.arc(toPx(target.x), toPx(target.z), 4, 0, Math.PI * 2);
      g.fill();
    }
    for (const car of world.cars) {
      if (car.kind === 'traffic') {
        g.fillStyle = '#c9ced6';
        g.fillRect(toPx(car.x) - 1.5, toPx(car.z) - 1.5, 3, 3);
      } else if (car.kind === 'police') {
        g.fillStyle = Math.floor(world.time * 4) % 2 ? '#ff4040' : '#4070ff';
        g.beginPath();
        g.arc(toPx(car.x), toPx(car.z), 3, 0, Math.PI * 2);
        g.fill();
      }
    }
    for (const h of world.hostiles) {
      if (!h.alive) continue;
      g.fillStyle = '#ff5340';
      g.fillRect(toPx(h.x) - 2, toPx(h.z) - 2, 4, 4);
    }
    // The player: a white arrow rotated to the camera-relative heading.
    const p = world.player;
    g.save();
    g.translate(toPx(p.x), toPx(p.z));
    g.rotate(Math.PI - p.angle); // the map is north-up; the arrow is not camera-relative
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.moveTo(0, -6);
    g.lineTo(4, 5);
    g.lineTo(-4, 5);
    g.closePath();
    g.fill();
    g.restore();
  }

  return {
    toast(text) {
      toastText = text;
      toastUntil = performance.now() + 3400;
    },
    setOverlay(panel) {
      if (!panel) {
        overlay.classList.add('hidden');
        return;
      }
      overlayTitle.textContent = panel.title;
      overlayLines.innerHTML = '';
      for (const line of panel.lines) {
        const div = document.createElement('div');
        div.textContent = line;
        overlayLines.appendChild(div);
      }
      overlayPrompt.textContent = panel.prompt || '';
      overlay.classList.remove('hidden');
    },
    update(world, camYaw) {
      const p = world.player;
      cashEl.textContent = `$${world.cash.toLocaleString('en-US')}`;
      starsEl.textContent = '★'.repeat(world.stars) + '☆'.repeat(5 - world.stars);
      starsEl.style.opacity = world.stars > 0 ? '1' : '0.35';
      healthFill.style.width = `${Math.max(0, p.hp)}%`;
      healthFill.style.background = p.hp > 35 ? '#53d769' : '#ff5340';

      const target = objectivePoint(world);
      let obj = objectiveText(world);
      if (target) {
        const d = Math.round(distance(p.x, p.z, target.x, target.z));
        const bearing = Math.atan2(target.x - p.x, target.z - p.z);
        const rel = bearing - camYaw;
        const arrows = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];
        const arrow = arrows[Math.round(((rel % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) / (Math.PI / 4)) % 8];
        obj += `  ${arrow} ${d}m`;
      }
      objectiveEl.textContent = obj;

      const step = world.mission ? world.mission.def.steps[world.mission.stepIndex] : null;
      if (step && step.timeLimit) {
        const left = Math.max(0, step.timeLimit - world.mission.stepTime);
        timerEl.textContent = `⏱ ${left.toFixed(0)}s`;
        timerEl.style.color = left < 15 ? '#ff5340' : '#ffd23e';
      } else {
        timerEl.textContent = '';
      }

      if (p.inCar) {
        speedEl.textContent = `${Math.round(Math.abs(p.inCar.speed) * 3.6)} km/h`;
        promptEl.textContent = 'E — get out · Space — handbrake';
      } else {
        speedEl.textContent = '';
        let nearCar = false;
        for (const car of world.cars) {
          if (car.kind !== 'police' && distance(p.x, p.z, car.x, car.z) < 3.4) { nearCar = true; break; }
        }
        promptEl.textContent = nearCar ? 'E — get in the car' : (world.mission ? 'F / click — shoot · Shift — sprint' : '');
      }

      arrestWrap.classList.toggle('hidden', world.arrestMeter <= 0.05);
      arrestFill.style.width = `${Math.min(100, (world.arrestMeter / 2.4) * 100)}%`;

      if (performance.now() < toastUntil) {
        toastEl.textContent = toastText;
        toastEl.classList.remove('hidden');
      } else {
        toastEl.classList.add('hidden');
      }

      drawMinimap(world, camYaw);
    },
  };
}
