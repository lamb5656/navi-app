import { toast } from './dom.js';
import { API_BASE } from '../../config.js';
import { withBackoff } from '../libs/net.js';

export function setupStartStop(els, navCtrl, hooks){
  const state = { goalLngLat: null, _offProgress: null };

  
  const manEl = document.getElementById('maneuver');
  if (manEl) manEl.style.display = 'none';

  async function geocode(text){
    const url = `${API_BASE}/geocode?text=${encodeURIComponent(text)}`;
    const res = await withBackoff(() => fetch(url, { headers: { Accept: 'application/json' } }), { retries: 1, base: 300 });
    if (!res.ok) throw new Error(`geocode http ${res.status}`);
    const data = await res.json();
    const featureToLL = (f)=> { const c = f?.geometry?.coordinates; return c && { lon: Number(c[0]), lat: Number(c[1]) }; };
    const first = Array.isArray(data) ? data[0]
      : Array.isArray(data?.results) ? data.results[0]
      : Array.isArray(data?.data) ? data.data[0]
      : Array.isArray(data?.features) ? featureToLL(data.features[0])
      : Array.isArray(data?.items) ? data.items[0]
      : Array.isArray(data?.places) ? data.places[0]
      : Array.isArray(data?.nominatim) ? data.nominatim[0]
      : null;
    if (!first) return null;
    const lng = Number(first.lon ?? first.lng ?? first.longitude ?? first.center?.[0]);
    const lat = Number(first.lat ?? first.latitude ?? first.center?.[1]);
    return [lng, lat];
  }

  async function ensureGoal(searchApi){
    if (searchApi?.state?.goalLngLat) {
      state.goalLngLat = searchApi.state.goalLngLat;
      return state.goalLngLat;
    }
    if (state.goalLngLat) return state.goalLngLat;

    const q = (els.addr?.value || '').trim();
    if (!q) return null;
    const ll = await geocode(q);
    if (ll) state.goalLngLat = ll;
    return state.goalLngLat;
  }

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

  async function onStart(searchApi){
    try{
      const goal = await ensureGoal(searchApi);
      if (!goal){ toast('先に目的地を検索して選択してください'); return; }

      const here = await resolveHere();
      hooks?.onGoalFixed && hooks.onGoalFixed({ name: (els.addr?.value || '目的地'), lng: Number(goal[0]), lat: Number(goal[1]) });

      
      const off = navCtrl.onProgress?.((snap)=> hooks?.onTick && hooks.onTick(snap));

      await navCtrl.start([here, goal]);

      if (manEl) manEl.style.display = '';

      if (els.btnFollowToggle){
        els.btnFollowToggle.style.display = '';
        navCtrl.setFollowEnabled?.(true);
        els.btnFollowToggle.textContent = '進行方向';
      }
      if (els.btnStop) els.btnStop.disabled = false;

      hooks?.onStarted && hooks.onStarted({ name: (els.addr?.value || '目的地'), lng: Number(goal[0]), lat: Number(goal[1]) });
      hooks?.onTick && hooks.onTick({ status: '案内中' });

      state._offProgress = off;
      toast('ナビを開始しました');
    }catch(e){ console.error(e); toast('ナビの開始に失敗しました'); }
  }

  function onStop(){
    try { navCtrl.stop?.(); } catch {}
    if (state._offProgress) { try { state._offProgress(); } catch {} state._offProgress = null; }

    state.goalLngLat = null;
    try { navCtrl.setFollowEnabled?.(false); } catch {}

    if (manEl) manEl.style.display = 'none';
    if (els.btnFollowToggle) els.btnFollowToggle.style.display = 'none';
    if (els.btnStop) els.btnStop.disabled = true;
    hooks?.onTick && hooks.onTick({ distanceLeftMeters: NaN, eta: null, status: '待機中' });
    toast('ナビを停止しました');
  }

  function onFollowToggle(){
    const next = !navCtrl.isFollowEnabled?.();
    navCtrl.setFollowEnabled?.(next);
    if (els.btnFollowToggle) els.btnFollowToggle.textContent = next ? '進行方向' : '北固定';
    toast(next ? '追従を有効にしました' : '追従を停止しました');
  }

  // 現在地へ寄せて追従ON + 強制ズーム（未指定は 17）
  async function centerLikeStart(mapCtrl, opt = {}) {
    const here = await resolveHere();
    const z = Number.isFinite(opt.zoom) ? Number(opt.zoom) : 17;
  
    const m = mapCtrl?.map || mapCtrl?._map || window.__map || null;
    if (m?.easeTo) {
      m.easeTo({ center: [here[0], here[1]], zoom: z, duration: 0 });
    } else if (typeof mapCtrl?.setCenter === 'function') {
      mapCtrl.setCenter(here[0], here[1]);
      if (m?.setZoom) m.setZoom(z);
    } else if (m?.setCenter) {
      m.setCenter([here[0], here[1]]);
      if (m?.setZoom) m.setZoom(z);
    } else if (typeof mapCtrl?.flyTo === 'function') {
      mapCtrl.flyTo([here[0], here[1]]);
      if (m?.setZoom) m.setZoom(z);
    }
  
    try { navCtrl.setFollowEnabled?.(true); } catch {}
  }

  return { onStart, onStop, onFollowToggle, centerLikeStart, state };
}
