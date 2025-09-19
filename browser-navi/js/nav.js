// /browser-navi/js/nav.js
// Routing, guidance, TTS, reroute, progress card. Provides NavigationController.

import { withBackoff } from './libs/net.js';
import { getSetting } from './settings.js';
import { drawRoute, clearRoute, followUser } from './map.js';

// Minimal toast (no dependency on ui.js to avoid circular imports)
function toast(msg, ms = 3000) {
  try {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), ms);
  } catch {}
}

// Maneuver → icon key mapping (extend freely)
const ICONS = {
  'turn-left': 'i-turn-left',
  'turn-right': 'i-turn-right',
  'turn-slight-left': 'i-slight-left',
  'turn-slight-right': 'i-slight-right',
  'turn-sharp-left': 'i-sharp-left',
  'turn-sharp-right': 'i-sharp-right',
  'straight': 'i-straight',
  'continue': 'i-straight',
  'uturn': 'i-uturn',
  'roundabout': 'i-roundabout',
  'merge': 'i-merge',
  'fork-left': 'i-fork-left',
  'fork-right': 'i-fork-right',
  'ramp-left': 'i-ramp-left',
  'ramp-right': 'i-ramp-right',
};

function pickIcon(step) {
  const t = step?.maneuver?.type || '';
  const m = (step?.maneuver?.modifier || '').toLowerCase();
  if (t === 'turn') return ICONS[`turn-${m}`] || ICONS['straight'];
  if (t === 'roundabout' || t === 'rotary') return ICONS['roundabout'];
  if (t === 'merge') return ICONS['merge'];
  if (t === 'fork') return ICONS[`fork-${m}`] || ICONS['straight'];
  if (t === 'ramp') return ICONS[`ramp-${m}`] || ICONS['straight'];
  if (t === 'continue') return ICONS['continue'];
  if (t === 'uturn') return ICONS['uturn'];
  return ICONS['straight'];
}

export class NavigationController {
  constructor(mapController) {
    this.mapCtrl = mapController || null;
    this.currentRoute = null;
    this.watchId = null;
    this.lastStepIdx = -1;
    this.hereInitial = null;
  }

  setHereInitial(lnglat) {
    this.hereInitial = lnglat;
    followUser(lnglat, { center: true, zoom: 15 });
  }

  // ----- routing backends -----
  async _fetchRouteORS(payload) {
    const res = await fetch(`${API_BASE}/route`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
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
    clearRoute();
  }

  // ----- internals -----
  _onPosition(pos) {
    if (!this.currentRoute) return;
    const { latitude, longitude } = pos.coords;
    followUser([longitude, latitude], { center: true });

    this._updateInstructions([longitude, latitude]);
  }

  _updateInstructions([lng, lat]) {
    const route0 =
      this.currentRoute?.routes?.[0] ||
      this.currentRoute?.geojson || // proxy form
      null;

    if (!route0) return;

    // ORS style steps: routes[0].segments[0].steps
    let steps = [];
    if (this.currentRoute?.routes?.[0]?.segments?.[0]?.steps) {
      steps = this.currentRoute.routes[0].segments[0].steps;
    } else if (this.currentRoute?.steps) {
      steps = this.currentRoute.steps;
    }

    if (!steps.length) return;

    const idx = this._findNextStep(steps, [lng, lat]);
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
    let minDist = Infinity;
    let minIdx = 0;
    for (let i = 0; i < steps.length; i++) {
      const wp = Array.isArray(steps[i].way_points_center)
        ? steps[i].way_points_center
        : Array.isArray(steps[i].way_points)
          ? steps[i].way_points[0]
          : null;
      if (!wp) continue;
      const [slng, slat] = wp;
      const d = Math.hypot(lng - slng, lat - slat);
      if (d < minDist) {
        minDist = d;
        minIdx = i;
      }
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

// (optional) named exports if other modules want them
export function createNavigation(mapCtrl) {
  return new NavigationController(mapCtrl);
}
