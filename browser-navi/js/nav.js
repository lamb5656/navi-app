// Routing, guidance, TTS, reroute, progress card. Emits progress events for HUD.

import { withBackoff } from './libs/net.js';
import { getSetting } from './settings.js';
import { drawRoute, clearRoute, followUser } from './map.js';
import { API_BASE } from '../config.js';

function toast(msg, ms = 3000) {
  try {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), ms);
  } catch {}
}

// ---- Icons ----
const ICONS = {
  'turn-left': 'i-turn-left',
  'turn-right': 'i-turn-right',
  'turn-slight-left': 'i-slight-left',
  'turn-slight-right': 'i-slight-right',
  'turn-sharp-left': 'i-sharp-left',
  'turn-sharp-right': 'i-sharp-right',
  straight: 'i-straight',
  continue: 'i-straight',
  uturn: 'i-uturn',
  roundabout: 'i-roundabout',
  merge: 'i-merge',
  'fork-left': 'i-fork-left',
  'fork-right': 'i-fork-right',
  'ramp-left': 'i-ramp-left',
  'ramp-right': 'i-ramp-right'
};

// ---- Distance helpers (meters) ----
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
const llToObj = ([lng, lat]) => ({ lng: Number(lng), lat: Number(lat) });

// ---- Generic pickers for ORS/OSRM ----
function pickIcon(step) {
  const t = (step?.maneuver?.type || step?.type || '').toLowerCase();
  const m = (step?.maneuver?.modifier || step?.modifier || '').toLowerCase();
  if (t === 'turn') return ICONS[`turn-${m}`] || ICONS.straight;
  if (t === 'roundabout' || t === 'rotary') return ICONS.roundabout;
  if (t === 'merge') return ICONS.merge;
  if (t === 'fork') return ICONS[`fork-${m}`] || ICONS.straight;
  if (t === 'ramp') return ICONS[`ramp-${m}`] || ICONS.straight;
  if (t === 'continue') return ICONS.continue;
  if (t === 'uturn') return ICONS.uturn;
  return ICONS.straight;
}

// ▼ nav.js の extractTotals を丸ごとこれに置換
function extractTotals(data) {
  const route0 = data?.routes?.[0];
  if (!route0) return { distanceM: NaN, durationS: NaN };

  // 1) ORS summary
  if (route0.summary && Number.isFinite(route0.summary.distance) && Number.isFinite(route0.summary.duration)) {
    return { distanceM: Number(route0.summary.distance), durationS: Number(route0.summary.duration) };
  }
  // 2) OSRM route-level
  if (Number.isFinite(route0.distance) && Number.isFinite(route0.duration)) {
    return { distanceM: Number(route0.distance), durationS: Number(route0.duration) };
  }
  // 3) legs 合算
  if (Array.isArray(route0.legs) && route0.legs.length) {
    let d = 0, s = 0;
    for (const leg of route0.legs) {
      if (Number.isFinite(leg.distance)) d += leg.distance;
      if (Number.isFinite(leg.duration)) s += leg.duration;
    }
    if (d > 0 && s > 0) return { distanceM: d, durationS: s };
  }
  // 4) ▼ ここが新規：geometry から総距離を自前積算
  try {
    const coords = route0.geometry?.coordinates;
    if (Array.isArray(coords) && coords.length > 1) {
      let sum = 0;
      for (let i = 1; i < coords.length; i++) {
        const [lng1, lat1] = coords[i - 1];
        const [lng2, lat2] = coords[i];
        sum += (function hav(lat1, lng1, lat2, lng2) {
          const R=6371000, toRad=(d)=>d*Math.PI/180;
          const dLat=toRad(lat2-lat1), dLng=toRad(lng2-lng1);
          const a=Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLng/2)**2;
          return 2*R*Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        })(lat1, lng1, lat2, lng2);
      }
      // duration はプロファイルから概算（保険）
      const profile = (typeof getSetting === 'function' && (getSetting('profile')||'driving-car')) || 'driving-car';
      const kmh = profile === 'foot-walking' ? 5 : profile === 'cycling-regular' ? 18 : 40;
      const durationS = sum / (kmh * 1000 / 3600);
      return { distanceM: sum, durationS };
    }
  } catch {}
  return { distanceM: NaN, durationS: NaN };
}


