import { toast } from './dom.js';
import { API_BASE } from '../../config.js';

var __NAV_STARTING__ = false;

async function fetchWithBackoff(factory, opts) {
  var retries = (opts && opts.retries != null) ? opts.retries : 2;
  var base = (opts && opts.base != null) ? opts.base : 300;
  var i = 0, lastErr = null;
  for (i = 0; i <= retries; i++) {
    try {
      var res = await factory();
      return res;
    } catch (e) {
      lastErr = e;
      if (i === retries) break;
      await new Promise(function (rs) { setTimeout(rs, base * Math.pow(2, i)); });
    }
  }
  throw lastErr;
}

export function setupStartStop(els, navCtrl, hooks) {
  var state = { goalLngLat: null, _followHeading: true };

  var manEl = document.getElementById('maneuver');
  if (manEl && manEl.style) manEl.style.display = 'none';

  async function geocode(text) {
    var url = API_BASE.replace(/\/+$/, '') + '/geocode?text=' + encodeURIComponent(text);
    var res = await fetchWithBackoff(function () {
      return fetch(url, { headers: { 'Accept': 'application/json' } });
    }, { retries: 1, base: 300 });

    if (!res.ok) throw new Error('geocode http ' + res.status);
    var data = await res.json();

    function featureToLL(f) {
      var c = f && f.geometry && f.geometry.coordinates;
      if (c && c.length >= 2) return { lon: Number(c[0]), lat: Number(c[1]) };
      return null;
    }

    var first = null;
    if (Array.isArray(data)) first = data[0];
    else if (data && Array.isArray(data.results)) first = data.results[0];
    else if (data && Array.isArray(data.data)) first = data.data[0];
    else if (data && Array.isArray(data.features)) first = featureToLL(data.features[0]);
    else if (data && Array.isArray(data.items)) first = data.items[0];
    else if (data && Array.isArray(data.places)) first = data.places[0];
    else if (data && Array.isArray(data.nominatim)) first = data.nominatim[0];

    if (!first) return null;

    var lng = Number(
      first.lon != null ? first.lon :
      first.lng != null ? first.lng :
      first.longitude != null ? first.longitude :
      (first.center && first.center[0] != null ? first.center[0] : NaN)
    );

    var lat = Number(
      first.lat != null ? first.lat :
      first.latitude != null ? first.latitude :
      (first.center && first.center[1] != null ? first.center[1] : NaN)
    );

    if (!isFinite(lng) || !isFinite(lat)) return null;
    return [lng, lat];
  }

  async function ensureGoal(searchApi) {
    var fromApi = (searchApi && searchApi.state && searchApi.state.goalLngLat) ? searchApi.state.goalLngLat : null;
    if (fromApi && Array.isArray(fromApi)) {
      state.goalLngLat = fromApi;
      return state.goalLngLat;
    }
    if (state.goalLngLat && Array.isArray(state.goalLngLat)) return state.goalLngLat;

    var q = (els && els.addr && typeof els.addr.value === 'string') ? els.addr.value.trim() : '';
    if (!q) return null;

    var ll = await geocode(q);
    if (ll) state.goalLngLat = ll;
    return state.goalLngLat;
  }

  async function resolveHere() {
    if (navCtrl && Array.isArray(navCtrl.hereInitial)) return navCtrl.hereInitial;

    return new Promise(function (resolve) {
      if (!('geolocation' in navigator)) return resolve([139.767, 35.681]);
      navigator.geolocation.getCurrentPosition(
        function (pos) { resolve([pos.coords.longitude, pos.coords.latitude]); },
        function () { resolve([139.767, 35.681]); },
        { enableHighAccuracy: true, timeout: 5000 }
      );
    });
  }

  async function onStart(searchApi) {
    if (__NAV_STARTING__) return;
    __NAV_STARTING__ = true;
    try { if (els && els.btnStart) els.btnStart.disabled = true; } catch(e){}

    try { if (window.TTS && typeof window.TTS.unlockOnce === 'function') window.TTS.unlockOnce(); } catch (e) {}

    try {
      var goal = await ensureGoal(searchApi);
      if (!goal) { toast('先に目的地を検索して選択してください'); return; }

      var here = await resolveHere();
      var goalName = (els && els.addr && typeof els.addr.value === 'string' && els.addr.value.trim()) ? els.addr.value.trim() : '目的地';

      try {
        if (hooks && typeof hooks.onGoalFixed === 'function') {
          hooks.onGoalFixed({ name: goalName, lng: Number(goal[0]), lat: Number(goal[1]) });
        }
      } catch (e) {}

      try {
        if (navCtrl && typeof navCtrl.setDestination === 'function') {
          navCtrl.setDestination({ lng: Number(goal[0]), lat: Number(goal[1]), label: goalName });
        }
        if (navCtrl && typeof navCtrl.start === 'function') {
          await navCtrl.start();
        }
      } catch (eStart) {
        console.error(eStart);
        toast('ナビの開始に失敗しました');
        return;
      }

      if (manEl && manEl.style) manEl.style.display = '';

      if (els && els.btnFollowToggle && els.btnFollowToggle.style) {
        els.btnFollowToggle.style.display = '';
        state._followHeading = true;
        try {
          if (window.mapCtrl && typeof window.mapCtrl.setFollowMode === 'function') {
            window.mapCtrl.setFollowMode('heading');
          }
        } catch (e) {}
        els.btnFollowToggle.textContent = '進行方向';
      }

      if (els && els.btnStop) els.btnStop.disabled = false;

      try {
        if (hooks && typeof hooks.onStarted === 'function') {
          hooks.onStarted({ name: goalName, lng: Number(goal[0]), lat: Number(goal[1]) });
        }
        if (hooks && typeof hooks.onTick === 'function') {
          hooks.onTick({ status: '案内中' });
        }
      } catch (e) {}

      toast('ナビを開始しました');

      try {
        if (window.TTS && typeof window.TTS.unlockOnce === 'function') window.TTS.unlockOnce();
        if (window.TTS && typeof window.TTS.speak === 'function') window.TTS.speak('ナビを開始します');
      } catch (e) {}

    } catch (e) {
      console.error(e);
      toast('ナビの開始に失敗しました');
    } finally {
      __NAV_STARTING__ = false;
      try { if (els && els.btnStart) els.btnStart.disabled = false; } catch(e){}
    }
  }

  function onStop() {
    try { if (navCtrl && typeof navCtrl.stop === 'function') navCtrl.stop(); } catch (e) {}

    state.goalLngLat = null;

    if (manEl && manEl.style) manEl.style.display = 'none';
    if (els && els.btnFollowToggle && els.btnFollowToggle.style) els.btnFollowToggle.style.display = 'none';
    if (els && els.btnStop) els.btnStop.disabled = true;

    try {
      if (hooks && typeof hooks.onTick === 'function') {
        hooks.onTick({ distanceLeftMeters: NaN, eta: null, status: '待機中' });
      }
    } catch (e) {}

    toast('ナビを停止しました');
  }

  function onFollowToggle() {
    state._followHeading = !state._followHeading;
    var mode = state._followHeading ? 'heading' : 'north';

    try {
      if (window.mapCtrl && typeof window.mapCtrl.setFollowMode === 'function') {
        window.mapCtrl.setFollowMode(mode);
      }
    } catch (e) {}

    if (els && els.btnFollowToggle) {
      els.btnFollowToggle.textContent = state._followHeading ? '進行方向' : '北固定';
    }
    toast(state._followHeading ? '追従を有効にしました' : '追従を停止しました');
  }

  async function centerLikeStart(mapCtrl, opt) {
    opt = opt || {};
    var here = await resolveHere();
    var z = (Number.isFinite && Number.isFinite(opt.zoom)) ? Number(opt.zoom) : 17;

    var m = (mapCtrl && mapCtrl.map) ? mapCtrl.map
          : (mapCtrl && mapCtrl._map) ? mapCtrl._map
          : (window.__map ? window.__map : null);

    if (m && typeof m.easeTo === 'function') {
      m.easeTo({ center: [here[0], here[1]], zoom: z, duration: 0 });
    } else if (mapCtrl && typeof mapCtrl.setCenter === 'function') {
      mapCtrl.setCenter(here[0], here[1]);
      if (m && typeof m.setZoom === 'function') m.setZoom(z);
    } else if (m && typeof m.setCenter === 'function') {
      m.setCenter([here[0], here[1]]);
      if (typeof m.setZoom === 'function') m.setZoom(z);
    } else if (mapCtrl && typeof mapCtrl.flyTo === 'function') {
      mapCtrl.flyTo([here[0], here[1]]);
      if (m && typeof m.setZoom === 'function') m.setZoom(z);
    }

    try {
      state._followHeading = true;
      if (window.mapCtrl && typeof window.mapCtrl.setFollowMode === 'function') {
        window.mapCtrl.setFollowMode('heading');
      }
    } catch (e) {}
  }

  return { onStart, onStop, onFollowToggle, centerLikeStart, state };
}
