let defaultController = null;

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
  if (!routeData) {
    return { type: 'FeatureCollection', features: [] };
  }
  if (routeData.type === 'FeatureCollection') {
    return routeData;
  }
  if (routeData.type === 'Feature') {
    return { type: 'FeatureCollection', features: [routeData] };
  }
  if (routeData.geojson) {
    const g = routeData.geojson;
    return g.type === 'FeatureCollection' ? g : { type: 'FeatureCollection', features: [g] };
  }
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

  return { type: 'FeatureCollection', features: [] };
}

export class MapController {
  constructor() {
    this.map = null;
    this.userMarker = null;

    this._onUserInteract = null;

    this.followZoom = 16.5;
  }

  async init(containerId = 'map') {
    const style = {
      version: 8,
      sources: {
        osm: {
          type: 'raster',
          tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
          tileSize: 256,
          attribution: '¢í OpenStreetMap contributors'
        }
      },
      layers: [{ id: 'osm', type: 'raster', source: 'osm' }]
    };

    this.map = new maplibregl.Map({
      container: containerId,
      style,
      center: [139.767, 35.681],
      zoom: 12
    });

    this.map.addControl(new maplibregl.NavigationControl({ showCompass: true, showZoom: true }), 'top-right');

    await new Promise((resolve) => this.map.on('load', resolve));

    ensureRouteSource(this.map);

    const fireIfUser = (e) => {
      if (!this._onUserInteract) return;
      if (e && e.originalEvent) {
        try { this._onUserInteract(); } catch {}
      }
    };

    ['dragstart', 'rotatestart', 'pitchstart', 'movestart'].forEach(ev => {
      this.map.on(ev, fireIfUser);
    });

    const callUser = () => { try { this._onUserInteract && this._onUserInteract(); } catch {} };
    this.map.getCanvas().addEventListener('mousedown', callUser, { passive: true });
    this.map.getCanvas().addEventListener('touchstart', callUser, { passive: true });
    this.map.getCanvas().addEventListener('wheel', callUser, { passive: true });

    if (!defaultController) defaultController = this;
  }

  onUserInteract(cb) { this._onUserInteract = typeof cb === 'function' ? cb : null; }

  setFollowZoom(z) {
    const n = Number(z);
    if (Number.isFinite(n) && n > 0) this.followZoom = n;
  }

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
      if (typeof zoom === 'number') {
        opts.zoom = zoom;
      } else {
        const cur = this.map.getZoom?.() ?? 12;
        const target = Number.isFinite(this.followZoom) ? this.followZoom : 16.5;
        if (cur < target) opts.zoom = target;
      }
      this.map.easeTo({ center: [lng, lat], ...opts });
    }
  }
}

export function drawRoute(routeData) {
  if (defaultController) defaultController.drawRoute(routeData);
}

export function clearRoute() {
  if (defaultController) defaultController.clearRoute();
}

export function followUser(lnglat, opts) {
  if (defaultController) defaultController.followUser(lnglat, opts);
}
