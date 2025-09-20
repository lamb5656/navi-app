// /browser-navi/js/ui.js
import { getSetting, setSetting, StorageKeys, loadList, saveList, trimMax, upsertPlace, makePlaceId } from './settings.js';
import { withBackoff } from './libs/net.js';
import { API_BASE, HISTORY_MAX, FAVORITES_MAX, MERGE_DISTANCE_M } from '../config.js';
import { setGoalAndMaybeStart } from './nav.js';

function log(...args){ try{ console.log('[SVN]', ...args); }catch{} }
function toast(msg, ms = 2000) {
  let t = document.getElementById('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; document.body.appendChild(t); }
  t.textContent = msg; t.style.opacity = '1'; t.style.display = 'block';
  setTimeout(() => (t.style.opacity = '0'), ms);
}

/** Force-open helper for cards (no CSS dependency) */
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
    appMenu: $('appMenu'),
    favoritesList: $('favorites-list'),
    historyList: $('history-list'),
    historyClear: $('history-clear'),
    btnFavCurrent: $('btnFavCurrent'),
  };

  if (els.btnFollowToggle) els.btnFollowToggle.style.display = 'none';
  if (els.btnStop) els.btnStop.disabled = true;

  const state = { goalLngLat: null }; // [lng, lat]

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

  // ---------- Geocode ----------
  async function geocode(text){
    const url = `${API_BASE}/geocode?text=${encodeURIComponent(text)}`;
    const res = await withBackoff(() => fetch(url, { headers: { Accept: 'application/json' } }), { retries: 1, base: 300 });
    if (!res.ok) throw new Error(`geocode http ${res.status}`);
    const data = await res.json();
    return normalizeGeocode(data);
  }

  function normalizeGeocode(data){
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.results)) return data.results;
    if (Array.isArray(data?.data)) return data.data;
    if (Array.isArray(data?.features)) {
      return data.features.map(f=>{
        const c = f?.geometry?.coordinates;
        return c && { lon: Number(c[0]), lat: Number(c[1]), display_name: f?.properties?.display_name || f?.properties?.name || '' };
      }).filter(Boolean);
    }
    if (Array.isArray(data?.items)) return data.items;
    if (Array.isArray(data?.places)) return data.places;
    if (Array.isArray(data?.nominatim)) return data.nominatim;
    return [];
  }

  // ---------- Quick Lists (Favorites & History) ----------
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
          <button class="svn-iconbtn act-start" title="Start" data-key="${isFav?'fav':'hist'}" data-idx="${idx}">▶</button>
          <button class="svn-iconbtn act-fav" title="Favorite" data-key="${isFav?'fav':'hist'}" data-idx="${idx}">${star}</button>
          <button class="svn-iconbtn act-del" title="Delete" data-key="${isFav?'fav':'hist'}" data-idx="${idx}">✕</button>
        </div>
      </div>
    `;
  }
  function escapeHtml(s){ return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

  export function renderQuickLists() {
    if (!els.favoritesList || !els.historyList) return;
    const favs = loadList(StorageKeys.FAVORITES);
    const hist = loadList(StorageKeys.HISTORY);
    els.favoritesList.innerHTML = favs.map((p,i)=>chipHtml(p,i,true)).join('') || '<div class="sr-empty">お気に入りはまだありません</div>';
    els.historyList.innerHTML   = hist.map((p,i)=>chipHtml(p,i,false)).join('') || '<div class="sr-empty">履歴はまだありません</div>';

    // bind actions
    (els.favoritesList.querySelectorAll('.act-start') ?? []).forEach(btn=>{
      btn.addEventListener('click', (e)=>{
        const idx = Number(btn.dataset.idx);
        const p = loadList(StorageKeys.FAVORITES)[idx];
        if (!p) return;
        setGoalAndMaybeStart(p);
      });
    });
    (els.historyList.querySelectorAll('.act-start') ?? []).forEach(btn=>{
      btn.addEventListener('click', (e)=>{
        const idx = Number(btn.dataset.idx);
        const p = loadList(StorageKeys.HISTORY)[idx];
        if (!p) return;
        setGoalAndMaybeStart(p);
      });
    });
    [...els.favoritesList.querySelectorAll('.act-fav'), ...els.historyList.querySelectorAll('.act-fav')].forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const k = btn.dataset.key; const idx = Number(btn.dataset.idx);
        const list = loadList(k==='fav' ? StorageKeys.FAVORITES : StorageKeys.HISTORY);
        const p = list[idx]; if (!p) return;
        toggleFavorite(p);
        renderQuickLists();
      });
    });
    [...els.favoritesList.querySelectorAll('.act-del'), ...els.historyList.querySelectorAll('.act-del')].forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const k = btn.dataset.key; const idx = Number(btn.dataset.idx);
        const key = k==='fav' ? StorageKeys.FAVORITES : StorageKeys.HISTORY;
        const list = loadList(key);
        list.splice(idx,1); saveList(key, list);
        renderQuickLists();
      });
    });
  }

  export function toggleFavorite(place) {
    const favs = loadList(StorageKeys.FAVORITES);
    const id = place.id || makePlaceId(place.lat, place.lng);
    const idx = favs.findIndex(p => (p.id || makePlaceId(p.lat, p.lng)) === id);
    if (idx >= 0) { favs.splice(idx, 1); }
    else {
      favs.unshift({ ...place, id, addedAt: Date.now() });
      trimMax(favs, FAVORITES_MAX);
    }
    saveList(StorageKeys.FAVORITES, favs);
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
  }

  // 初期描画
  renderQuickLists();
  if (els.historyClear){
    els.historyClear.addEventListener('click', ()=>{ saveList(StorageKeys.HISTORY, []); renderQuickLists(); toast('履歴をクリアしました'); });
  }

  // ---------- Search UI (single-tap to pick & close) ----------
  function openSearchCard(){ if (els.searchCard){ forceOpen(els.searchCard); } }
  function closeSearchCard(){
    if (!els.searchCard) return;
    forceClose(els.searchCard);
    if (document.activeElement === els.addr) els.addr.blur();
  }

  function renderSearchResults(items){
    if (!els.searchList) return;
    els.searchList.innerHTML = '';
    if (!Array.isArray(items) || !items.length){
      els.searchList.innerHTML = '<div class="sr-empty">候補がありません</div>';
      openSearchCard(); return;
    }

    for (const it of items){
      const name = it.display_name || it.name || it.label || '名称未設定';
      const lng  = Number(it.lon ?? it.lng ?? it.longitude ?? it.center?.[0]);
      const lat  = Number(it.lat ?? it.latitude ?? it.center?.[1]);
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;

      const btn  = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sr-item';
      btn.textContent = name;
      btn.dataset.name = name;
      btn.dataset.lng = String(lng);
      btn.dataset.lat = String(lat);

      let handled = false;
      const onPick = (e)=>{
        if (handled) return; handled = true;
        e.preventDefault(); e.stopPropagation();

        state.goalLngLat = [Number(btn.dataset.lng), Number(btn.dataset.lat)];
        if (els.addr) els.addr.value = btn.dataset.name || '';

        try {
          if (mapCtrl?.map) mapCtrl.map.easeTo({ center: state.goalLngLat, zoom: Math.max(mapCtrl.map.getZoom(), 14), duration: 400 });
        } catch {}

        // ★ ここで履歴に追加
        addHistory({ name: els.addr?.value || '目的地', lng: state.goalLngLat[0], lat: state.goalLngLat[1] });
        renderQuickLists();

        closeSearchCard();
        toast('目的地を設定しました');
      };

      btn.addEventListener('pointerdown', onPick, { passive: false });
      btn.addEventListener('click', onPick, { passive: false });
      els.searchList.appendChild(btn);
    }
    openSearchCard();
  }

  async function onSearch(){
    const q = (els.addr?.value || '').trim();
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

  // カード外タップで閉じる
  document.addEventListener('pointerdown', (e) => {
    const open = !!els.searchCard && els.searchCard.style.display !== 'none';
    if (!open) return;
    const insideCard = els.searchCard.contains(e.target);
    const isInput = (e.target === els.addr || (els.addr && els.addr.contains && els.addr.contains(e.target)));
    if (!insideCard && !isInput) closeSearchCard();
  }, true);

  // Escapeで閉じる
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSearchCard(); });

  // ---------- Start / Stop ----------
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

      // ★ 開始したら履歴にも確実に入れる
      addHistory({ name: els.addr?.value || '目的地', lng: state.goalLngLat[0], lat: state.goalLngLat[1] });
      renderQuickLists();

      if (els.btnFollowToggle){
        els.btnFollowToggle.style.display = '';
        if (els.btnStop && els.btnStop.parentNode && els.btnFollowToggle !== els.btnStop.previousSibling) {
          els.btnStop.parentNode.insertBefore(els.btnFollowToggle, els.btnStop);
        }
        navCtrl.setFollowEnabled(true);
        els.btnFollowToggle.textContent = '進行方向';
      }
      if (els.btnStop) els.btnStop.disabled = false;

      closeSearchCard();
      toast('ナビを開始しました');
    }catch(e){ console.error(e); toast('ナビの開始に失敗しました'); }
  }

  function onStop(){
    navCtrl.stop();
    if (els.btnFollowToggle) els.btnFollowToggle.style.display = 'none';
    if (els.btnStop) els.btnStop.disabled = true;
    toast('ナビを停止しました');
  }

  function onFollowToggle(){
    const next = !navCtrl.isFollowEnabled();
    navCtrl.setFollowEnabled(next);
    if (els.btnFollowToggle) els.btnFollowToggle.textContent = next ? '進行方向' : '北固定';
    toast(next ? '追従を有効にしました' : '追従を停止しました');
  }

  // ---------- Favorite current goal ----------
  async function onFavCurrent(){
    try{
      // 目的地が未設定でも、入力欄に文字があれば軽くジオコーディングして補完
      if (!state.goalLngLat){
        const q = (els.addr?.value || '').trim();
        if (q){
          const items = await geocode(q);
          const it = items[0];
          if (it){
            state.goalLngLat = [Number(it.lon ?? it.lng), Number(it.lat)];
            if (els.addr) els.addr.value = it.display_name || els.addr.value;
          }
        }
      }
      if (!state.goalLngLat){ toast('先に目的地を選んでにゃ'); return; }

      const place = {
        name: (els.addr?.value || '目的地'),
        lng: Number(state.goalLngLat[0]),
        lat: Number(state.goalLngLat[1]),
      };
      toggleFavorite(place);
      renderQuickLists();

      // メニューを開いておくと変化が見える
      if (els.appMenu) els.appMenu.open = true;

      toast('お気に入りに登録したにゃ');
    }catch(e){ console.error(e); toast('お気に入り登録に失敗しました'); }
  }

  // ---------- Settings ----------
  function onOpenSettings(){
    if (!els.settingsCard) return;
    fillSettingsFromStore();
    forceOpen(els.settingsCard);
  }
  function onCloseSettings(){
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

  // ---------- Bindings ----------
  els.btnSearch        && els.btnSearch.addEventListener('click', (e)=>{ e.preventDefault(); onSearch(); });
  els.addr             && els.addr.addEventListener('keydown', (e)=>{ if (e.key==='Enter'){ e.preventDefault(); onSearch(); } });
  els.btnStart         && els.btnStart.addEventListener('click', (e)=>{ e.preventDefault(); onStart(); });
  els.btnStop          && els.btnStop.addEventListener('click',  (e)=>{ e.preventDefault(); onStop();  });
  els.btnFollowToggle  && els.btnFollowToggle.addEventListener('click', (e)=>{ e.preventDefault(); onFollowToggle(); });
  els.btnRecenter      && els.btnRecenter.addEventListener('click', ()=> toast('中心に戻しました'));

  els.btnFavCurrent    && els.btnFavCurrent.addEventListener('click', (e)=>{ e.preventDefault(); onFavCurrent(); });
  els.btnOpenSettings  && els.btnOpenSettings.addEventListener('click', (e)=>{ e.preventDefault(); onOpenSettings(); });
  els.btnSettingsClose && els.btnSettingsClose.addEventListener('click',(e)=>{ e.preventDefault(); onCloseSettings(); });

  // Delegation fallback
  document.addEventListener('click', (e)=>{
    const q = (sel)=> e.target instanceof Element && e.target.closest(sel);
    if (q('#btnSearch'))         { e.preventDefault(); onSearch();  return; }
    if (q('#btnStart'))          { e.preventDefault(); onStart();   return; }
    if (q('#btnStop'))           { e.preventDefault(); onStop();    return; }
    if (q('#btnFollowToggle'))   { e.preventDefault(); onFollowToggle(); return; }
    if (q('#btnFavCurrent'))     { e.preventDefault(); onFavCurrent(); return; }
    if (q('#btnOpenSettings'))   { e.preventDefault(); onOpenSettings(); return; }
    if (q('#btnSettingsClose'))  { e.preventDefault(); onCloseSettings(); return; }
  });

  log('UI handlers ready');
}

/* ===== Helpers exported for other modules ===== */
export function isFavorite(place) {
  const favs = loadList(StorageKeys.FAVORITES);
  const id = place.id || makePlaceId(place.lat, place.lng);
  return favs.some(p => (p.id || makePlaceId(p.lat, p.lng)) === id);
}

export function toggleFavorite(place) {
  const favs = loadList(StorageKeys.FAVORITES);
  const id = place.id || makePlaceId(place.lat, place.lng);
  const idx = favs.findIndex(p => (p.id || makePlaceId(p.lat, p.lng)) === id);
  if (idx >= 0) { favs.splice(idx, 1); }
  else { favs.unshift({ ...place, id, addedAt: Date.now() }); trimMax(favs, FAVORITES_MAX); }
  saveList(StorageKeys.FAVORITES, favs);
}

export function addHistory(place) {
  const hist = loadList(StorageKeys.HISTORY);
  const now = Date.now();
  const withId = { ...place, id: place.id || makePlaceId(place.lat, place.lng), ts: now };
  const merged = upsertPlace(hist, withId, MERGE_DISTANCE_M);
  trimMax(merged, HISTORY_MAX);
  saveList(StorageKeys.HISTORY, merged);
}

/* ===== Initial quick-lists paint on module load as fallback ===== */
(function initialPaint(){
  const favListEl = document.getElementById('favorites-list');
  const histListEl = document.getElementById('history-list');
  if (!favListEl || !histListEl) return;
  const favs = loadList(StorageKeys.FAVORITES);
  const hist = loadList(StorageKeys.HISTORY);
  favListEl.innerHTML = favs.map((p,i)=>`<div class="svn-chip"><div><div>${p.name||'目的地'}</div><div class="meta">${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}</div></div></div>`).join('');
  histListEl.innerHTML = hist.map((p,i)=>`<div class="svn-chip"><div><div>${p.name||'目的地'}</div><div class="meta">${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}</div></div></div>`).join('');
})();
