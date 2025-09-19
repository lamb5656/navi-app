// /browser-navi/js/ui.js
import { getSetting, setSetting } from './settings.js';
import { withBackoff } from './libs/net.js';
import { API_BASE } from '../config.js';

/** toast */
function toast(msg, ms = 2500) {
  const t = document.getElementById('toast') || document.createElement('div');
  t.id = 'toast';
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  t.style.opacity = '1';
  setTimeout(() => (t.style.opacity = '0'), ms);
}

/**
 * Wire UI controls to controllers.
 * @param {import('./map.js').MapController} mapCtrl
 * @param {import('./nav.js').NavigationController} navCtrl
 */
export function bindUI(mapCtrl, navCtrl) {
  // ---- elements (index.html準拠) ----
  const $ = (id) => document.getElementById(id);

  const inputAddr        = $('addr');            // 目的地テキスト
  const btnSearch        = $('btnSearch');       // 検索
  const btnStart         = $('btnStart');        // ナビ開始
  const btnStop          = $('btnStop');         // 停止
  const btnFollowToggle  = $('btnFollowToggle'); // 追従トグル（開始前は隠す）
  const btnRecenter      = $('btnRecenter');     // 再中心

  const chkAvoidToolbar  = $('avoidTolls');      // ヘッダー側の有料回避

  const cardSearch       = $('searchCard');      // 検索候補カード
  const listSearch       = $('searchList');      // 候補リスト

  const cardSettings     = $('settingsCard');    // 設定カード
  const btnOpenSettings  = $('btnOpenSettings'); // 設定を開く
  const btnSettingsClose = $('btnSettingsClose');// 設定を閉じる
  const setAvoidTolls    = $('setAvoidTolls');
  const setProfile       = $('setProfile');
  const setTtsVolume     = $('setTtsVolume');
  const setTtsRate       = $('setTtsRate');
  const setTheme         = $('setTheme');

  // ---- state ----
  let goalLngLat = null; // [lng,lat]

  // ---- initial UI ----
  if (btnFollowToggle) {
    btnFollowToggle.style.display = 'none'; // 開始前は非表示
  }
  if (btnStop) {
    btnStop.disabled = true;
  }

  // ツールバー側の有料回避 ⇄ 設定カード側と同期
  const syncAvoidUIFromStore = () => {
    const v = !!getSetting('avoidTolls');
    if (chkAvoidToolbar) chkAvoidToolbar.checked = v;
    if (setAvoidTolls) setAvoidTolls.checked = v;
  };
  syncAvoidUIFromStore();

  // 設定カードに現在値を流し込む
  const fillSettingsFromStore = () => {
    if (setProfile)    setProfile.value    = getSetting('profile') || 'driving-car';
    if (setTtsVolume)  setTtsVolume.value  = String(getSetting('ttsVolume') ?? 1);
    if (setTtsRate)    setTtsRate.value    = String(getSetting('ttsSpeed')  ?? 1);
    if (setTheme)      setTheme.value      = getSetting('theme') || 'auto';
    syncAvoidUIFromStore();
  };

  // ---- settings open/close ----
  if (btnOpenSettings && cardSettings) {
    btnOpenSettings.addEventListener('click', (e) => {
      e.preventDefault();
      fillSettingsFromStore();
      cardSettings.style.display = '';
    });
  }
  if (btnSettingsClose && cardSettings) {
    btnSettingsClose.addEventListener('click', (e) => {
      e.preventDefault();
      if (setAvoidTolls) setSetting('avoidTolls', !!setAvoidTolls.checked);
      if (setProfile)    setSetting('profile', setProfile.value);
      if (setTtsVolume)  setSetting('ttsVolume', Number(setTtsVolume.value));
      if (setTtsRate)    setSetting('ttsSpeed', Number(setTtsRate.value));
      if (setTheme)      setSetting('theme', setTheme.value);
      syncAvoidUIFromStore();
      cardSettings.style.display = 'none';
      toast('設定を保存しました');
    });
  }

  // ツールバー側の有料回避クリックも保存
  if (chkAvoidToolbar) {
    chkAvoidToolbar.addEventListener('change', () => {
      setSetting('avoidTolls', !!chkAvoidToolbar.checked);
      if (setAvoidTolls) setAvoidTolls.checked = chkAvoidToolbar.checked;
    });
  }

  // ---- search ----
  async function geocode(text) {
    const url = `${API_BASE}/geocode?text=${encodeURIComponent(text)}`;
    const res = await withBackoff(() => fetch(url, { headers: { Accept: 'application/json' } }), { retries: 2, base: 400 });
    if (!res.ok) throw new Error('geocode failed');
    return res.json();
  }

  function openSearchCard() {
    if (cardSearch) cardSearch.style.display = '';
  }
  function closeSearchCard() {
    if (cardSearch) cardSearch.style.display = 'none';
  }

  function renderSearchResults(items) {
    if (!listSearch) return;
    listSearch.innerHTML = '';
    if (!Array.isArray(items) || !items.length) {
      listSearch.innerHTML = '<div class="sr-empty">候補がありません</div>';
      openSearchCard();
      return;
    }
    items.forEach(it => {
      const name = it.display_name || it.name || '無名';
      const lng  = Number(it.lon ?? it.lng);
      const lat  = Number(it.lat);
      const btn  = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sr-item';
      btn.textContent = name;
      btn.addEventListener('click', () => {
        goalLngLat = [lng, lat];
        if (inputAddr) inputAddr.value = name;
        // 地図を軽くセンター
        try { if (mapCtrl?.map) mapCtrl.map.easeTo({ center: goalLngLat, zoom: Math.max(mapCtrl.map.getZoom(), 14), duration: 400 }); } catch {}
        closeSearchCard();
        toast('目的地をセットしました');
      });
      listSearch.appendChild(btn);
    });
    openSearchCard();
  }

  if (btnSearch) {
    btnSearch.addEventListener('click', async (e) => {
      e.preventDefault();
      const q = (inputAddr?.value || '').trim();
      if (!q) { toast('検索ワードを入れてください'); return; }
      try {
        if (listSearch) listSearch.innerHTML = '<div class="sr-loading">検索中…</div>';
        const data = await geocode(q);
        renderSearchResults(data?.results || data || []);
      } catch (err) {
        console.error(err);
        if (listSearch) listSearch.innerHTML = '<div class="sr-error">検索に失敗しました</div>';
        openSearchCard();
      }
    });
  }

  // ---- start / stop ----
  async function resolveHere() {
    // ナビ開始時の出発点：事前に setHereInitial 済みならそれ、無ければ一度だけ取得
    if (navCtrl?.hereInitial && Array.isArray(navCtrl.hereInitial)) return navCtrl.hereInitial;
    return new Promise((resolve) => {
      if (!('geolocation' in navigator)) return resolve([139.767, 35.681]); // fallback: 東京駅
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve([pos.coords.longitude, pos.coords.latitude]),
        ()   => resolve([139.767, 35.681]),
        { enableHighAccuracy: true, timeout: 5000 }
      );
    });
  }

  if (btnStart) {
    btnStart.addEventListener('click', async (e) => {
      e.preventDefault();
      try {
        // ゴール未確定なら、その場で検索→先頭候補を採用
        if (!goalLngLat) {
          const q = (inputAddr?.value || '').trim();
          if (q) {
            const data = await geocode(q);
            const item = (data?.results || data || [])[0];
            if (item) goalLngLat = [Number(item.lon ?? item.lng), Number(item.lat)];
          }
        }
        if (!goalLngLat) { toast('先に目的地を検索・選択してください'); return; }

        const here = await resolveHere();
        await navCtrl.start([here, goalLngLat]);

        if (btnFollowToggle) {
          // 停止ボタンの左側に表示
          btnFollowToggle.style.display = '';
          if (btnStop && btnStop.parentNode && btnFollowToggle !== btnStop.previousSibling) {
            btnStop.parentNode.insertBefore(btnFollowToggle, btnStop);
          }
          navCtrl.setFollowEnabled(true);
          btnFollowToggle.textContent = '進行方向';
        }
        if (btnStop) btnStop.disabled = false;
        toast('ナビを開始しました');
      } catch (err) {
        console.error(err);
        toast('ナビ開始に失敗しました');
      }
    });
  }

  if (btnStop) {
    btnStop.addEventListener('click', (e) => {
      e.preventDefault();
      navCtrl.stop();
      if (btnFollowToggle) btnFollowToggle.style.display = 'none';
      btnStop.disabled = true;
      toast('停止しました');
    });
  }

  if (btnFollowToggle) {
    btnFollowToggle.addEventListener('click', () => {
      const next = !navCtrl.isFollowEnabled();
      navCtrl.setFollowEnabled(next);
      btnFollowToggle.textContent = next ? '進行方向' : '北固定';
      toast(next ? '追従を有効にしました' : '追従を停止しました');
    });
  }

  if (btnRecenter) {
    btnRecenter.addEventListener('click', () => toast('中心に戻しました'));
  }
}
