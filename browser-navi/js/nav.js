// nav.js (drop-in replacement)
// ES modules allowed, but code inside avoids optional chaining/nullish for Android WebView compatibility.
// All comments are English-only (per user's request).

import { API_BASE } from '../config.js';

// ---- Small utilities ----

function nowMs() { return Date.now(); }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function toRad(d) { return d * Math.PI / 180; }
function haversineMeters(a, b) {
  if (!a || !b) return Infinity;
  var R = 6371000;
  var dLat = toRad(b.lat - a.lat);
  var dLng = toRad(b.lng - a.lng);
  var la1 = toRad(a.lat);
  var la2 = toRad(b.lat);
  var s = Math.sin(dLat/2)*Math.sin(dLat/2) + Math.cos(la1)*Math.cos(la2)*Math.sin(dLng/2)*Math.sin(dLng/2);
  var c = 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1-s));
  return R * c;
}
function lineLengthMeters(coords) {
  var sum = 0;
  if (!coords || coords.length < 2) return 0;
  for (var i = 1; i < coords.length; i++) {
    sum += haversineMeters({lat: coords[i-1][1], lng: coords[i-1][0]}, {lat: coords[i][1], lng: coords[i][0]});
  }
  return sum;
}
function boundsOfCoords(coords) {
  var minLng = 180, minLat = 90, maxLng = -180, maxLat = -90;
  if (!coords || !coords.length) return null;
  for (var i = 0; i < coords.length; i++) {
    var c = coords[i];
    if (!c) continue;
    var lng = c[0], lat = c[1];
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  return [[minLng, minLat], [maxLng, maxLat]];
}
function formatEta(seconds) {
  if (!isFinite(seconds) || seconds <= 0) return '--:--';
  var s = Math.round(seconds);
  var h = Math.floor(s / 3600);
  var m = Math.floor((s % 3600) / 60);
  if (h > 0) return (h + 'h ' + m + 'm');
  return (m + 'm');
}
function kmStr(meters) {
  if (!isFinite(meters)) return '--';
  if (meters < 1000) return (Math.round(meters) + ' m');
  return ( (meters/1000).toFixed(1) + ' km' );
}

// ---- Polyline decoders ----

// Try decode as polyline with precision factor (1e5 or 1e6)
function decodePolyline(str, factor) {
  var index = 0, lat = 0, lng = 0, coordinates = [];
  var shift, result, byte, latitude_change, longitude_change;
  try {
    while (index < str.length) {
      shift = 0; result = 0;
      do {
        byte = str.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      latitude_change = ((result & 1) ? ~(result >> 1) : (result >> 1));

      shift = 0; result = 0;
      do {
        byte = str.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);
      longitude_change = ((result & 1) ? ~(result >> 1) : (result >> 1));

      lat += latitude_change;
      lng += longitude_change;
      coordinates.push([lng / factor, lat / factor]);
    }
  } catch (e) {
    return [];
  }
  return coordinates;
}

function tryDecodeAnyGeometry(geom) {
  // Prefer GeoJSON LineString: { type: 'LineString', coordinates: [...] }
  if (geom && typeof geom === 'object') {
    if (geom.type === 'LineString' && Array.isArray(geom.coordinates)) {
      return geom.coordinates;
    }
    // ORS sometimes returns {coordinates: [...]} without type
    if (Array.isArray(geom.coordinates)) return geom.coordinates;
  }
  // Otherwise assume encoded polyline
  if (typeof geom === 'string') {
    // First try 1e6 (ORS polyline6), then 1e5
    var c6 = decodePolyline(geom, 1e6);
    if (c6 && c6.length > 1) return c6;
    var c5 = decodePolyline(geom, 1e5);
    if (c5 && c5.length > 1) return c5;
  }
  return [];
}

// ---- Routing result parsing ----

function extractRouteCoordsFromORS(r0) {
  // ORS variants: r0.geometry (string polyline or geojson), or r0.segments[].steps
  if (!r0) return [];
  var coords = [];
  if (r0.geometry) {
    coords = tryDecodeAnyGeometry(r0.geometry);
    if (coords && coords.length > 1) return coords;
  }
  // GeoJSON-like
  if (r0.geojson && r0.geojson.coordinates) {
    coords = r0.geojson.coordinates;
    if (coords && coords.length > 1) return coords;
  }
  // Fallback: steps aggregation if available
  if (r0.segments && r0.segments[0] && r0.segments[0].steps) {
    var steps = r0.segments[0].steps;
    for (var i = 0; i < steps.length; i++) {
      var s = steps[i];
      if (s && s.way_points && s.way_points.length === 2 && r0.geometry) {
        // Not reliable without base geometry; ignore to avoid duplicates.
      }
    }
  }
  return coords;
}

function extractSummaryFromORS(r0) {
  var dist = NaN, dur = NaN;
  if (r0 && r0.summary) {
    if (r0.summary.distance != null) dist = Number(r0.summary.distance);
    if (r0.summary.duration != null) dur = Number(r0.summary.duration);
  } else if (r0 && r0.segments && r0.segments[0]) {
    if (r0.segments[0].distance != null) dist = Number(r0.segments[0].distance);
    if (r0.segments[0].duration != null) dur = Number(r0.segments[0].duration);
  } else if (r0) {
    if (r0.distance != null) dist = Number(r0.distance);
    if (r0.duration != null) dur = Number(r0.duration);
  }
  return { distance: dist, duration: dur };
}

function extractFromOSRM(data) {
  // OSRM: routes[0].geometry (encoded polyline), distance (m), duration (s)
  var out = { coords: [], distance: NaN, duration: NaN };
  if (!data || !data.routes || !data.routes[0]) return out;
  var r0 = data.routes[0];
  out.distance = Number(r0.distance != null ? r0.distance : NaN);
  out.duration = Number(r0.duration != null ? r0.duration : NaN);
  if (r0.geometry) {
    out.coords = tryDecodeAnyGeometry(r0.geometry);
  }
  return out;
}

// ---- TTS ----

var TTS = {
  unlocked: false,
  triedWire: false,
  unlockOnce: function() {
    if (this.unlocked) return;
    try {
      var u = new SpeechSynthesisUtterance(' ');
      u.volume = 0; u.rate = 1; u.pitch = 1; u.lang = 'ja-JP';
      window.speechSynthesis.speak(u);
      this.unlocked = true;
    } catch (e) {}
  },
  wireUnlock: function() {
    if (this.triedWire) return;
    this.triedWire = true;
    var self = this;
    function onFirstInteract() {
      self.unlockOnce();
    }
    document.addEventListener('click', onFirstInteract, { once: true, capture: true, passive: true });
    document.addEventListener('touchend', onFirstInteract, { once: true, capture: true, passive: true });
    document.addEventListener('keydown', onFirstInteract, { once: true, capture: true });
  },
  speak: function(text) {
    try {
      if (!text) return;
      var u = new SpeechSynthesisUtterance(text);
      u.lang = 'ja-JP';
      // volume/rate could be loaded from localStorage if needed
      u.rate = 1; u.pitch = 1; u.volume = 1;
      window.speechSynthesis.speak(u);
    } catch (e) {}
  }
};
TTS.wireUnlock();
window.TTS = window.TTS || TTS; // expose for UI if needed

// ---- HUD event bus ----

function emitHud(detail) {
  try {
    window.dispatchEvent(new CustomEvent('hud:update', { detail: detail }));
  } catch (e) {}
}

// ---- Off-route detector ----

function nearestIndexOnLine(coords, p) {
  // Returns nearest vertex index (simple; good enough for reroute trigger)
  if (!coords || coords.length === 0) return -1;
  var best = -1, bestD = Infinity;
  for (var i = 0; i < coords.length; i++) {
    var c = coords[i];
    var d = haversineMeters({lat: c[1], lng: c[0]}, p);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

function remainingDistanceMeters(coords, fromIndex) {
  if (!coords || coords.length < 2 || fromIndex < 0) return 0;
  var sum = 0;
  for (var i = fromIndex; i < coords.length - 1; i++) {
    sum += haversineMeters({lat: coords[i][1], lng: coords[i][0]}, {lat: coords[i+1][1], lng: coords[i+1][0]});
  }
  return sum;
}

// ---- Nav controller ----

function NavController() {
  this.dest = null;              // {lng, lat, label}
  this.active = false;
  this.routeCoords = [];         // [[lng,lat], ...]
  this.totalM = NaN;
  this.totalS = NaN;
  this._hudTimer = null;
  this._rerouteCooldownMs = 6000;
  this._lastRerouteAt = 0;
  this._offRouteThresholdM = 80; // hysteresis is simple: require > threshold to trigger, then cooldown prevents thrash
}

NavController.prototype.setDestination = function(p) {
  // p: {lng, lat, label?}
  this.dest = p;
};

NavController.prototype._buildGetUrl = function(start, goal) {
  var u = API_BASE.replace(/\/+$/,'') + '/route?start=' + start.lng + ',' + start.lat + '&goal=' + goal.lng + ',' + goal.lat;
  return u;
};

NavController.prototype._fetchORS = async function(payload) {
  var url = API_BASE.replace(/\/+$/,'') + '/route';
  var r = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
  if (!r.ok) throw new Error('ORS route failed');
  return r.json();
};

NavController.prototype._fetchOSRM = async function(start, goal) {
  // Worker may proxy OSRM; we piggy-back with GET
  var u = this._buildGetUrl(start, goal);
  var r = await fetch(u, { method:'GET' });
  if (!r.ok) throw new Error('OSRM route failed');
  return r.json();
};

NavController.prototype._applyRouteToMap = function(coords) {
  this.routeCoords = coords || [];
  if (window.mapCtrl && window.mapCtrl.setRouteLine) {
    window.mapCtrl.setRouteLine(this.routeCoords);
  }
  var b = boundsOfCoords(this.routeCoords);
  if (b && window.mapCtrl && window.mapCtrl.focusOnRoute) {
    window.mapCtrl.focusOnRoute(b);
  }
};

NavController.prototype._computeTotalIfMissing = function(data) {
  // Try ORS first
  var r0 = (data && data.routes && data.routes[0]) ? data.routes[0] : null;
  var sum = extractSummaryFromORS(r0);
  this.totalM = Number(sum.distance != null ? sum.distance : NaN);
  this.totalS = Number(sum.duration != null ? sum.duration : NaN);
  // If still missing, compute from geometry
  var need = !(isFinite(this.totalM) && this.totalM > 0);
  if (need) {
    var coords = [];
    if (r0) coords = extractRouteCoordsFromORS(r0);
    if ((!coords || coords.length < 2) && data && data.routes) {
      // OSRM-like shape at data.routes[0].geometry
      var osrmAlt = extractFromOSRM(data);
      if (osrmAlt && osrmAlt.coords && osrmAlt.coords.length > 1) {
        coords = osrmAlt.coords;
        if (!isFinite(this.totalM) || !(this.totalM > 0)) this.totalM = osrmAlt.distance;
        if (!isFinite(this.totalS) || !(this.totalS > 0)) this.totalS = osrmAlt.duration;
      }
    }
    if (coords && coords.length > 1) {
      var L = lineLengthMeters(coords);
      if (!isFinite(this.totalM) || !(this.totalM > 0)) this.totalM = L;
      if (!isFinite(this.totalS) || !(this.totalS > 0)) {
        // Rough duration estimate (50 km/h driving): tune by profile if needed
        this.totalS = (L / (50 * 1000)) * 3600;
      }
    }
  }
};

NavController.prototype._startHudLoop = function() {
  var self = this;
  if (this._hudTimer) clearInterval(this._hudTimer);
  this._hudTimer = setInterval(function() {
    if (!self.active) return;
    var pos = null;
    try {
      if (window.mapCtrl && window.mapCtrl.getLastKnownPosition) {
        pos = window.mapCtrl.getLastKnownPosition();
      }
    } catch (e) {}
    if (!pos) return;

    // Nearest progress on route
    var idx = nearestIndexOnLine(self.routeCoords, {lat: pos.lat, lng: pos.lng});
    var remain = remainingDistanceMeters(self.routeCoords, Math.max(0, idx));
    if (!isFinite(remain) || remain <= 0) remain = 0;

    // Simple ETA proportional to remaining vs total
    var etaS = 0;
    if (isFinite(self.totalM) && self.totalM > 0 && isFinite(self.totalS) && self.totalS > 0) {
      var ratio = clamp(remain / self.totalM, 0, 1);
      etaS = self.totalS * ratio;
    }

    emitHud({
      remainMeters: remain,
      remainText: kmStr(remain),
      etaText: formatEta(etaS),
      status: self.active ? 'navigating' : 'idle'
    });

    // Off-route detection + cooldown
    var dToLine = Infinity;
    if (idx >= 0 && self.routeCoords[idx]) {
      dToLine = haversineMeters({lat: self.routeCoords[idx][1], lng: self.routeCoords[idx][0]}, {lat: pos.lat, lng: pos.lng});
    }
    if (dToLine > self._offRouteThresholdM) {
      var t = nowMs();
      if (t - self._lastRerouteAt > self._rerouteCooldownMs) {
        self._lastRerouteAt = t;
        self._rerouteFrom(pos);
      }
    }
  }, 1000);
};

NavController.prototype._stopHudLoop = function() {
  if (this._hudTimer) clearInterval(this._hudTimer);
  this._hudTimer = null;
};

NavController.prototype._rerouteFrom = async function(fromPos) {
  try {
    var goal = this.dest;
    if (!goal) return;
    var payload = {
      coordinates: [[fromPos.lng, fromPos.lat], [goal.lng, goal.lat]],
      profile: 'driving-car',
      avoidTolls: true
    };
    var data = null, coords = [];
    try {
      data = await this._fetchORS(payload);
      var r0 = (data && data.routes && data.routes[0]) ? data.routes[0] : null;
      coords = extractRouteCoordsFromORS(r0);
      if (!coords || coords.length < 2) throw new Error('empty ors coords');
      this._computeTotalIfMissing(data);
    } catch (e1) {
      data = await this._fetchOSRM(fromPos, goal);
      var osrm = extractFromOSRM(data);
      coords = osrm.coords;
      if (!coords || coords.length < 2) throw new Error('empty osrm coords');
      if (!isFinite(this.totalM) || !(this.totalM > 0)) this.totalM = osrm.distance;
      if (!isFinite(this.totalS) || !(this.totalS > 0)) this.totalS = osrm.duration;
    }
    this._applyRouteToMap(coords);
    // Announce reroute short hint (optional)
    TTS.speak('ルートを再検索しました');
  } catch (e) {
    // swallow
  }
};

NavController.prototype.start = async function() {
  if (!this.dest) return;
  var startPos = null;
  try {
    if (window.mapCtrl && window.mapCtrl.getLastKnownPosition) {
      startPos = window.mapCtrl.getLastKnownPosition();
    }
  } catch (e) {}

  if (!startPos) {
    // fallback to Tokyo Station if no GPS yet (only to compute route; map should update once GPS arrives)
    startPos = { lat: 35.681, lng: 139.767 };
  }

  // Fetch route via ORS; fallback to OSRM
  var payload = {
    coordinates: [[startPos.lng, startPos.lat], [this.dest.lng, this.dest.lat]],
    profile: 'driving-car',
    avoidTolls: true
  };

  var data = null, coords = [];
  try {
    data = await this._fetchORS(payload);
    var r0 = (data && data.routes && data.routes[0]) ? data.routes[0] : null;
    coords = extractRouteCoordsFromORS(r0);
    if (!coords || coords.length < 2) throw new Error('empty ors coords');
    this._computeTotalIfMissing(data);
  } catch (e1) {
    try {
      data = await this._fetchOSRM(startPos, this.dest);
      var osrm = extractFromOSRM(data);
      coords = osrm.coords;
      if (!coords || coords.length < 2) throw new Error('empty osrm coords');
      if (!isFinite(this.totalM) || !(this.totalM > 0)) this.totalM = osrm.distance;
      if (!isFinite(this.totalS) || !(this.totalS > 0)) this.totalS = osrm.duration;
    } catch (e2) {
      // Failed both: stop and notify
      this.stop();
      TTS.speak('ルートを取得できませんでした');
      emitHud({ remainMeters: 0, remainText: '--', etaText: '--:--', status: 'error' });
      return;
    }
  }

  this._applyRouteToMap(coords);

  // Mark active and start HUD loop
  this.active = true;
  this._startHudLoop();

  // Start announcement (Android unlock-safe)
  try {
    TTS.unlockOnce();
    TTS.speak('ナビを開始します');
  } catch (e) {}

  // Initial HUD push
  emitHud({
    remainMeters: this.totalM,
    remainText: kmStr(this.totalM),
    etaText: formatEta(this.totalS),
    status: 'navigating'
  });
};

NavController.prototype.stop = function() {
  this.active = false;
  this._stopHudLoop();
  this.routeCoords = [];
  this.totalM = NaN;
  this.totalS = NaN;
  if (window.mapCtrl && window.mapCtrl.clearRoute) {
    window.mapCtrl.clearRoute();
  }
  emitHud({ remainMeters: 0, remainText: '--', etaText: '--:--', status: 'idle' });
  // Optional: end voice
  try {
    TTS.speak('案内を終了します');
  } catch (e) {}
};

// ---- Export & global wire ----

export const navCtrl = new NavController();

// For projects where main.js expects window.navCtrl to exist:
if (!window.navCtrl) window.navCtrl = navCtrl;

// Optional convenience: allow UI to set destination then call start()
// Example usage:
//   window.navCtrl.setDestination({lng: 139.767, lat: 35.681, label: 'Tokyo Station'});
//   window.navCtrl.start();
