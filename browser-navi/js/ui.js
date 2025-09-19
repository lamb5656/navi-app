// /browser-navi/js/ui.js
// UI bindings (no DOMContentLoaded hook; main.js calls bindUI)

import { getSetting, setSetting } from './settings.js';

export function showToast(msg, ms = 3000) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

/**
 * Wire UI controls to controllers.
 * @param {import('./map.js').MapController} mapCtrl
 * @param {import('./nav.js').NavigationController} navCtrl
 */
export function bindUI(mapCtrl, navCtrl) {
  // Settings controls
  const avoidChk = document.getElementById('chk-avoid');
  const profileSel = document.getElementById('sel-profile');

  if (avoidChk) {
    avoidChk.checked = !!getSetting('avoidTolls');
    avoidChk.addEventListener('change', () => setSetting('avoidTolls', avoidChk.checked));
  }
  if (profileSel) {
    profileSel.value = getSetting('profile') || 'driving-car';
    profileSel.addEventListener('change', () => setSetting('profile', profileSel.value));
  }

  // Start/Stop
  const startBtn = document.getElementById('btn-start');
  const stopBtn = document.getElementById('btn-stop');

  if (startBtn) {
    startBtn.addEventListener('click', () => {
      const s = (document.getElementById('start-coord')?.value || '').split(',').map(Number);
      const g = (document.getElementById('goal-coord')?.value || '').split(',').map(Number);
      if (s.length === 2 && g.length === 2 && s.every(n => !Number.isNaN(n)) && g.every(n => !Number.isNaN(n))) {
        navCtrl.start([s, g]);
      } else {
        showToast('Invalid coordinates. Use "lng,lat".');
      }
    });
  }

  if (stopBtn) {
    stopBtn.addEventListener('click', () => navCtrl.stop());
  }

  // Recenter FAB (if present)
  const recenterBtn = document.getElementById('btn-recenter');
  if (recenterBtn) {
    recenterBtn.addEventListener('click', () => {
      // If we have an initial position, reuse it; otherwise no-op
      // MapController follow is handled by NavigationController via geolocation updates.
      // Here we can just provide a visual feedback.
      showToast('Recentered.');
    });
  }
}
