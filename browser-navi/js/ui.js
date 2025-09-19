// /browser-navi/js/ui.js
import { getSetting, setSetting } from './settings.js';

/** simple toast */
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
  // Hide any legacy follow toggle if exists (e.g., top-right or bottom area)
  const legacy = document.querySelector('#follow-toggle, .follow-toggle, [data-follow-toggle]');
  if (legacy) legacy.style.display = 'none';

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

  // Create Follow button dynamically and place it LEFT of stopBtn
  let followBtn = document.getElementById('btn-follow');
  if (!followBtn) {
    followBtn = document.createElement('button');
    followBtn.id = 'btn-follow';
    followBtn.type = 'button';
    followBtn.className = 'btn btn-outline';
    followBtn.style.marginRight = '8px';
    followBtn.style.display = 'none'; // hidden until start
    followBtn.setAttribute('aria-pressed', 'true');
    followBtn.textContent = '追従 ON';
    if (stopBtn && stopBtn.parentNode) {
      stopBtn.parentNode.insertBefore(followBtn, stopBtn);
    }
  }

  // Follow toggle behavior
  const syncFollowLabel = () => {
    const on = navCtrl.isFollowEnabled();
    followBtn.textContent = on ? '追従 ON' : '追従 OFF';
    followBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
  };

  followBtn.addEventListener('click', () => {
    const next = !navCtrl.isFollowEnabled();
    navCtrl.setFollowEnabled(next);
    syncFollowLabel();
    showToast(next ? '追従を有効にしました' : '追従を停止しました');
  });

  if (startBtn) {
    startBtn.addEventListener('click', async () => {
      const s = (document.getElementById('start-coord')?.value || '').split(',').map(Number);
      const g = (document.getElementById('goal-coord')?.value || '').split(',').map(Number);
      if (s.length === 2 && g.length === 2 && s.every(n => !Number.isNaN(n)) && g.every(n => !Number.isNaN(n))) {
        await navCtrl.start([s, g]);     // start nav
        // After start: show follow toggle next to Stop
        followBtn.style.display = '';
        navCtrl.setFollowEnabled(true);
        syncFollowLabel();
      } else {
        showToast('Invalid coordinates. Use "lng,lat".');
      }
    });
  }

  if (stopBtn) {
    stopBtn.addEventListener('click', () => {
      navCtrl.stop();
      // After stop: hide follow toggle again
      followBtn.style.display = 'none';
      followBtn.setAttribute('aria-pressed', 'false');
    });
  }

  // Recenter FAB (optional)
  const recenterBtn = document.getElementById('btn-recenter');
  if (recenterBtn) {
    recenterBtn.addEventListener('click', () => showToast('Recentered.'));
  }
}
