// Routing, guidance, TTS, reroute, progress card. Provides NavigationController.

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

// --- distance helpers (meters) ---
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}
function llToObj([lng, lat]) { return { lng: Number(lng), lat: Number(lat) }; }

function pickIcon(step) {
  const t = step?.maneuver?.type || '';
  const m = (step?.maneuver?.modifier || '').toLowerCase();
  if (t === 'turn') return ICONS[`turn-${m}`] || ICONS.straight;
  if (t === 'roundabout' || t === 'rotary') return ICONS.roundabout;
  if (t === 'merge') return ICONS.merge;
  if (t === 'fork') return ICONS[`fork-${m}`] || ICONS.straight;
  if (t === 'ramp') return ICONS[`ramp-${m}`] || ICONS.straight;
  if (t === 'continue') return ICONS.continue;
  if (t === 'uturn') return ICONS.uturn;
  return ICONS.straight;
}

export class NavigationController {
  constructor(mapController) {
    this.mapCtrl = mapController || null;
    this.currentRoute = null;
    this.watchId = null;
    this.lastStepIdx = -1;
    this.hereInitial = null;
    this.followEnabled = false;

    // HUD-related fields
    this._totalDistanceM = NaN;    // from route summary
    this._totalDurationS = NaN;    // from route summary
    this._lastLngLat = null;       // last GPS
    this._lastRemainM = NaN;       // last computed remaining meters
  }

  setHereInitial(lnglat) {
    this.hereInitial = lnglat;
    followUser(lnglat, { center: false });
  }
  setFollowEnabled(on) { this.followEnabled = !!on; }
  isFollowEnabled() { return !!this.followEnabled; }

  // ----- routing backends -----
  async _fetchRouteORS(payload) {
    const res = await fetch(`${API_BASE}/route`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
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
      return await withBackoff(() => this._fetchRouteORS(payload), { retries: 2, base: 500 });
    } catch {
      toast('ORS error. Switching to OSRM…');
      return await withBackoff(() => this._fetchRouteOSRM(payload), { retries: 2, base: 500 });
    }
  }

