import { toast } from './dom.js';
import { API_BASE } from '../../config.js';
import { withBackoff } from '../libs/net.js';

export function setupStartStop(els, navCtrl, hooks){
  const state = { goalLngLat: null };

  async function geocode(text){
    const url = `${API_BASE}/geocode?text=${encodeURIComponent(text)}`;
    const res = await withBackoff(() => fetch(url, { headers: { Accept: 'application/json' } }), { retries: 1, base: 300 });
    if (!res.ok) throw new Error(`geocode http ${res.status}`);
    const data = await res.json();
    const it = Array.isArray(data) ? data[0]
      : Array.isArray(data?.results) ? data.results[0]
      : Array.isArray(data?.data) ? data.data[0]
      : Array.isArray(data?.features) ? pickFromFeature(data.features[0])
      : Array.isArray(data?.items) ? data.items[0]
      : Array.isArray(data?.places) ? data.places[0]
      : Array.isArray(data?.nominatim) ? data.nominatim[0]
      : null;
    if (!it) return null;
    const lng = Number(it.lon ?? it.lng ?? it.longitude ?? it.center?.[0]);
    const lat = Number(it.lat ?? it.latitude ?? it.center?.[1]);
    return [lng, lat];
  }
  const pickFromFeature = (f)=> {
    const c = f?.geometry?.coordinates;
    return c && { lon: Number(c[0]), lat: Number(c[1]) };
  };

  async function ensureGoal(searchApi){
    if (state.goalLngLat) return state.goalLngLat;
    if (searchApi?.state?.goalLngLat) return (state.goalLngLat = searchApi.state.goalLngLat);
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
      await navCtrl.start([here, goal]);

      if (els.btnFollowToggle){
        els.btnFollowToggle.style.display = '';
        navCtrl.setFollowEnabled(true);
        els.btnFollowToggle.textContent = '進行方向';
      }
      if (els.btnStop) els.btnStop.disabled = false;

      hooks?.onStarted && hooks.onStarted({ name: (els.addr?.value || '目的地'), lng: Number(goal[0]), lat: Number(goal[1]) });
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

  return { onStart, onStop, onFollowToggle, state };
}
