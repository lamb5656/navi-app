import { withBackoff } from './libs/net.js';
import { getSetting } from './settings.js';
import { drawRoute, clearRoute, followUser } from './map.js';
import { API_BASE } from '../config.js';

function toast(msg, ms = 3000) {
  try { const t = document.createElement('div'); t.className='toast'; t.textContent=msg;
        document.body.appendChild(t); setTimeout(() => t.remove(), ms); } catch {}
}

const TTS = (() => {
  let jaVoice = null;
  let unlocked = false;
  const memory = new Map();

  function pickJaVoice() {
    try {
      const voices = window.speechSynthesis?.getVoices?.() || [];
      if (!voices.length) return null;
      return voices.find(v => /^ja(-|_|$)/i.test(v.lang)) || voices[0] || null;
    } catch { return null; }
  }
  function refreshVoice() {
    jaVoice = pickJaVoice();
  }
  if ('speechSynthesis' in window) {
    try { refreshVoice(); window.speechSynthesis.onvoiceschanged = refreshVoice; } catch {}
  }

  function getSettingSafe(key, def) {
    try { return JSON.parse(localStorage.getItem('navi.settings') || '{}')[key] ?? def; } catch { return def; }
  }
  function speak(text) {
    if (!('speechSynthesis' in window)) return;
    if (!text || typeof text !== 'string') return;
    const vol = Number(getSettingSafe('ttsVolume', 1));
    const rate = Number(getSettingSafe('ttsSpeed', 1));
    const u = new SpeechSynthesisUtterance(text);
    if (jaVoice) u.voice = jaVoice;
    u.lang = (jaVoice?.lang || 'ja-JP');
    u.volume = Math.max(0, Math.min(1, Number.isFinite(vol) ? vol : 1));
    u.rate = Math.max(0.1, Math.min(2, Number.isFinite(rate) ? rate : 1));
    try { window.speechSynthesis.speak(u); } catch {}
  }
  function keyOf(step) {
    return (step?.id ?? step?.way_points?.join('-') ?? '') + '::' + (step?.instruction || step?.name || '');
  }
  function maybeAnnounceByDistance(step, metersToNext) {
    const dist = Number(metersToNext);
    if (!Number.isFinite(dist)) return;
    const key = keyOf(step);
    const flags = memory.get(key) || { p300: false, near: false };

    if (!flags.p300 && dist <= 340 && dist >= 260) {
      const line = (step?.instruction || step?.name || '').trim();
      if (line) speak(`この先、300メートル。${line}`);
      flags.p300 = true;
    }
    if (!flags.near && dist <= 80) {
      const line = (step?.instruction || step?.name || '').trim();
      if (line) speak(line);
      flags.near = true;
    }
    memory.set(key, flags);
  }
  function unlockOnce() {
    if (unlocked) return;
    unlocked = true;
    try { window.speechSynthesis?.cancel(); } catch {}
    refreshVoice();
  }
  try {
    document.addEventListener('click', unlockOnce, { once: true, capture: true });
    document.addEventListener('touchstart', unlockOnce, { once: true, capture: true, passive: true });
  } catch {}

  return { speak, maybeAnnounceByDistance, unlockOnce };
})();

try { window.TTS = TTS; } catch {}

