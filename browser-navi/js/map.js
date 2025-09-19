import { TILE_URL } from './config.js';

function bboxOfCoords(coords){
  let minLng=Infinity,minLat=Infinity,maxLng=-Infinity,maxLat=-Infinity;
  for(const [lng,lat] of coords){ if(lng<minLng)minLng=lng; if(lat<minLat)minLat=lat; if(lng>maxLng)maxLng=lng; if(lat>maxLat)maxLat=lat; }
  return [[minLng,minLat],[maxLng,maxLat]];
}

export class MapController {
  constructor(){
    this.map = null;
    this.mapReady = false;
    this.routeLayerId = 'route-line';
    this.posMarker = null;
    this.goalMarker = null;
    this.markerQueue = []; // [[lng,lat], 'pos'|'goal']
    this.followMode = 'course'; // 'course' | 'north'
    this.autoFollow = true;
    this.lastHeading = 0;
    this._restoreTimer = null;
    this._onFollowChange = ()=>{};
  }

  setOnFollowChange(cb){ this._onFollowChange = typeof cb==='function' ? cb : ()=>{}; }
  _emitFollow(){ this._onFollowChange(this.autoFollow); }

  init(){
    if (!window.maplibregl) throw new Error('MapLibre not loaded');
    const style = {
      version: 8,
      sources: { osm: { type:'raster', tiles:[TILE_URL], tileSize:256, attribution:'© OpenStreetMap contributors' } },
      layers: [
        { id:'bg', type:'background', paint:{ 'background-color':'#dfe9f6' } },
        { id:'osm', type:'raster', source:'osm' }
      ]
    };
    this.map = new maplibregl.Map({ container:'map', style, center:[139.767,35.681], zoom:12, attributionControl:true });
    this.map.addControl(new maplibregl.NavigationControl(), 'top-left');

    this.map.on('load', ()=>{
      this.mapReady = true;
      while (this.markerQueue.length){
        const [lngLat, kind] = this.markerQueue.shift();
        if (kind==='pos') this.#setMarkerImmediate(lngLat); else this.#setGoalImmediate(lngLat);
      }
    });

    // ユーザー操作 → 追従一時停止 → 5秒後に復帰
    const pauseFollow = ()=>{ this.setAutoFollow(false); if (this._restoreTimer) clearTimeout(this._restoreTimer); };
    const scheduleRestore = ()=>{ if (this._restoreTimer) clearTimeout(this._restoreTimer); this._restoreTimer = setTimeout(()=>{ this.setAutoFollow(true); }, 5000); };
    this.map.on('dragstart', pauseFollow);
    this.map.on('rotatestart', pauseFollow);
    this.map.on('pitchstart', pauseFollow);
    this.map.on('dragend', scheduleRestore);
    this.map.on('rotateend', scheduleRestore);
    this.map.on('pitchend', scheduleRestore);
  }

  isReady(){ return this.mapReady; }
  setFollowMode(mode){ this.followMode = (mode==='north') ? 'north' : 'course'; }
  setAutoFollow(v){ const prev = this.autoFollow; this.autoFollow = !!v; if (prev!==this.autoFollow) this._emitFollow(); }
  setHeading(deg){ this.lastHeading = deg || 0; }

  setHere(lngLat){ if (!this.mapReady){ this.markerQueue.push([lngLat,'pos']); return; } this.#setMarkerImmediate(lngLat); }
  setGoal(lngLat){ if (!this.mapReady){ this.markerQueue.push([lngLat,'goal']); return; } this.#setGoalImmediate(lngLat); }

  #setMarkerImmediate(lngLat){
    if (!this.posMarker){ this.posMarker = new maplibregl.Marker({color:"#16a34a"}).setLngLat(lngLat).addTo(this.map); }
    else { this.posMarker.setLngLat(lngLat); }
  }
  #setGoalImmediate(lngLat){
    if (!this.goalMarker){ this.goalMarker = new maplibregl.Marker({color:"#ef4444"}).setLngLat(lngLat).addTo(this.map); }
    else { this.goalMarker.setLngLat(lngLat); }
  }

  updateViewToHere(here){
    if (!this.mapReady || !here) return;
    const bearing = (this.followMode==='course') ? (this.lastHeading||0) : 0;
    if (this.autoFollow){ this.map.easeTo({ center: here, bearing, duration: 300 }); }
  }
  focusHere(here){ if (this.mapReady && here) this.map.easeTo({center:here, zoom:15}); }
  recenter(here){ this.setAutoFollow(true); this.updateViewToHere(here); }

  drawRouteFeature(feature){
    if (!this.mapReady) return;
    const geo={ type:'FeatureCollection', features:[feature] };
    if (this.map.getSource('route')) this.map.getSource('route').setData(geo);
    else{
      this.map.addSource('route', { type:'geojson', data:geo });
      this.map.addLayer({ id:this.routeLayerId, type:'line', source:'route',
        paint:{ 'line-color':'#2563eb', 'line-width':5, 'line-opacity':0.9 } });
    }
    const bbox=bboxOfCoords(feature.geometry.coordinates);
    this.map.fitBounds(bbox,{ padding:50, maxZoom:16, duration:600 });
  }
}
