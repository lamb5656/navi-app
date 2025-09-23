import { withBackoff } from './libs/net.js';
import { getSetting } from './settings.js';
import { drawRoute, clearRoute, followUser } from './map.js';
import { API_BASE } from '../config.js';

function toast(msg, ms = 3000) {
  try { const t = document.createElement('div'); t.className='toast'; t.textContent=msg;
        document.body.appendChild(t); setTimeout(() => t.remove(), ms); } catch {}
}

// ==== TTS helper（音声案内） ====
const TTS = (() => {
  let ready = false;
  let jaVoice = null;

  function pickJaVoice() {
    try {
      const voices = window.speechSynthesis?.getVoices?.() || [];
      if (!voices.length) return null;
      // 日本語優先（ja-JP / ja）
      return voices.find(v => /^ja(-|_|$)/i.test(v.lang)) || voices[0] || null;
    } catch { return null; }
  }

  function refreshVoice() {
    jaVoice = pickJaVoice();
    ready = !!jaVoice || (window.speechSynthesis && window.speechSynthesis.getVoices().length > 0);
  }

  if ('speechSynthesis' in window) {
    refreshVoice();
    try {
      window.speechSynthesis.onvoiceschanged = () => refreshVoice();
    } catch {}
  }

  function getNum(v, def) { const n = Number(v); return Number.isFinite(n) ? n : def; }
  function getSettingSafe(key, def) {
    try { return JSON.parse(localStorage.getItem('navi.settings') || '{}')[key] ?? def; } catch { return def; }
  }

  function speak(text) {
    if (!('speechSynthesis' in window)) return;
    if (!text || typeof text !== 'string') return;

    const vol = getNum(getSettingSafe('ttsVolume', 1), 1); // 0..1
    const rate = getNum(getSettingSafe('ttsSpeed', 1), 1); // 0.1..10
    const u = new SpeechSynthesisUtterance(text);
    if (jaVoice) u.voice = jaVoice;
    u.lang = (jaVoice?.lang || 'ja-JP');
    u.volume = Math.max(0, Math.min(1, vol));
    u.rate = Math.max(0.1, Math.min(2, rate)); // 速すぎ防止
    try { window.speechSynthesis.speak(u); } catch {}
  }

  const memory = new Map();
  function keyOf(step) {
    return (step?.id ?? step?.way_points?.join('-') ?? '') + '::' + (step?.instruction || step?.name || '');
  }

  function maybeAnnounce(step) {
    const dist = Number(step?.distance ?? step?.remain ?? step?.remainMeters ?? NaN);
    if (!Number.isFinite(dist)) return;

    const key = keyOf(step);
    const flags = memory.get(key) || { p300: false, near: false };

    if (!flags.near && dist <= 90) {
      const line = (step?.instruction || step?.name || '').trim();
      if (line) speak(line);
      flags.near = true;
    }

    memory.set(key, flags);
  }

  function unlock() {
    try { window.speechSynthesis.cancel(); } catch {}
  }

  return { speak, maybeAnnounce, unlock };
})();

