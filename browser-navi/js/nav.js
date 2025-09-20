// Routing, guidance, TTS, reroute, progress card. Emits progress events for HUD.

import { withBackoff } from './libs/net.js';
import { getSetting } from './settings.js';
import { drawRoute, clearRoute, followUser } from './map.js';
import { API_BASE } from '../config.js';

function toast(msg, ms = 3000) {
  try { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
        document.body.appendChild(t); setTimeout(() => t.remove(), ms); } catch {}
}

// ---------- helpers ----------
const toLL = ([lng, lat]) => ({ lng: Number(lng), lat: Number(lat) });
function haversine(lat1, lon1, lat2, lon2) {
  const R=6371000, toRad=(d)=>d*Math.PI/180;
  const dLat=toRad(lat2-lat1), dLon=toRad(lon2-lon1);
  const a=Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  return 2*R*Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}
// Encoded polyline（precision: 5 or 6）→ [[lng,lat],...]
function decodePolyline(str, precision = 6) {
  if (!str || typeof str !== 'string') return [];
  const factor = Math.pow(10, precision);
  let index = 0, lat = 0, lng = 0, coords = [];
  while (index < str.length) {
    let b, shift = 0, result = 0;
    do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    const dlat = ((result & 1) ? ~(result >> 1) : (result >> 1)); lat += dlat;
    shift = 0; result = 0;
    do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    const dlng = ((result & 1) ? ~(result >> 1) : (result >> 1)); lng += dlng;
    coords.push([lng / factor, lat / factor]);
  }
  return coords;
}
// icon picks（簡略）
const ICONS = { straight:'i-straight','turn-left':'i-turn-left','turn-right':'i-turn-right','uturn':'i-uturn','roundabout':'i-roundabout','merge':'i-merge','fork-left':'i-fork-left','fork-right':'i-fork-right','ramp-left':'i-ramp-left','ramp-right':'i-ramp-right','turn-slight-left':'i-slight-left','turn-slight-right':'i-slight-right','turn-sharp-left':'i-sharp-left','turn-sharp-right':'i-sharp-right',continue:'i-straight' };
const pickIcon = (step) => {
  const t=(step?.maneuver?.type||step?.type||'').toLowerCase();
  const m=(step?.maneuver?.modifier||step?.modifier||'').toLowerCase();
  if (t==='turn') return ICONS[`turn-${m}`]||ICONS.straight;
  if (t==='roundabout'||t==='rotary') return ICONS.roundabout;
  if (t==='merge') return ICONS.merge;
  if (t==='fork') return ICONS[`fork-${m}`]||ICONS.straight;
  if (t==='ramp') return ICONS[`ramp-${m}`]||ICONS.straight;
  if (t==='continue') return ICONS.continue;
  if (t==='uturn') return ICONS.uturn;
  return ICONS.straight;
};

// ---------- extractors（“しぶとい”版） ----------
// どの形式でも総距離/時間を作る：ORS → OSRM → legs/steps 合算 → geometry(GeoJSON/MultiLine/polyline)
function extractTotals(data) {
  const r0 = data?.routes?.[0];
  // 1) ORS/OSRM: routes[] がある
  if (r0) {
    // ORS summary
    if (r0.summary && Number.isFinite(r0.summary.distance) && Number.isFinite(r0.summary.duration)) {
      return { distanceM: Number(r0.summary.distance), durationS: Number(r0.summary.duration) };
    }
    // ORS segments[0]
    const seg0 = r0.segments?.[0];
    if (seg0 && Number.isFinite(seg0.distance) && Number.isFinite(seg0.duration)) {
      return { distanceM: Number(seg0.distance), durationS: Number(seg0.duration) };
    }
    // OSRM: route-level
    if (Number.isFinite(r0.distance) && Number.isFinite(r0.duration)) {
      return { distanceM: Number(r0.distance), durationS: Number(r0.duration) };
    }
    // legs 合算
    if (Array.isArray(r0.legs) && r0.legs.length) {
      let d=0,s=0; for (const leg of r0.legs){ if (Number.isFinite(leg.distance)) d+=leg.distance; if (Number.isFinite(leg.duration)) s+=leg.duration; }
      if (d>0 || s>0) return { distanceM: d || NaN, durationS: s || NaN };
    }
    // steps 合算
    const steps =
      (Array.isArray(r0.segments?.[0]?.steps) && r0.segments[0].steps) ||
      (Array.isArray(r0.legs?.flatMap?.(l => l.steps || [])) && r0.legs.flatMap(l => l.steps || [])) || [];
    if (steps.length) {
      let d=0,s=0; for (const st of steps){ if (Number.isFinite(st.distance)) d+=st.distance; if (Number.isFinite(st.duration)) s+=st.duration; }
      if (d>0 || s>0) return { distanceM: d || NaN, durationS: s || NaN };
    }
    // geometry（LineString or polyline）
    const line = getLineCoordsFromRoute(r0);
    if (line.length > 1) {
      const sum = accumulateLine(line);
      const durationS = estimateDurationByProfile(sum);
      return { distanceM: sum, durationS };
    }
  }

  // 2) routes[] が無い（GeoJSONだけ渡される）ケース
  const line2 = getLineCoordsFromGeoJSON(data);
  if (line2.length > 1) {
    const sum = accumulateLine(line2);
    const durationS = estimateDurationByProfile(sum);
    return { distanceM: sum, durationS };
  }

  return { distanceM: NaN, durationS: NaN };
}