// steps: ORS(segments[0].steps) or OSRM(legs[0].steps)
function extractSteps(data) {
  const route0 = data?.routes?.[0];
  // ORS
  const orsSteps = route0?.segments?.[0]?.steps;
  if (Array.isArray(orsSteps) && orsSteps.length) return orsSteps;
  // OSRM
  const osrmSteps = route0?.legs?.[0]?.steps;
  if (Array.isArray(osrmSteps) && osrmSteps.length) return osrmSteps;
  // Fallback
  return Array.isArray(data?.steps) ? data.steps : [];
}

// center point for a step: ORS(way_points_center or way_points[0]) / OSRM(maneuver.location)
function pickStepCenter(step) {
  if (!step) return null;
  // ORS
  if (Array.isArray(step.way_points_center)) {
    const o = llToObj(step.way_points_center);
    return { lat: o.lat, lng: o.lng };
  }
  if (Array.isArray(step.way_points)) {
    const o = llToObj(step.way_points[0]);
    return { lat: o.lat, lng: o.lng };
  }
  // OSRM
  if (step.maneuver && Array.isArray(step.maneuver.location)) {
    const o = llToObj(step.maneuver.location);
    return { lat: o.lat, lng: o.lng };
  }
  return null;
}

export class NavigationController {
  constructor(mapController) {
    this.mapCtrl = mapController || null;
    this.currentRoute = null;
    this.watchId = null;
    this.lastStepIdx = -1;
    this.hereInitial = null;
    this.followEnabled = false;

    // HUD-related
    this._totalDistanceM = NaN;
    this._totalDurationS = NaN;
    this._lastRemainM = NaN;

    // Progress subscribers
    this._subs = new Set();
  }

  // --- events for HUD ---
  onProgress(fn) { if (typeof fn === 'function') this._subs.add(fn); return () => this._subs.delete(fn); }
  _emitProgress(snap) { this._subs.forEach(fn => { try { fn(snap); } catch {} }); }

  setHereInitial(lnglat) { this.hereInitial = lnglat; followUser(lnglat, { center: false }); }
  setFollowEnabled(on) { this.followEnabled = !!on; }
  isFollowEnabled() { return !!this.followEnabled; }