const toLL = ([lng, lat]) => ({ lng: Number(lng), lat: Number(lat) });
function haversine(lat1, lon1, lat2, lon2) {
  const R=6371000, toRad=(d)=>d*Math.PI/180;
  const dLat=toRad(lat2-lat1), dLon=toRad(lon2-lon1);
  const a=Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  return 2*R*Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

const ICONS = { straight:'i-straight', roundabout:'i-roundabout', merge:'i-merge', uturn:'i-uturn',
  'fork-left':'i-fork-left','fork-right':'i-fork-right','ramp-left':'i-ramp-left','ramp-right':'i-ramp-right',
  'turn-left':'i-left','turn-right':'i-right','turn-slight left':'i-slight-left','turn-slight right':'i-slight-right',
  'turn-sharp left':'i-sharp-left','turn-sharp right':'i-sharp-right',continue:'i-straight' };
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
  if (r0?.geojson?.features?.[0]?.geometry?.type==='LineString'){
    return r0.geojson.features[0].geometry.coordinates;
  }
  if (Array.isArray(r0?.geometry?.coordinates)) return r0.geometry.coordinates;
  if (Array.isArray(r0?.routes?.[0]?.geometry?.coordinates)) return r0.routes[0].geometry.coordinates;
  return [];
}
function getLineCoordsFromGeoJSON(data){
  if (data?.type==='FeatureCollection'){
    const feat = data.features?.find(f=>f?.geometry?.type==='LineString');
    return feat?.geometry?.coordinates || [];
  }
  if (data?.type==='Feature' && data?.geometry?.type==='LineString'){
    return data.geometry.coordinates || [];
  }
  return [];
}
function accumulateLine(line){
  let sum = 0;
  for (let i=1;i<line.length;i++){
    const [lng1,lat1] = line[i-1]; const [lng2,lat2] = line[i];
    sum += haversine(lat1,lng1,lat2,lng2);
  }
  return sum;
}
function estimateDurationByProfile(distanceM){
  const profile = getSetting('profile','driving-car');
  const speedKmh = profile==='foot-walking' ? 4.5 : profile==='cycling-regular' ? 16 : 30;
  return (distanceM/1000)/(speedKmh) * 3600;
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

  async start([startLL, goalLL]){
    clearRoute();
    this.currentRoute = null;
    this._lineCoords = [];

    const profile = getSetting('profile','driving-car');
    const avoidTolls = !!getSetting('avoidTolls', true);

    let data = null;
    try{
      data = await withBackoff(
        () => this._fetchORS({ coordinates:[startLL, goalLL], avoidTolls, profile }),
        { retries: 1, base: 300 }
      );
    }catch(e){
      const url = `https://router.project-osrm.org/route/v1/driving/${startLL[0]},${startLL[1]};${goalLL[0]},${goalLL[1]}?geometries=geojson&steps=true&overview=full&annotations=false&alternatives=false&continue_straight=false`;
      const r = await fetch(url);
      const js = await r.json();
      data = js;
    }

    this.totalM = NaN; this.totalS = NaN;
      const r0 = data?.routes?.[0];
      if (r0?.summary?.distance || r0?.segments?.[0]?.distance){
        this.totalM = Number(r0.summary?.distance ?? r0.segments?.[0]?.distance ?? NaN);
        this.totalS = Number(r0.summary?.duration ?? r0.segments?.[0]?.duration ?? NaN);
      } else if (r0?.distance || r0?.duration){
        this.totalM = Number(r0?.distance ?? NaN);
        this.totalS = Number(r0?.duration ?? NaN);
      }
    }
    if (!(Number.isFinite(this.totalM) && this.totalM>0)){
      const r0 = data?.routes?.[0];
      if (r0){
        const line = getLineCoordsFromRoute(r0);
        if (line.length>1) { const sum = accumulateLine(line); this.totalM = sum; this.totalS = estimateDurationByProfile(sum); }
      }
      const line2 = getLineCoordsFromGeoJSON(data);
      if (line2.length>1) { const sum = accumulateLine(line2); this.totalM = sum; this.totalS = estimateDurationByProfile(sum); }
    }

    drawRoute(data);
    this.currentRoute = data;

    if (this.watchId) { try { navigator.geolocation.clearWatch(this.watchId); } catch {} }
    this.follow = true;
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => this._onPosition(pos),
      () => {},
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 }
    );
  }

  stop(){
    if (this.watchId) { try { navigator.geolocation.clearWatch(this.watchId); } catch {} this.watchId = null; }
    this.currentRoute = null;
    this._lineCoords = [];
    this.totalM = NaN; this.totalS = NaN; this.remainM = NaN;
    clearRoute();
    this._emit(this._mkSnap('待機中'));
  }

  _mkSnap(status='案内中'){
    let eta = null;
    if (Number.isFinite(this.totalM) && this.totalM>0 && Number.isFinite(this.remainM)) {
      const ratio = Math.max(0, Math.min(1, this.remainM / this.totalM));
      if (Number.isFinite(this.totalS) && this.totalS>0) {
        eta = Date.now() + this.totalS * ratio * 1000;
      }
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

    if (Array.isArray(this.currentRoute?.routes?.[0]?.geometry?.coordinates)) {
      if (!this._lineCoords.length) this._lineCoords = this.currentRoute.routes[0].geometry.coordinates;
      if (this._lineCoords.length>1) {
        let best = 0, bestD = Infinity;
        for (let i=0; i<this._lineCoords.length; i++) {
          const [clng,clat] = this._lineCoords[i];
          const d = haversine(lat,lng,clat,clng);
          if (d<bestD) { bestD=d; best=i; }
        }
        let rem = 0;
        for (let i=best; i<this._lineCoords.length-1; i++) {
          const [lng1,lat1]=this._lineCoords[i], [lng2,lat2]=this._lineCoords[i+1];
          rem += haversine(lat1,lng1,lat2,lng2);
        }
        this.remainM = rem;
        if (!Number.isFinite(this.totalM) || this.totalM<=0) {
          const sum = accumulateLine(this._lineCoords);
          this.totalM = sum;
          if (!Number.isFinite(this.totalS) || this.totalS<=0) this.totalS = estimateDurationByProfile(this.totalM);
        }
      }
    }

    this._emit(this._mkSnap('案内中'));

    const card = document.getElementById('progress-card');
    if (card && steps.length){
      const step = steps[0];

      let toNextM = NaN;
      const loc = step?.maneuver?.location; // [lng, lat]
      if (Array.isArray(loc) && loc.length >= 2) {
        toNextM = haversine(lat, lng, Number(loc[1]), Number(loc[0]));
      } else {
        const cen = stepCenter(step);
        if (cen) toNextM = haversine(lat, lng, cen.lat, cen.lng);
      }

      try { TTS.maybeAnnounceByDistance(step, toNextM); } catch {}

      const icon = pickIcon(step);
      card.innerHTML = `
        <div class="progress-row">
          <span class="nav-icon ${icon}"></span>
          <span class="nav-text">${step.instruction || step.name || ''}</span>
        </div>
        <div class="nav-sub">残り ${Math.round(Number.isFinite(toNextM) ? toNextM : (step.distance || 0))} m</div>
      `;
    }
  }
}

function extractSteps(data) {
  const r0 = data?.routes?.[0];
  if (r0?.segments?.[0]?.steps?.length) return r0.segments[0].steps;
  if (r0?.legs?.[0]?.steps?.length)     return r0.legs[0].steps;
  return r0?.segments?.[0]?.steps || [];
}