// steps: ORS or OSRM
function extractSteps(data) {
  const r0 = data?.routes?.[0];
  if (r0?.segments?.[0]?.steps?.length) return r0.segments[0].steps;
  if (r0?.legs?.[0]?.steps?.length)     return r0.legs[0].steps;
  return [];
}

// step center（ORS/OSRM）
function stepCenter(step){
  if (!step) return null;
  if (Array.isArray(step.way_points_center)) { const o=toLL(step.way_points_center); return {lat:o.lat,lng:o.lng}; }
  if (Array.isArray(step.way_points))        { const o=toLL(step.way_points[0]);   return {lat:o.lat,lng:o.lng}; }
  if (step.maneuver && Array.isArray(step.maneuver.location)){ const o=toLL(step.maneuver.location); return {lat:o.lat,lng:o.lng}; }
  return null;
}

// ルート座標列の取得（Route または GeoJSON）
function getLineCoordsFromRoute(r0){
  // GeoJSON LineString
  if (r0?.geometry?.type === 'LineString' && Array.isArray(r0.geometry.coordinates)) return r0.geometry.coordinates;
  // polyline string
  if (typeof r0?.geometry === 'string') {
    let line = decodePolyline(r0.geometry, 6); if (!line.length) line = decodePolyline(r0.geometry, 5);
    return line;
  }
  // （稀）MultiLineString
  if (r0?.geometry?.type === 'MultiLineString' && Array.isArray(r0.geometry.coordinates)) {
    return r0.geometry.coordinates.flat();
  }
  return [];
}
function getLineCoordsFromGeoJSON(data){
  // { geojson: Feature/FeatureCollection } or pure Feature/FC
  const g = data?.geojson || data;
  if (!g) return [];
  if (g.type === 'FeatureCollection') {
    const f = g.features?.[0]; if (f?.geometry?.type === 'LineString') return f.geometry.coordinates || [];
    if (f?.geometry?.type === 'MultiLineString') return (f.geometry.coordinates || []).flat();
  }
  if (g.type === 'Feature') {
    const geom = g.geometry;
    if (geom?.type === 'LineString') return geom.coordinates || [];
    if (geom?.type === 'MultiLineString') return (geom.coordinates || []).flat();
  }
  return [];
}
function accumulateLine(coords){
  let sum=0; for (let i=1;i<coords.length;i++){ const [lng1,lat1]=coords[i-1]; const [lng2,lat2]=coords[i];
    const R=6371000, toRad=(d)=>d*Math.PI/180, dLat=toRad(lat2-lat1), dLng=toRad(lng2-lng1);
    const a=Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLng/2)**2;
    sum += 2*R*Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  }
  return sum;
}
function estimateDurationByProfile(distanceM){
  let kmh = 40; const profile = (typeof getSetting === 'function' && (getSetting('profile')||'driving-car')) || 'driving-car';
  if (profile === 'foot-walking') kmh = 5; else if (profile === 'cycling-regular') kmh = 18;
  return distanceM / (kmh * 1000 / 3600);
}

