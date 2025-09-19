// /browser-navi/js/ui.js
import { getSetting, setSetting } from './settings.js';
import { withBackoff } from './libs/net.js';

/** toast */
export function showToast(msg, ms = 2500) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

/** safe query with fallbacks */
function $(sel) {
  return document.querySelector(sel);
}
function ensureResultsBox(anchorEl) {
  let box = $('#search-results');
  if (!box) {
    box = document.createElement('div');
    box.id = 'search-results';
    box.className = 'search-results';
    (anchorEl?.parentElement || document.body).appendChild(box);
  }
  return box;
}

/**
 * Wire UI controls to controllers.
 * @param {import('./map.js').MapController} mapCtrl
 * @param {import('./nav.js').NavigationController} navCtrl
 */
export function bindUI(mapCtrl, navCtrl) {
  // ---- hide legacy follow toggle if any ----
  const legacy = $('#follow-toggle, .follow-toggle, [data-follow-toggle]');
  if (legacy) legacy.style.display = 'none';

  // ---- settings (avoid tolls / profile) ----
  const avoidChk = $('#chk-avoid') || $('[name="avoid-tolls"]');
  const profileSel = $('#sel-profile') || $('[name="profile"]');

  if (avoidChk) {
    avoidChk.checked = !!getSetting('avoidTolls');
    avoidChk.addEventListener('change', () => setSetting('avoidTolls', !!avoidChk.checked));
  }
  if (profileSel) {
    profileSel.value = getSetting('profile') || 'driving-car';
    profileSel.addEventListener('change', () => setSetting('profile', profileSel.value));
  }

  // ---- start/stop/follow ----
  const startBtn = $('#btn-start') || $('[data-action="start"]');
  const stopBtn  = $('#btn-stop')  || $('[data-action="stop"]');

  // dynamic follow button placed left of Stop
  let followBtn = $('#btn-follow');
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
    startBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      const s = ($('#start-coord')?.value || '').split(',').map(Number);
      const g = ($('#goal-coord')?.value || '').split(',').map(Number);
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
    stopBtn.addEventListener('click', (e) => {
      e.preventDefault();
      navCtrl.stop();
      followBtn.style.display = 'none';
      followBtn.setAttribute('aria-pressed', 'false');
    });
  }

  // ---- search (robust binding: button click + form submit) ----
  const searchInput =
    $('#search-text') ||
    $('[name="search"]') ||
    $('input[type="search"]');

  const searchBtn =
    $('#btn-search') ||
    $('[data-action="search"]') ||
    (searchInput ? searchInput.closest('form')?.querySelector('button') : null);

  const searchForm =
    $('#search-form') ||
    (searchInput ? searchInput.closest('form') : null);

  const resultsBox = ensureResultsBox(searchBtn || searchInput);

  async function geocode(text) {
    const url = `${API_BASE}/geocode?text=${encodeURIComponent(text)}`;
    const res = await withBackoff(
      () => fetch(url, { headers: { Accept: 'application/json' } }),
      { retries: 2, base: 400 }
    );
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
        const gc = $('#goal-coord');
        if (gc) gc.value = `${lng},${lat}`;
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

  // click on button
  if (searchBtn) {
    searchBtn.addEventListener('click', (e) => { e.preventDefault(); onSearch(); });
  }
  // press Enter in input
  if (searchInput) {
    searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); onSearch(); } });
  }
  // submit on form (robust path when button type="submit")
  if (searchForm) {
    searchForm.addEventListener('submit', (e) => { e.preventDefault(); onSearch(); });
  }

  // ---- settings panel toggle (if present) ----
  const settingsOpen =
    $('#btn-settings') || $('[data-action="settings"]') || $('a[href="#settings"]');
  const settingsPanel = $('#settings-panel');

  if (settingsOpen && settingsPanel) {
    settingsOpen.addEventListener('click', (e) => {
      e.preventDefault();
      const isOpen = settingsPanel.getAttribute('data-open') === '1';
      settingsPanel.setAttribute('data-open', isOpen ? '0' : '1');
      settingsPanel.style.display = isOpen ? 'none' : '';
    });
  }

  // ---- recenter FAB (optional) ----
  const recenterBtn = $('#btn-recenter');
  if (recenterBtn) recenterBtn.addEventListener('click', () => showToast('中心に戻しました'));
}
