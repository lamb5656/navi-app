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

  async function geocode(text){
    const url = `${API_BASE}/geocode?text=${encodeURIComponent(text)}`;
    const res = await withBackoff(() => fetch(url, { headers: { Accept: 'application/json' } }), { retries: 2, base: 400 });
    if (!res.ok) throw new Error('geocode failed');
    return res.json();
  }
  function openSearchCard(){ if (els.searchCard) els.searchCard.style.display = ''; }
  function closeSearchCard(){ if (els.searchCard) els.searchCard.style.display = 'none'; }
  function renderSearchResults(items){
    if (!els.searchList) return;
    els.searchList.innerHTML = '';
    if (!Array.isArray(items) || !items.length){
      els.searchList.innerHTML = '<div class="sr-empty">候補がありません</div>';
      openSearchCard(); return;
    }
    items.forEach(it=>{
      const name = it.display_name || it.name || '名称未設定';
      const lng  = Number(it.lon ?? it.lng);
      const lat  = Number(it.lat);
      const btn  = document.createElement('button');
      btn.type = 'button'; btn.className = 'sr-item'; btn.textContent = name;
      btn.addEventListener('click', ()=>{
        state.goalLngLat = [lng, lat];
        if (els.addr) els.addr.value = name;
        try { if (mapCtrl?.map) mapCtrl.map.easeTo({ center: state.goalLngLat, zoom: Math.max(mapCtrl.map.getZoom(), 14), duration: 400 }); } catch{}
        closeSearchCard(); toast('目的地を設定しました');
      });
      els.searchList.appendChild(btn);
    });
    openSearchCard();
  }
  async function onSearch(){
    const q = (els.addr?.value || '').trim();
    log('onSearch', q);
    if (!q){ toast('検索ワードを入力してください'); return; }
    if (els.searchList) els.searchList.innerHTML = '<div class="sr-loading">検索中…</div>';
    try {
      const data = await geocode(q);
      renderSearchResults(data?.results || data || []);
    } catch (err) {
      console.error(err);
      if (els.searchList) els.searchList.innerHTML = '<div class="sr-error">検索に失敗しました</div>';
      openSearchCard();
    }
  }

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
          const data = await geocode(q);
          const item = (data?.results || data || [])[0];
          if (item) state.goalLngLat = [Number(item.lon ?? item.lng), Number(item.lat)];
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

  function onOpenSettings(){
    log('onOpenSettings');
    if (!els.settingsCard) return;
    if (els.setProfile)   els.setProfile.value   = getSetting('profile') || 'driving-car';
    if (els.setTtsVolume) els.setTtsVolume.value = String(getSetting('ttsVolume') ?? 1);
    if (els.setTtsRate)   els.setTtsRate.value   = String(getSetting('ttsSpeed')  ?? 1);
    if (els.setTheme)     els.setTheme.value     = getSetting('theme') || 'auto';
    syncAvoidUIFromStore();
    els.settingsCard.style.display = '';
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
    els.settingsCard.style.display = 'none';
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