// ---------- Controller ----------
export class NavigationController {
  constructor(mapController){
    this.mapCtrl = mapController || null;
    this.currentRoute = null;
    this.watchId = null;
    this.follow = false;

    // HUD state
    this.totalM = NaN;
    this.totalS = NaN;
    this.remainM = NaN;

    // ルートの生座標（LineStringが無い/stepsが無い時用）
    this._lineCoords = [];

    // subscribers
    this._subs = new Set();
  }

  onProgress(fn){ if (typeof fn==='function'){ this._subs.add(fn); return ()=>this._subs.delete(fn); } }
  _emit(snap){ this._subs.forEach(fn=>{ try{ fn(snap); }catch{} }); }

  setHereInitial(lnglat){ if (lnglat) followUser(lnglat,{center:false}); }
  setFollowEnabled(on){ this.follow = !!on; }
  isFollowEnabled(){ return this.follow; }

  // backends
  async _fetchORS(payload){
    const r = await fetch(`${API_BASE}/route`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
    if (!r.ok) throw new Error('ORS route failed'); return r.json();
  }
  async _fetchOSRM(payload){
    const c = payload.coordinates||[]; const start=c[0], goal=c[c.length-1];
    const r = await fetch(`${API_BASE}/route?start=${start?.join(',')}&goal=${goal?.join(',')}`);
    if (!r.ok) throw new Error('OSRM route failed'); return r.json();
  }
  async fetchRouteWithRetry(payload){
    try { return await withBackoff(()=>this._fetchORS(payload), {retries:2, base:400}); }
    catch { toast('ORS error. Switching to OSRM…'); return await withBackoff(()=>this._fetchOSRM(payload), {retries:2, base:400}); }
  }

  async start(coords){
    try{
      clearRoute();
      const payload = {
        coordinates: coords,
        avoidTolls: !!getSetting('avoidTolls'),
        profile: getSetting('profile') || 'driving-car'
      };
      const data = await this.fetchRouteWithRetry(payload);
      this.currentRoute = data;
      drawRoute(data);

      // 総距離/時間の算出（どんな形でも埋める）
      const { distanceM, durationS } = extractTotals(data);
      this.totalM = distanceM; this.totalS = durationS;
      this.remainM = Number.isFinite(distanceM) ? distanceM : NaN;

      // ライン座標も保持（stepsが無い場合の残距離計算に使用）
      this._lineCoords = getLineCoordsFromRoute(data?.routes?.[0]) || [];
      if (!this._lineCoords.length) this._lineCoords = getLineCoordsFromGeoJSON(data);

      // 初回スナップを即送出
      this._emit(this._mkSnap('案内中'));

      // GPS開始
      if (this.watchId) navigator.geolocation.clearWatch(this.watchId);
      this.watchId = navigator.geolocation.watchPosition(
        (pos)=>this._onPosition(pos),
        (err)=>console.error(err),
        { enableHighAccuracy:true, maximumAge:0, timeout:10000 }
      );
      this.setFollowEnabled(true);
    } catch(e){ console.error(e); toast('Failed to start navigation.'); }
  }

  stop(){
    if (this.watchId){ navigator.geolocation.clearWatch(this.watchId); this.watchId=null; }
    this.currentRoute=null; this.totalM=NaN; this.totalS=NaN; this.remainM=NaN; this._lineCoords=[];
    this.setFollowEnabled(false); clearRoute();
    this._emit({ distanceLeftMeters: NaN, eta: null, status: '待機中' });
  }

  getProgress(){ return this._mkSnap('案内中'); }

  _mkSnap(status){
    let eta=null;
    if (Number.isFinite(this.totalM) && this.totalM>0 && Number.isFinite(this.totalS) && Number.isFinite(this.remainM)){
      const ratio = Math.min(Math.max(this.remainM/this.totalM, 0), 1);
      eta = Date.now() + this.totalS * ratio * 1000;
    }
    return { distanceLeftMeters: this.remainM, eta, status };
  }

  _onPosition(pos){
    const { latitude, longitude } = pos.coords;
    const lnglat = [longitude, latitude];
    followUser(lnglat, { center: this.follow });
    if (!this.currentRoute) return;
    this._updateRemainAndUI(lnglat);
  }

  _updateRemainAndUI([lng,lat]){
    const steps = extractSteps(this.currentRoute);

    if (steps.length) {
      // --- steps あり：従来のステップ距離で残距離を更新 ---
      // 次ステップを距離最小で選択
      let min=Infinity, idx=0;
      for (let i=0;i<steps.length;i++){
        const cen = stepCenter(steps[i]); if (!cen) continue;
        const d = haversine(lat, lng, cen.lat, cen.lng);
        if (d<min){ min=d; idx=i; }
      }
      // idx以降の距離を積算 + 現在位置→そのステップ中心まで
      const remainAfter = steps.slice(Math.max(idx,0)).reduce((a,s)=>a+Number(s.distance||0),0);
      const cen = stepCenter(steps[idx]); const toCen = cen ? haversine(lat, lng, cen.lat, cen.lng) : 0;
      this.remainM = Math.max(0, toCen + remainAfter);
    } else if (this._lineCoords.length > 1) {
      // --- steps 無し：ライン追従で残距離を計算（最寄り頂点/辺から終点まで） ---
      const line = this._lineCoords;
      // 最寄り頂点インデックス
      let min=Infinity, nearest=0;
      for (let i=0;i<line.length;i++){
        const [LNG, LAT] = line[i];
        const d = haversine(lat, lng, LAT, LNG);
        if (d<min){ min=d; nearest=i; }
      }
      // 現在地→次頂点まで + その先の累積
      let remain = 0;
      if (nearest < line.length-1) {
        const [nLng, nLat] = line[nearest];
        remain += haversine(lat, lng, nLat, nLng);
        for (let i=nearest; i<line.length-1; i++){
          const [lng1,lat1] = line[i], [lng2,lat2] = line[i+1];
          remain += haversine(lat1, lng1, lat2, lng2);
        }
      }
      this.remainM = Math.max(0, remain || 0);
      // 総距離が未設定ならライン総距離で埋める
      if (!Number.isFinite(this.totalM) || this.totalM<=0) {
        this.totalM = accumulateLine(line);
        if (!Number.isFinite(this.totalS) || this.totalS<=0) this.totalS = estimateDurationByProfile(this.totalM);
      }
    } else {
      // どちらも無い：総距離だけで ETA 更新継続
      // remainM は初期総距離のまま（徐々に減らしたいときは上のライン追従が必要）
    }

    this._emit(this._mkSnap('案内中'));

    // 左の進行カード（任意）
    const card = document.getElementById('progress-card');
    if (card && steps.length){
      const idx = 0; // 表示用に簡略（最寄り表示にしたければ上の idx を共有）
      const step = steps[idx];
      const icon = pickIcon(step);
      card.innerHTML = `
        <div class="progress-row">
          <span class="nav-icon ${icon}"></span>
          <span class="nav-text">${step.instruction || step.name || ''}</span>
        </div>
        <div class="nav-sub">Remain ${Math.round(step.distance || 0)} m</div>
      `;
    }
  }
}

export function createNavigation(mapCtrl) { return new NavigationController(mapCtrl); }

// Compatibility helpers（そのまま）
import { addHistory, toggleFavorite, isFavorite } from './ui.js';
export function setGoalAndMaybeStart(place) {
  const goalNameEl = document.getElementById('goal-text');
  if (goalNameEl && place.name) goalNameEl.value = place.name;
  window.__lastSelectedGoal = place;
}
export function onArrivedAtGoal(goal) { try { addHistory(goal); } catch {} }
export function wireFavoriteButton(buttonEl, currentGoalGetter) {
  if (!buttonEl) return;
  const sync = () => { const g = currentGoalGetter(); buttonEl.textContent = g && isFavorite(g) ? '★' : '☆'; };
  buttonEl.addEventListener('click', () => { const g = currentGoalGetter(); if (g) { toggleFavorite(g); sync(); } });
  sync();
}
