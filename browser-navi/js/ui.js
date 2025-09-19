// /browser-navi/js/ui.js
import { getSetting, setSetting } from './settings.js';
import { withBackoff } from './libs/net.js';

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
  // ---- hide any legacy follow toggle ----
  const legacy = document.querySelector('#follow-toggle, .follow-toggle, [data-follow-toggle]');
  if (legacy) legacy.style.display = 'none';

  // ---- settings ----
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

  // ---- start/stop/follow ----
  const startBtn = document.getElementById('btn-start');
  const stopBtn  = document.getElementById('btn-stop');

  // create follow button left to stop
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
        await navCtrl.start([s, g]);
        followBtn.style.display = '';
        navCtrl.setFollowEnabled(true);
        syncFollowLabel();
      } else {
        showToast('座標は "lng,lat" で入れてください');
      }
    });
  }

  if (stopBtn) {
    stopBtn.addEventListener('click', () => {
      navCtrl.stop();
      followBtn.style.display = 'none';
      followBtn.setAttribute('aria-pressed', 'false');
    });
  }

  // ---- search & suggestions ----
  const searchInput = document.getElementById('search-text');
  const searchBtn   = document.getElementById('btn-search');
  let resultsBox    = document.getElementById('search-results');

  // create result box if missing
  if (!resultsBox) {
    resultsBox = document.createElement('div');
    resultsBox.id = 'search-results';
    resultsBox.className = 'search-results';
    const anchor = (searchBtn && searchBtn.parentElement) || document.body;
    anchor.appendChild(resultsBox);
  }

  async function geocode(text) {
    const url = `${API_BASE}/geocode?text=${encodeURIComponent(text)}`;
    const res = await withBackoff(() => fetch(url, { headers: { 'Accept': 'application/json' }}), { retries: 2, base: 400 });
    if (!res.ok) throw new Error('geocode failed');
    return res.json();
  }

  function renderResults(list) {
    resultsBox.innerHTML = '';
    if (!Array.isArray(list) || !list.length) {
      resultsBox.innerHTML = '<div class="sr-empty">候補がありません</div>';
      return;
    }
    for (const it of list) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'sr-item';
      const name = it.display_name || it.name || 'Unknown';
      const lng  = Number(it.lon ?? it.lng);
      const lat  = Number(it.lat);
      item.textContent = name;
      item.addEventListener('click', () => {
        // set as goal
        const gc = document.getElementById('goal-coord');
        if (gc) gc.value = `${lng},${lat}`;
        // center map lightly
        try {
          if (mapCtrl?.map) {
            mapCtrl.map.easeTo({ center: [lng, lat], zoom: Math.max(mapCtrl.map.getZoom(), 14), duration: 400 });
          }
        } catch {}
        resultsBox.innerHTML = '';
        showToast('目的地をセットしました');
      });
      resultsBox.appendChild(item);
    }
  }

  async function onSearch() {
    const q = (searchInput?.value || '').trim();
    if (!q) { showToast('検索キーワードを入れてください'); return; }
    resultsBox.innerHTML = '<div class="sr-loading">検索中…</div>';
    try {
      const data = await geocode(q);
      renderResults(data?.results || data || []);
    } catch (e) {
      console.error(e);
      resultsBox.innerHTML = '<div class="sr-error">検索に失敗しました</div>';
    }
  }

  if (searchBtn)  searchBtn.addEventListener('click', onSearch);
  if (searchInput) searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') onSearch();
  });

  // ---- recenter FAB (optional) ----
  const recenterBtn = document.getElementById('btn-recenter');
  if (recenterBtn) recenterBtn.addEventListener('click', () => showToast('中心に戻しました'));
}