  // ----- public controls -----
  async start(coords) {
    try {
      clearRoute();
      const avoid = !!getSetting('avoidTolls');
      const profile = getSetting('profile') || 'driving-car';

      const payload = { coordinates: coords, avoidTolls: avoid, profile };
      const data = await this.fetchRouteWithRetry(payload);

      this.currentRoute = data;
      drawRoute(data);

      // pick totals from summary if present
      const sum = data?.routes?.[0]?.summary || data?.summary || null;
      this._totalDistanceM = Number(sum?.distance ?? NaN);
      this._totalDurationS = Number(sum?.duration ?? NaN);

      this.setFollowEnabled(true);
      this.lastStepIdx = -1;

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
    if (this.watchId) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
    this.currentRoute = null;
    this.lastStepIdx = -1;
    this.setFollowEnabled(false);
    this._totalDistanceM = NaN;
    this._totalDurationS = NaN;
    this._lastLngLat = null;
    this._lastRemainM = NaN;
    clearRoute();
  }

  // ----- HUD/public snapshot -----
  getProgress() {
    if (!this.currentRoute) return null;

    const steps = this._getSteps();
    // If we never computed remaining yet, fall back to total
    const remainM = Number.isFinite(this._lastRemainM) ? this._lastRemainM : (Number.isFinite(this._totalDistanceM) ? this._totalDistanceM : NaN);

    // Estimate remaining duration proportionally to remaining distance
    let eta = null;
    if (Number.isFinite(this._totalDistanceM) && this._totalDistanceM > 0 && Number.isFinite(this._totalDurationS)) {
      const ratio = Number.isFinite(remainM) ? Math.min(Math.max(remainM / this._totalDistanceM, 0), 1) : 1;
      const remainSec = this._totalDurationS * ratio;
      eta = Date.now() + remainSec * 1000;
    }

    return {
      distanceLeftMeters: remainM,
      eta,
      status: '案内中'
    };
  }

  // ----- internals -----
  _onPosition(pos) {
    const { latitude, longitude } = pos.coords;
    const lnglat = [longitude, latitude];
    this._lastLngLat = lnglat;
    followUser(lnglat, { center: this.followEnabled });
    if (!this.currentRoute) return;
    this._updateInstructions(lnglat);
  }

  _getSteps() {
    if (this.currentRoute?.routes?.[0]?.segments?.[0]?.steps) {
      return this.currentRoute.routes[0].segments[0].steps;
    } else if (this.currentRoute?.steps) {
      return this.currentRoute.steps;
    }
    return [];
  }

  _updateInstructions([lng, lat]) {
    const steps = this._getSteps();
    if (!steps.length) return;

    const idx = this._findNextStep(steps, [lng, lat]);
    // Compute remaining meters from idx to end (sum of step.distance)
    const remainAfterIdx = steps.slice(Math.max(idx, 0)).reduce((acc, s) => acc + Number(s.distance || 0), 0);

    // Distance from current pos to the pivot of current step (waypoint center)
    const pivot = this._pickStepCenter(steps[idx]);
    let toPivotM = 0;
    if (pivot) {
      toPivotM = haversine(lat, lng, pivot.lat, pivot.lng);
    }

    // Save snapshot for HUD
    this._lastRemainM = Math.max(0, toPivotM + remainAfterIdx);

    if (idx !== this.lastStepIdx) {
      this.lastStepIdx = idx;
      const step = steps[idx];
      if (step) {
        this._speak(step);
        this._renderProgress(step);
      }
    }
  }

  _pickStepCenter(step) {
    // ORS: some builds include way_points_center [lng,lat]; or way_points [ [lng,lat], ... ]
    const wp = Array.isArray(step?.way_points_center)
      ? step.way_points_center
      : Array.isArray(step?.way_points)
        ? step.way_points[0]
        : null;
    if (!wp) return null;
    const o = llToObj(wp);
    return { lat: o.lat, lng: o.lng };
  }

  _findNextStep(steps, [lng, lat]) {
    let minDist = Infinity;
    let minIdx = 0;
    for (let i = 0; i < steps.length; i++) {
      const cen = this._pickStepCenter(steps[i]);
      if (!cen) continue;
      const d = haversine(lat, lng, cen.lat, cen.lng);
      if (d < minDist) { minDist = d; minIdx = i; }
    }
    return minIdx;
  }

  _speak(step) {
    try {
      const msg = new SpeechSynthesisUtterance(step.instruction || 'Proceed');
      msg.rate = getSetting('ttsSpeed') || 1;
      msg.volume = getSetting('ttsVolume') || 1;
      speechSynthesis.speak(msg);
    } catch {}
  }

  _renderProgress(step) {
    // If you have a custom progress card, update it here (optional)
    const el = document.getElementById('progress-card');
    if (!el) return;
    const iconKey = pickIcon(step);
    el.innerHTML = `
      <div class="progress-row">
        <span class="nav-icon ${iconKey}"></span>
        <span class="nav-text">${step.instruction || ''}</span>
      </div>
      <div class="nav-sub">Remain ${Math.round(step.distance || 0)} m</div>
    `;
  }
}

export function createNavigation(mapCtrl) {
  return new NavigationController(mapCtrl);
}

// (The UI helpers at the bottom were kept as-is in your previous file)
import { addHistory, toggleFavorite, isFavorite } from './ui.js';

// call this when user decides destination from search or list
export function setGoalAndMaybeStart(place) {
  const goalNameEl = document.getElementById('goal-text');
  if (goalNameEl && place.name) goalNameEl.value = place.name;
  window.__lastSelectedGoal = place;
}

export function onArrivedAtGoal(goal) {
  try { addHistory(goal); } catch {}
}

export function wireFavoriteButton(buttonEl, currentGoalGetter) {
  if (!buttonEl) return;
  const sync = () => {
    const g = currentGoalGetter();
    buttonEl.textContent = g && isFavorite(g) ? '★' : '☆';
  };
  buttonEl.addEventListener('click', () => {
    const g = currentGoalGetter();
    if (g) { toggleFavorite(g); sync(); }
  });
  sync();
}