const toLL = ([lng, lat]) => ({ lng: Number(lng), lat: Number(lat) });
function haversine(lat1, lon1, lat2, lon2) {
  const R=6371000, toRad=(d)=>d*Math.PI/180;
  const dLat=toRad(lat2-lat1), dLon=toRad(lon2-lon1);
  const a=Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  return 2*R*Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

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

function getLineCoordsFromRoute(r0){
  if (r0?.geometry?.type === 'LineString' && Array.isArray(r0.geometry.coordinates)) return r0.geometry.coordinates;
  if (typeof r0?.geometry === 'string') {
    let line = decodePolyline(r0.geometry, 6); if (!line.length) line = decodePolyline(r0.geometry, 5);
    return line;
  }
  if (r0?.geometry?.type === 'MultiLineString' && Array.isArray(r0.geometry.coordinates)) return r0.geometry.coordinates.flat();
  return [];
}
function getLineCoordsFromGeoJSON(data){
  const g = data?.geojson || data;
  if (!g) return [];
  if (g.type === 'FeatureCollection') {
    const f = g.features?.[0];
    if (f?.geometry?.type === 'LineString') return f.geometry.coordinates || [];
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
  } return sum;
}
function estimateDurationByProfile(distanceM){
  let kmh = 40; const profile = (typeof getSetting==='function'&&(getSetting('profile')||'driving-car'))||'driving-car';
  if (profile==='foot-walking') kmh=5; else if (profile==='cycling-regular') kmh=18;
  return distanceM / (kmh * 1000 / 3600);
}
function extractTotals(data) {
  const r0 = data?.routes?.[0];
  if (r0) {
    if (r0.summary && Number.isFinite(r0.summary.distance) && Number.isFinite(r0.summary.duration))
      return { distanceM: Number(r0.summary.distance), durationS: Number(r0.summary.duration) };
    const seg0 = r0.segments?.[0];
    if (seg0 && Number.isFinite(seg0.distance) && Number.isFinite(seg0.duration))
      return { distanceM: Number(seg0.distance), durationS: Number(seg0.duration) };
    if (Number.isFinite(r0.distance) && Number.isFinite(r0.duration))
      return { distanceM: Number(r0.distance), durationS: Number(r0.duration) };
    if (Array.isArray(r0.legs) && r0.legs.length) {
      let d=0,s=0; for (const leg of r0.legs){ if (Number.isFinite(leg.distance)) d+=leg.distance; if (Number.isFinite(leg.duration)) s+=leg.duration; }
      if (d>0 || s>0) return { distanceM: d || NaN, durationS: s || NaN };
    }
    const line = getLineCoordsFromRoute(r0);
    if (line.length>1) { const sum = accumulateLine(line); return { distanceM: sum, durationS: estimateDurationByProfile(sum) }; }
  }
  const line2 = getLineCoordsFromGeoJSON(data);
  if (line2.length>1) { const sum = accumulateLine(line2); return { distanceM: sum, durationS: estimateDurationByProfile(sum) }; }
  return { distanceM: NaN, durationS: NaN };
}
function extractSteps(data) {
  const r0 = data?.routes?.[0];
  if (r0?.segments?.[0]?.steps?.length) return r0.segments[0].steps;
  if (r0?.legs?.[0]?.steps?.length)     return r0.legs[0].steps;
  return [];
}
function stepCenter(step){
  if (!step) return null;
  if (Array.isArray(step.way_points_center)) { const o=toLL(step.way_points_center); return {lat:o.lat,lng:o.lng}; }
  if (Array.isArray(step.way_points))        { const o=toLL(step.way_points[0]);   return {lat:o.lat,lng:o.lng}; }
  if (step.maneuver && Array.isArray(step.maneuver.location)){ const o=toLL(step.maneuver.location); return {lat:o.lat,lng:o.lng}; }
  return null;
}

export class NavigationController {
  constructor(mapController){
    this.mapCtrl = mapController || null;
    this.currentRoute = null;
    this.watchId = null;
    this.follow = false;

    this.totalM = NaN;
    this.totalS = NaN;
    this.remainM = NaN;

    this._lineCoords = [];
    this._subs = new Set();
  }

  onProgress(fn){ if (typeof fn==='function'){ this._subs.add(fn); return ()=>this._subs.delete(fn); } }
  _emit(snap){ this._subs.forEach(fn=>{ try{ fn(snap); }catch{} }); }

  setHereInitial(lnglat){ if (lnglat) followUser(lnglat,{center:false}); }
  setFollowEnabled(on){ this.follow = !!on; }
  isFollowEnabled(){ return this.follow; }

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

      const { distanceM, durationS } = extractTotals(data);
      this.totalM = distanceM; this.totalS = durationS;
      this.remainM = Number.isFinite(distanceM) ? distanceM : NaN;

      this._lineCoords = getLineCoordsFromRoute(data?.routes?.[0]) || [];
      if (!this._lineCoords.length) this._lineCoords = getLineCoordsFromGeoJSON(data);

      this._emit(this._mkSnap('案内中'));

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
      let min=Infinity, idx=0;
      for (let i=0;i<steps.length;i++){
        const cen = stepCenter(steps[i]); if (!cen) continue;
        const d = haversine(lat, lng, cen.lat, cen.lng);
        if (d<min){ min=d; idx=i; }
      }
      const remainAfter = steps.slice(Math.max(idx,0)).reduce((a,s)=>a+Number(s.distance||0),0);
      const cen = stepCenter(steps[idx]); const toCen = cen ? haversine(lat, lng, cen.lat, cen.lng) : 0;
      this.remainM = Math.max(0, toCen + remainAfter);
    } else if (this._lineCoords.length > 1) {
      const line = this._lineCoords;
      let min=Infinity, nearest=0;
      for (let i=0;i<line.length;i++){
        const [LNG, LAT] = line[i];
        const d = haversine(lat, lng, LAT, LNG);
        if (d<min){ min=d; nearest=i; }
      }
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
      if (!Number.isFinite(this.totalM) || this.totalM<=0) {
        this.totalM = accumulateLine(line);
        if (!Number.isFinite(this.totalS) || this.totalS<=0) this.totalS = estimateDurationByProfile(this.totalM);
      }
    }

    this._emit(this._mkSnap('案内中'));

    const card = document.getElementById('progress-card');
    if (card && steps.length) {
      const step = steps[0];
    
      // ← 音声案内のトリガー（距離に応じて自動で300m予告/直前を読み上げ）
      try { TTS.maybeAnnounce(step); } catch {}
    
      const icon = pickIcon(step);
      card.innerHTML = `
        <div class="progress-row">
          <span class="nav-icon ${icon}"></span>
          <span class="nav-text">${step.instruction || step.name || ''}</span>
        </div>
        <div class="nav-sub">残り ${Math.round(step.distance || 0)} m</div>
      `;
    }
  }
}
