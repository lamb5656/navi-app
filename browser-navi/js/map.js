// /browser-navi/js/map.js
// Map rendering utilities with both class-based and function exports.

let defaultController = null;

// ---- helpers ----
function ensureRouteSource(map) {
  if (!map.getSource('route')) {
    map.addSource('route', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  }
  if (!map.getLayer('route-line')) {
    map.addLayer({
      id: 'route-line',
      type: 'line',
      source: 'route',
      paint: {
        'line-width': 6,
        'line-color': '#0078ff',
        'line-opacity': 0.9
      },
      layout: { 'line-cap': 'round', 'line-join': 'round' }
    });
  }
}

function toGeoJSON(routeData) {
  // Accept a variety of shapes from ORS/OSRM/proxy responses
  // 1) GeoJSON Feature/FeatureCollection
  if (!routeData) {
    return { type: 'FeatureCollection', features: [] };
  }
  if (routeData.type === 'FeatureCollection') {
    return routeData;
  }
  if (routeData.type === 'Feature') {
    return { type: 'FeatureCollection', features: [routeData] };
  }
  // 2) { geojson: Feature|FeatureCollection }
  if (routeData.geojson) {
    const g = routeData.geojson;
    return g.type === 'FeatureCollection' ? g : { type: 'FeatureCollection', features: [g] };
  }
  // 3) ORS/OSRM-like { routes:[{ geometry: {type:'LineString', coordinates:[...]}}] }
  const line =
    routeData.routes?.[0]?.geometry && routeData.routes[0].geometry.type === 'LineString'
      ? routeData.routes[0].geometry
      : null;

  if (line) {
    return {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: line, properties: {} }]
    };
  }

  // Fallback: empty
  return { type: 'FeatureCollection', features: [] };
}

// ---- class controller ----
export class MapController {
  constructor() {
    this.map = null;
    this.userMarker = null;

    // ☆ 追加：ユーザー操作フック
    this._onUserInteract = null;
  }

  async init(containerId = 'map') {
    // Minimal style with OSM raster (no external config required)
    const style = {
      version: 8,
      sources: {
        osm: {
          type: 'raster',
          tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
          tileSize: 256,
          attribution:
            '© OpenStreetMap contributors'
        }
      },
      layers: [{ id: 'osm', type: 'raster', source: 'osm' }]
    };

    // `maplibregl` is expected to be available after ensureMaplibre()
    this.map = new maplibregl.Map({
      container: containerId,
      style,
      center: [139.767, 35.681], // Tokyo Station default
      zoom: 12
    });

    // Add controls safely
    this.map.addControl(new maplibregl.NavigationControl({ showCompass: true, showZoom: true }), 'top-right');

    await new Promise((resolve) => this.map.on('load', resolve));

    ensureRouteSource(this.map);

    // ☆ 追加：ユーザーの手動操作を検知してコールバック（スマホの「勝手に戻る」抑制）
    const fireInteract = () => { try { this._onUserInteract && this._onUserInteract(); } catch {} };
    // ユーザー起因の操作イベント群（プログラム操作の movestart は拾わない）
    ['dragstart', 'zoomstart', 'rotatestart', 'pitchstart'].forEach(ev => {
      this.map.on(ev, fireInteract);
    });
    // 一部端末向けの保険（直接のポインタ発火）
    ['mousedown', 'touchstart', 'wheel'].forEach(ev => {
      this.map.getCanvas().addEventListener(ev, fireInteract, { passive: true });
    });

    // Register as default controller (first one wins)
    if (!defaultController) defaultController = this;
  }

  // ☆ 追加：UI から登録できるフック
  onUserInteract(cb) { this._onUserInteract = typeof cb === 'function' ? cb : null; }

  // ☆ 追加：センター移動のユーティリティ（実装差吸収用）
  setCenter(lng, lat) {
    if (!this.map) return;
    if (typeof this.map.jumpTo === 'function') this.map.jumpTo({ center: [lng, lat] });
    else if (typeof this.map.setCenter === 'function') this.map.setCenter([lng, lat]);
    else if (typeof this.map.easeTo === 'function') this.map.easeTo({ center: [lng, lat], duration: 0 });
  }

  drawRoute(routeData) {
    if (!this.map) return;
    ensureRouteSource(this.map);
    const geo = toGeoJSON(routeData);
    const src = this.map.getSource('route');
    if (src) src.setData(geo);

    // Fit bounds if we have a line
    const feat = geo.features?.[0];
    if (feat?.geometry?.type === 'LineString' && Array.isArray(feat.geometry.coordinates) && feat.geometry.coordinates.length) {
      const coords = feat.geometry.coordinates;
      const bounds = new maplibregl.LngLatBounds(coords[0], coords[0]);
      for (const c of coords) bounds.extend(c);
      this.map.fitBounds(bounds, { padding: 60, duration: 600 });
    }
  }

  clearRoute() {
    if (!this.map) return;
    const src = this.map.getSource('route');
    if (src) src.setData({ type: 'FeatureCollection', features: [] });
  }

  followUser([lng, lat], { center = true, zoom = null } = {}) {
    if (!this.map) return;
    if (!this.userMarker) {
      const el = document.createElement('div');
      el.style.width = '14px';
      el.style.height = '14px';
      el.style.borderRadius = '50%';
      el.style.background = '#ff2353';
      el.style.boxShadow = '0 0 0 2px rgba(255,35,83,0.25)';
      this.userMarker = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([lng, lat]).addTo(this.map);
    } else {
      this.userMarker.setLngLat([lng, lat]);
    }
    if (center) {
      const opts = { duration: 400 };
      if (typeof zoom === 'number') opts.zoom = zoom;
      this.map.easeTo({ center: [lng, lat], ...opts });
    }
  }
}

// ---- function exports (proxy to default controller) ----
export function drawRoute(routeData) {
  if (defaultController) defaultController.drawRoute(routeData);
}

export function clearRoute() {
  if (defaultController) defaultController.clearRoute();
}

export function followUser(lnglat, opts) {
  if (defaultController) defaultController.followUser(lnglat, opts);
}
