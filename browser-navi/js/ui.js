// /browser-navi/js/ui.js
import { getSetting, setSetting } from './settings.js';
import { withBackoff } from './libs/net.js';
import { API_BASE } from '../config.js';

function log(...args){ try{ console.log('[SVN]', ...args); }catch{} }
function toast(msg, ms = 2000) {
  let t = document.getElementById('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; document.body.appendChild(t); }
  t.textContent = msg; t.style.opacity = '1';
  setTimeout(() => (t.style.opacity = '0'), ms);
}

/** 強制表示: 開く時だけ .svn-force-open を付与、閉じる時は外す */
function ensureForceStyle() {
  let styleTag = document.getElementById('svn-force-style');
  if (!styleTag) {
    styleTag = document.createElement('style');
    styleTag.id = 'svn-force-style';
    styleTag.textContent = `.svn-force-open{display:block!important;visibility:visible!important;opacity:1!important;pointer-events:auto!important}`;
    document.head.appendChild(styleTag);
  }
}
function forceOpen(el){ if(!el) return; ensureForceStyle(); el.classList.add('svn-force-open'); el.style.display=''; }
function forceClose(el){ if(!el) return; el.classList.remove('svn-force-open'); el.style.display='none'; }

export function bindUI(mapCtrl, navCtrl){
  const $ = (id) => document.getElementById(id);

  const els = {
    addr: $('addr'),
    btnSearch: $('btnSearch'),
    btnStart: $('btnStart'),
    btnStop: $('btnStop'),
    btnFollowToggle: $('btnFollowToggle'),
    btnRecenter: $('btnRecenter'),
    avoidTollsToolbar: $('avoidTolls'),
    searchCard: $('searchCard'),
    searchList: $('searchList'),
    settingsCard: $('settingsCard'),
    btnOpenSettings: $('btnOpenSettings'),
    btnSettingsClose: $('btnSettingsClose'),
    setAvoidTolls: $('setAvoidTolls'),
    setProfile: $('setProfile'),
    setTtsVolume: $('setTtsVolume'),
    setTtsRate: $('setTtsRate'),
    setTheme: $('setTheme'),
  };

  if (els.btnFollowToggle) els.btnFollowToggle.style.display = 'none';
  if (els.btnStop) els.btnStop.disabled = true;

  const syncAvoidUIFromStore = () => {
    const v = !!getSetting('avoidTolls');
    if (els.avoidTollsToolbar) els.avoidTollsToolbar.checked = v;
    if (els.setAvoidTolls) els.setAvoidTolls.checked = v;
  };
  const fillSettingsFromStore = () => {
    if (els.setProfile)   els.setProfile.value   = getSetting('profile') || 'driving-car';
    if (els.setTtsVolume) els.setTtsVolume.value = String(getSetting('ttsVolume') ?? 1);
    if (els.setTtsRate)   els.setTtsRate.value   = String(getSetting('ttsSpeed')  ?? 1);
    if (els.setTheme)     els.setTheme.value     = getSetting('theme') || 'auto';
    syncAvoidUIFromStore();
  };
  syncAvoidUIFromStore();

  // ---------- 検索 ----------
  async function geocode(text){
    const url = `${API_BASE}/geocode?text=${encodeURIComponent(text)}`;
    const res = await withBackoff(() => fetch(url, { headers: { Accept: 'application/json' } }), { retries: 1, base: 300 });
    if (!res.ok) throw new Error(`geocode http ${res.status}`);
    const data = await res.json();
    log('geocode raw', data);
    // 返り値の形を正規化
    const items = normalizeGeocode(data);
    log('geocode normalized', items?.length);
    return items;
  }

  function normalizeGeocode(data){
    // 1) すでに配列
    if (Array.isArray(data)) return data;
    // 2) {results: [...]}
    if (Array.isArray(data?.results)) return data.results;
    // 3) {data: [...]}
    if (Array.isArray(data?.data)) return data.data;
    // 4) {features:[{geometry:{coordinates:[lng,lat]},properties:{display_name}}]}
    if (Array.isArray(data?.features)) {
      return data.features
        .map(f=>{
          const c = f?.geometry?.coordinates;
          return c && { lon: Number(c[0]), lat: Number(c[1]), display_name: f?.properties?.display_name || f?.properties?.name || '' };
        })
        .filter(Boolean);
    }
    // 5) {items:[...]}, {places:[...]} も一応拾う
    if (Array.isArray(data?.items)) return data.items;
    if (Array.isArray(data?.places)) return data.places;
    // 6) Nominatim素の返りが入ってるキー
    if (Array.isArray(data?.nominatim)) return data.nominatim;
    // 7) 想定外 → 空
    return [];
  }

  function openSearchCard(){ if (els.searchCard){ forceOpen(els.searchCard); } }
  function closeSearchCard(){ if (els.searchCard){ forceClose(els.searchCard); } }

  function renderSearchResults(items){
    if (!els.searchList) return;
    els.searchList.innerHTML = '';
    if (!Array.isArray(items) || !items.length){
      els.searchList.innerHTML = '<div class="sr-empty">候補がありません</div>';
      openSearchCard(); return;
    }
    for (const it of items){
      const name = it.display_name || it.name || it.label || '名称未設定';
      // キー名のゆらぎに対応
      const lng  = Number(it.lon ?? it.lng ?? it.longitude ?? it.center?.[0]);
      const lat  = Number(it.lat ?? it.latitude ?? it.center?.[1]);
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;

      const btn  = document.createElement('button');
      btn.type = 'button'; btn.className = 'sr-item'; btn.textContent = name;
      btn.addEventListener('click', ()=>{
        state.goalLngLat = [lng, lat];
        if (els.addr) els.addr.value = name;
        try { if (mapCtrl?.map) mapCtrl.map.easeTo({ center: state.goalLngLat, zoom: Math.max(mapCtrl.map.getZoom(), 14), duration: 400 }); } catch{}
        closeSearchCard(); toast('目的地を設定しました');
      });
      els.searchList.appendChild(btn);
    }
    openSearchCard();
  }

  async function onSearch(){
    const q = (els.addr?.value || '').trim();
    log('onSearch', q);
    if (!q){ toast('検索ワードを入力してください'); return; }
    if (els.searchList) els.searchList.innerHTML = '<div class="sr-loading">検索中…</div>';
    try {
      const items = await geocode(q);
      renderSearchResults(items);
    } catch (err) {
      console.error('[SVN] geocode error', err);
      if (els.searchList) els.searchList.innerHTML = '<div class="sr-error">検索に失敗しました</div>';
      openSearchCard();
    }
  }

  // ---------- ナビ開始/停止 ----------
  const state = { goalLngLat: null };

  async function resolveHere(){
    if (navCtrl?.hereInitial && Array.isArray(navCtrl.hereInitial)) return navCtrl.hereInitial;
    return new Promise((resolve)=>{
      if (!('geolocation' in navigator)) return resolve([139.767, 35.681]);
      navigator.geolocation.getCurrentPosition(
        (pos)=>resolve([pos.coords.longitude, pos.coords.latitude]),
        ()=>resolve([139.767, 35.681]),
        { enableHighAccuracy: true, timeout: 5000 }
      );
    });
  }

  async function onStart(){
    log('onStart');
    try{
      if (!state.goalLngLat){
        const q = (els.addr?.value || '').trim();
        if (q){
          const items = await geocode(q);
          const it = items[0];
          if (it){
            state.goalLngLat = [
              Number(it.lon ?? it.lng ?? it.longitude ?? it.center?.[0]),
              Number(it.lat ?? it.latitude ?? it.center?.[1]),
            ];
          }
        }
      }
      if (!state.goalLngLat){ toast('先に目的地を検索して選択してください'); return; }

      const here = await resolveHere();
      await navCtrl.start([here, state.goalLngLat]);

      if (els.btnFollowToggle){
        els.btnFollowToggle.style.display = '';
        if (els.btnStop && els.btnStop.parentNode && els.btnFollowToggle !== els.btnStop.previousSibling) {
          els.btnStop.parentNode.insertBefore(els.btnFollowToggle, els.btnStop);
        }
        navCtrl.setFollowEnabled(true);
        els.btnFollowToggle.textContent = '進行方向';
      }
      if (els.btnStop) els.btnStop.disabled = false;
      toast('ナビを開始しました');
    }catch(e){ console.error(e); toast('ナビの開始に失敗しました'); }
  }

  function onStop(){
    log('onStop');
    navCtrl.stop();
    if (els.btnFollowToggle) els.btnFollowToggle.style.display = 'none';
    if (els.btnStop) els.btnStop.disabled = true;
    toast('ナビを停止しました');
  }

  function onFollowToggle(){
    log('onFollowToggle');
    const next = !navCtrl.isFollowEnabled();
    navCtrl.setFollowEnabled(next);
    if (els.btnFollowToggle) els.btnFollowToggle.textContent = next ? '進行方向' : '北固定';
    toast(next ? '追従を有効にしました' : '追従を停止しました');
  }

  // ---------- 設定 ----------
  function onOpenSettings(){
    log('onOpenSettings');
    if (!els.settingsCard) return;
    if (els.setProfile)   els.setProfile.value   = getSetting('profile') || 'driving-car';
    if (els.setTtsVolume) els.setTtsVolume.value = String(getSetting('ttsVolume') ?? 1);
    if (els.setTtsRate)   els.setTtsRate.value   = String(getSetting('ttsSpeed')  ?? 1);
    if (els.setTheme)     els.setTheme.value     = getSetting('theme') || 'auto';
    syncAvoidUIFromStore();
    forceOpen(els.settingsCard);
  }
  function onCloseSettings(){
    log('onCloseSettings');
    if (!els.settingsCard) return;
    if (els.setAvoidTolls) setSetting('avoidTolls', !!els.setAvoidTolls.checked);
    if (els.setProfile)    setSetting('profile', els.setProfile.value);
    if (els.setTtsVolume)  setSetting('ttsVolume', Number(els.setTtsVolume.value));
    if (els.setTtsRate)    setSetting('ttsSpeed',  Number(els.setTtsRate.value));
    if (els.setTheme)      setSetting('theme',     els.setTheme.value);
    syncAvoidUIFromStore();
    forceClose(els.settingsCard);
    toast('設定を保存しました');
  }

  // 直接バインド
  els.btnSearch        && els.btnSearch.addEventListener('click', (e)=>{ e.preventDefault(); onSearch(); });
  els.addr             && els.addr.addEventListener('keydown', (e)=>{ if (e.key==='Enter'){ e.preventDefault(); onSearch(); } });
  els.btnStart         && els.btnStart.addEventListener('click', (e)=>{ e.preventDefault(); onStart(); });
  els.btnStop          && els.btnStop.addEventListener('click',  (e)=>{ e.preventDefault(); onStop();  });
  els.btnFollowToggle  && els.btnFollowToggle.addEventListener('click', (e)=>{ e.preventDefault(); onFollowToggle(); });
  els.btnRecenter      && els.btnRecenter.addEventListener('click', ()=> toast('中心に戻しました'));
  els.btnOpenSettings  && els.btnOpenSettings.addEventListener('click', (e)=>{ e.preventDefault(); onOpenSettings(); });
  els.btnSettingsClose && els.btnSettingsClose.addEventListener('click',(e)=>{ e.preventDefault(); onCloseSettings(); });

  // ドキュメント委譲（保険）
  document.addEventListener('click', (e)=>{
    const q = (sel)=> e.target instanceof Element && e.target.closest(sel);
    if (q('#btnSearch'))         { e.preventDefault(); onSearch();  return; }
    if (q('#btnStart'))          { e.preventDefault(); onStart();   return; }
    if (q('#btnStop'))           { e.preventDefault(); onStop();    return; }
    if (q('#btnFollowToggle'))   { e.preventDefault(); onFollowToggle(); return; }
    if (q('#btnOpenSettings'))   { e.preventDefault(); onOpenSettings(); return; }
    if (q('#btnSettingsClose'))  { e.preventDefault(); onCloseSettings(); return; }
  });

  log('UI handlers ready');
}

import { StorageKeys, loadList, saveList, trimMax, upsertPlace, makePlaceId } from './settings.js';
import { HISTORY_MAX, FAVORITES_MAX, MERGE_DISTANCE_M } from '../config.js';
import { setGoalAndMaybeStart } from './nav.js';

const favListEl = document.getElementById('favorites-list');
const histListEl = document.getElementById('history-list');
const histClearBtn = document.getElementById('history-clear');

export function renderQuickLists() {
  renderList(StorageKeys.FAVORITES, favListEl, true);
  renderList(StorageKeys.HISTORY, histListEl, false);
}

function renderList(key, rootEl, isFav) {
  const items = loadList(key);
  rootEl.innerHTML = items.map((p, i) => chipHtml(p, i, isFav)).join('');
  rootEl.querySelectorAll('.act-start').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = Number(e.currentTarget.dataset.idx);
      const list = loadList(key);
      const p = list[idx];
      setGoalAndMaybeStart(p);
    });
  });
  rootEl.querySelectorAll('.act-fav').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = Number(e.currentTarget.dataset.idx);
      const list = loadList(key);
      const p = list[idx];
      toggleFavorite(p);
    });
  });
  rootEl.querySelectorAll('.act-del').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = Number(e.currentTarget.dataset.idx);
      const list = loadList(key);
      list.splice(idx, 1);
      saveList(key, list);
      renderQuickLists();
    });
  });
}

