// Keyboard and pointer input for Solmar City. Held keys are read as a
// normalised control state each frame; one-shot presses (confirm, pause,
// interact) are latched as edges so a tap between frames is never lost and
// never counted twice. The simulation never touches the DOM — main.js asks
// this module what the player wants and passes plain numbers onward.

const HELD = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  handbrake: ['Space'],
  shoot: ['KeyF'],
};
const CODE_TO_ACTION = new Map();
for (const [action, codes] of Object.entries(HELD)) {
  for (const code of codes) CODE_TO_ACTION.set(code, action);
}

export function createInput(canvas) {
  const held = { forward: false, back: false, left: false, right: false, sprint: false, handbrake: false, shoot: false };
  let mouseShoot = false;
  let confirmEdge = false;
  let pauseEdge = false;
  let interactEdge = false;

  window.addEventListener('keydown', (event) => {
    const action = CODE_TO_ACTION.get(event.code);
    if (action) {
      held[action] = true;
      event.preventDefault();
      return;
    }
    if (event.code === 'Enter' && !event.repeat) confirmEdge = true;
    else if ((event.code === 'KeyP' || event.code === 'Escape') && !event.repeat) pauseEdge = true;
    else if (event.code === 'KeyE' && !event.repeat) interactEdge = true;
  });
  window.addEventListener('keyup', (event) => {
    const action = CODE_TO_ACTION.get(event.code);
    if (action) held[action] = false;
  });
  window.addEventListener('blur', () => {
    for (const key of Object.keys(held)) held[key] = false;
    mouseShoot = false;
  });
  canvas.addEventListener('pointerdown', (event) => {
    if (event.button === 0) {
      mouseShoot = true;
      confirmEdge = true;
    }
  });
  window.addEventListener('pointerup', (event) => {
    if (event.button === 0) mouseShoot = false;
  });

  return {
    /** Continuous control state for one simulation step. */
    poll(camAngle) {
      const state = {
        forward: (held.forward ? 1 : 0) - (held.back ? 1 : 0),
        strafe: (held.right ? 1 : 0) - (held.left ? 1 : 0),
        sprint: held.sprint,
        handbrake: held.handbrake,
        shoot: held.shoot || mouseShoot,
        interactPressed: interactEdge,
        camAngle,
      };
      interactEdge = false;
      return state;
    },
    /** One-shot menu presses, consumed by the caller. */
    takeConfirm() {
      const taken = confirmEdge;
      confirmEdge = false;
      return taken;
    },
    takePause() {
      const taken = pauseEdge;
      pauseEdge = false;
      return taken;
    },
    /** Space doubles as the menu confirm key outside of driving. */
    confirmHeld() {
      return held.handbrake;
    },
  };
}
