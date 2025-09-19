// js/ui.js
// 検索UI・設定カード・ボタン束ね
import { startNavigation, stopNavigation } from './nav.js';
import { getSetting, setSetting } from './settings.js';
initSettings();

export function showToast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

document.addEventListener('DOMContentLoaded', () => {
  const startBtn = document.getElementById('btn-start');
  const stopBtn = document.getElementById('btn-stop');
  const avoidChk = document.getElementById('chk-avoid');
  const profileSel = document.getElementById('sel-profile');

  avoidChk.checked = !!getSetting('avoidTolls');
  profileSel.value = getSetting('profile') || 'driving-car';

  avoidChk.addEventListener('change', () => setSetting('avoidTolls', avoidChk.checked));
  profileSel.addEventListener('change', () => setSetting('profile', profileSel.value));

  startBtn.addEventListener('click', () => {
    const start = document.getElementById('start-coord').value.split(',').map(Number);
    const goal = document.getElementById('goal-coord').value.split(',').map(Number);
    if (start.length === 2 && goal.length === 2) {
      startNavigation([start, goal]);
    } else {
      showToast('座標を正しく入力するにゃ');
    }
  });

  stopBtn.addEventListener('click', () => stopNavigation());
});