  // ----- routing backends -----
  async _fetchRouteORS(payload) {
    const res = await fetch(`${API_BASE}/route`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    if (!res.ok) throw new Error('ORS route failed');
    return res.json();
  }
  async _fetchRouteOSRM(payload) {
    const coords = payload.coordinates || [];
    const start = coords[0];
    const goal = coords[coords.length - 1];
    const res = await fetch(`${API_BASE}/route?start=${start?.join(',')}&goal=${goal?.join(',')}`);
    if (!res.ok) throw new Error('OSRM route failed');
    return res.json();
  }
  async fetchRouteWithRetry(payload) {
    try {
      return await withBackoff(() => this._fetchRouteORS(payload), { retries: 2, base: 400 });
    } catch {
      toast('ORS error. Switching to OSRM…');
      return await withBackoff(() => this._fetchRouteOSRM(payload), { retries: 2, base: 400 });
    }
  }

  async start(coords) {
    try {
      clearRoute();
      const avoid = !!getSetting('avoidTolls');
      const profile = getSetting('profile') || 'driving-car';
      const payload = { coordinates: coords, avoidTolls: avoid, profile };
      const data = await this.fetchRouteWithRetry(payload);

      this.currentRoute = data;
      drawRoute(data);

      // robust totals
      const { distanceM, durationS } = extractTotals(data);
      this._totalDistanceM = Number(distanceM);
      this._totalDurationS = Number(durationS);
      this._lastRemainM = Number.isFinite(this._totalDistanceM) ? this._totalDistanceM : NaN;

      this.setFollowEnabled(true);
      this.lastStepIdx = -1;

      // emit first snapshot immediately
      this._emitProgress(this._mkSnap('案内中'));

      // start GPS
      if (this.watchId) navigator.geolocation.clearWatch(this.watchId);
      this.watchId = navigator.geolocation.watchPosition(
        (pos) => this._onPosition(pos),
        (err) => console.error(err),
        { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
      );
    } catch (e) {
      console.error(e);
      toast('Failed to start navigation.');
    }
  }

  stop() {
    if (this.watchId) { navigator.geolocation.clearWatch(this.watchId); this.watchId = null; }
    this.currentRoute = null;
    this.lastStepIdx = -1;
    this.setFollowEnabled(false);
    this._totalDistanceM = NaN;
    this._totalDurationS = NaN;
    this._lastRemainM = NaN;
    clearRoute();
    this._emitProgress({ distanceLeftMeters: NaN, eta: null, status: '待機中' });
  }

  // For compatibility (not used when events subscribed)
  getProgress() { return this._mkSnap('案内中'); }

  _mkSnap(statusText) {
    let eta = null;
    const remainM = this._lastRemainM;
    if (Number.isFinite(this._totalDistanceM) && this._totalDistanceM > 0 && Number.isFinite(this._totalDurationS)) {
      const ratio = Number.isFinite(remainM) ? Math.min(Math.max(remainM / this._totalDistanceM, 0), 1) : 1;
      const remainSec = this._totalDurationS * ratio;
      eta = Date.now() + remainSec * 1000;
    }
    return { distanceLeftMeters: remainM, eta, status: statusText };
  }

  _onPosition(pos) {
    const { latitude, longitude } = pos.coords;
    const lnglat = [longitude, latitude];
    followUser(lnglat, { center: this.followEnabled });
    if (!this.currentRoute) return;
    this._updateInstructions(lnglat);
  }

  _getSteps() {
    return extractSteps(this.currentRoute);
  }

  _updateInstructions([lng, lat]) {
    const steps = this._getSteps();
    if (!steps.length) {
      // ルートはあるが steps が無いケースでも総距離から ETA を出し続ける
      this._emitProgress(this._mkSnap('案内中'));
      return;
    }

    const idx = this._findNextStep(steps, [lng, lat]);
    const remainAfterIdx = steps.slice(Math.max(idx, 0)).reduce((acc, s) => acc + Number(s.distance || 0), 0);

    const pivot = pickStepCenter(steps[idx]);
    let toPivotM = 0;
    if (pivot) toPivotM = haversine(lat, lng, pivot.lat, pivot.lng);

    // HUD snapshot
    this._lastRemainM = Math.max(0, toPivotM + remainAfterIdx);
    this._emitProgress(this._mkSnap('案内中'));

    if (idx !== this.lastStepIdx) {
      this.lastStepIdx = idx;
      const step = steps[idx];
      if (step) {
        this._speak(step);
        this._renderProgress(step);
      }
    }
  }

  _findNextStep(steps, [lng, lat]) {
    let minDist = Infinity, minIdx = 0;
    for (let i = 0; i < steps.length; i++) {
      const cen = pickStepCenter(steps[i]);
      if (!cen) continue;
      const d = haversine(lat, lng, cen.lat, cen.lng);
      if (d < minDist) { minDist = d; minIdx = i; }
    }
    return minIdx;
  }

  _speak(step) {
    try {
      const msg = new SpeechSynthesisUtterance(step.instruction || step.name || 'Proceed');
      msg.rate = getSetting('ttsSpeed') || 1;
      msg.volume = getSetting('ttsVolume') || 1;
      speechSynthesis.speak(msg);
    } catch {}
  }

  _renderProgress(step) {
    const el = document.getElementById('progress-card');
    if (!el) return;
    const iconKey = pickIcon(step);
    el.innerHTML = `
      <div class="progress-row">
        <span class="nav-icon ${iconKey}"></span>
        <span class="nav-text">${step.instruction || step.name || ''}</span>
      </div>
      <div class="nav-sub">Remain ${Math.round(step.distance || 0)} m</div>
    `;
  }
}

export function createNavigation(mapCtrl) { return new NavigationController(mapCtrl); }

// Compatibility helpers (unchanged)
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