function chipHtml(p, idx, isFav) {
  const star = isFavorite(p) ? '★' : '☆';
  const name = escapeHtml(p.name || '目的地');
  return `
    <div class="svn-chip">
      <div>
        <div>${name}</div>
        <div class="meta">${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}</div>
      </div>
      <div class="actions">
        <button class="svn-iconbtn act-start" title="Start" data-idx="${idx}">▶</button>
        <button class="svn-iconbtn act-fav" title="Favorite" data-idx="${idx}">${star}</button>
        <button class="svn-iconbtn act-del" title="Delete" data-idx="${idx}">✕</button>
      </div>
    </div>
  `;
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

export function toggleFavorite(place) {
  const favs = loadList(StorageKeys.FAVORITES);
  const id = place.id || makePlaceId(place.lat, place.lng);
  const idx = favs.findIndex(p => (p.id || makePlaceId(p.lat, p.lng)) === id);
  if (idx >= 0) {
    favs.splice(idx, 1);
  } else {
    favs.unshift({ ...place, id, addedAt: Date.now() });
    trimMax(favs, FAVORITES_MAX);
  }
  saveList(StorageKeys.FAVORITES, favs);
  renderQuickLists();
}

export function isFavorite(place) {
  const favs = loadList(StorageKeys.FAVORITES);
  const id = place.id || makePlaceId(place.lat, place.lng);
  return favs.some(p => (p.id || makePlaceId(p.lat, p.lng)) === id);
}

export function addHistory(place) {
  const hist = loadList(StorageKeys.HISTORY);
  const now = Date.now();
  const withId = { ...place, id: place.id || makePlaceId(place.lat, place.lng), ts: now };
  const merged = upsertPlace(hist, withId, MERGE_DISTANCE_M);
  trimMax(merged, HISTORY_MAX);
  saveList(StorageKeys.HISTORY, merged);
  renderQuickLists();
}

if (histClearBtn) {
  histClearBtn.addEventListener('click', () => {
    saveList(StorageKeys.HISTORY, []);
    renderQuickLists();
  });
}

// initial paint on load
renderQuickLists();
