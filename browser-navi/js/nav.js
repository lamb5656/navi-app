import { API_BASE } from '../config.js';

function nowMs(){ return Date.now(); }
function toRad(d){ return d*Math.PI/180; }
function clamp(v,a,b){ return Math.max(a, Math.min(b,v)); }
function haversineMeters(a,b){
  if(!a||!b) return Infinity;
  var R=6371000;
  var dLat=toRad(b.lat-a.lat), dLng=toRad(b.lng-a.lng);
  var la1=toRad(a.lat), la2=toRad(b.lat);
  var s=Math.sin(dLat/2)*Math.sin(dLat/2) + Math.cos(la1)*Math.cos(la2)*Math.sin(dLng/2)*Math.sin(dLng/2);
  return 2*R*Math.atan2(Math.sqrt(s), Math.sqrt(1-s));
}
function lineLengthMeters(coords){
  var sum=0; if(!coords||coords.length<2) return 0;
  for(var i=1;i<coords.length;i++){
    sum+=haversineMeters({lat:coords[i-1][1],lng:coords[i-1][0]},{lat:coords[i][1],lng:coords[i][0]});
  }
  return sum;
}
function polySegMeters(coords,a,b){
  if(!coords||coords.length<2) return 0;
  var s=0;
  for(var i=Math.max(0,a); i<Math.min(coords.length-1,b); i++){
    s += haversineMeters(
      {lat:coords[i][1],lng:coords[i][0]},
      {lat:coords[i+1][1],lng:coords[i+1][0]}
    );
  }
  return s;
}

function decodePolyline(str,factor){
  var i=0, lat=0, lng=0, out=[], shift, result, byte, dlat, dlng;
  try{
    while(i<str.length){
      shift=0; result=0;
      do{ byte=str.charCodeAt(i++)-63; result|=(byte&0x1f)<<shift; shift+=5; } while(byte>=0x20);
      dlat=(result&1)?~(result>>1):(result>>1);
      shift=0; result=0;
      do{ byte=str.charCodeAt(i++)-63; result|=(byte&0x1f)<<shift; shift+=5; } while(byte>=0x20);
      dlng=(result&1)?~(result>>1):(result>>1);
      lat+=dlat; lng+=dlng; out.push([lng/factor, lat/factor]);
    }
  }catch(e){ return []; }
  return out;
}
function tryDecodeAnyGeometry(geom){
  if(geom && typeof geom==='object'){
    if(geom.type==='LineString' && Array.isArray(geom.coordinates)) return geom.coordinates;
    if(Array.isArray(geom.coordinates)) return geom.coordinates;
  }
  if(typeof geom==='string'){
    var c6=decodePolyline(geom,1e6); if(c6.length>1) return c6;
    var c5=decodePolyline(geom,1e5); if(c5.length>1) return c5;
  }
  return [];
}
function extractRouteCoordsFromORS(r0){
  if(!r0) return [];
  if(r0.geometry){
    var c=tryDecodeAnyGeometry(r0.geometry);
    if(c&&c.length>1) return c;
  }
  if(r0.geojson && r0.geojson.coordinates){
    var c2=r0.geojson.coordinates; if(c2&&c2.length>1) return c2;
  }
  return [];
}
function extractSummaryFromORS(r0){
  var dist=NaN,dur=NaN;
  if(r0 && r0.summary){
    if(r0.summary.distance!=null) dist=Number(r0.summary.distance);
    if(r0.summary.duration!=null) dur=Number(r0.summary.duration);
  } else if(r0 && r0.segments && r0.segments[0]){
    if(r0.segments[0].distance!=null) dist=Number(r0.segments[0].distance);
    if(r0.segments[0].duration!=null) dur=Number(r0.segments[0].duration);
  } else if(r0){
    if(r0.distance!=null) dist=Number(r0.distance);
    if(r0.duration!=null) dur=Number(r0.duration);
  }
  return {distance:dist, duration:dur};
}

function extractFromOSRM(data){
  var out={coords:[], distance:NaN, duration:NaN};
  if(!data||!data.routes||!data.routes[0]) return out;
  var r0=data.routes[0];
  out.distance=Number(r0.distance!=null?r0.distance:NaN);
  out.duration=Number(r0.duration!=null?r0.duration:NaN);
  if(r0.geometry) out.coords=tryDecodeAnyGeometry(r0.geometry);
  return out;
}

function extractFromORSFeatureCollection(data){
  const out = { coords: [], distance: NaN, duration: NaN };
  if (!data || data.type !== 'FeatureCollection' || !Array.isArray(data.features) || !data.features[0]) return out;
  const f = data.features[0];
  if (f.geometry && f.geometry.type === 'LineString' && Array.isArray(f.geometry.coordinates)) {
    out.coords = f.geometry.coordinates;
  }
  const seg = f.properties && f.properties.segments && f.properties.segments[0];
  if (seg) {
    if (seg.distance != null) out.distance = Number(seg.distance);
    if (seg.duration != null) out.duration = Number(seg.duration);
  }
  return out;
}

function extractStepsFromORSFeatureCollection(data){
  const steps = [];
  if (!data || data.type!=='FeatureCollection' || !data.features || !data.features[0]) return steps;
  const seg = data.features[0].properties && data.features[0].properties.segments && data.features[0].properties.segments[0];
  if (!seg || !Array.isArray(seg.steps)) return steps;
  for (let i=0;i<seg.steps.length;i++){
    const s = seg.steps[i];
    const wp = Array.isArray(s.way_points)? s.way_points : [];
    steps.push({
      idx:i,
      from: Number.isFinite(wp[0]) ? wp[0] : null,
      to: Number.isFinite(wp[1]) ? wp[1] : null,
      text: s.instruction || ''
    });
  }
  return steps;
}
function extractStepsFromORSRoute(r0){
  const steps=[];
  const seg = r0 && r0.segments && r0.segments[0];
  if (!seg || !Array.isArray(seg.steps)) return steps;
  for (let i=0;i<seg.steps.length;i++){
    const s=seg.steps[i];
    const wp = Array.isArray(s.way_points)? s.way_points : [];
    steps.push({
      idx:i,
      from: Number.isFinite(wp[0]) ? wp[0] : null,
      to: Number.isFinite(wp[1]) ? wp[1] : null,
      text: s.instruction || ''
    });
  }
  return steps;
}
function osrmStepText(step){
  try{
    const m = step.maneuver || {};
    const type = m.type || '';
    const mod  = m.modifier || '';
    const name = step.name || '';
    const dir = (mod==='left'?'左':mod==='slight left'?'やや左':mod==='right'?'右':mod==='slight right'?'やや右':mod==='straight'?'直進':'');
    if(type==='depart') return '出発します';
    if(type==='arrive') return '目的地に到着します';
    if(type==='turn' || type==='end of road'){
      return (dir? (dir+'に曲がります') : '曲がります') + (name? '（'+name+'）':'');
    }
    if(type==='continue') return '直進します';
    if(type==='roundabout') return 'ランプに入ります';
    if(type==='fork') return (dir? (dir+'方向へ分岐します'):'分岐します');
    if(type==='merge') return '合流します';
    if(type==='on ramp') return 'ランプに入ります';
    if(type==='off ramp') return 'ランプを降ります';
    return (name? '次は'+name+'へ':'進みます');
  }catch(e){ return '進みます'; }
}
function extractStepsFromOSRM(data){
  const steps=[];
  try{
    const legs = data && data.routes && data.routes[0] && data.routes[0].legs;
    const st = legs && legs[0] && legs[0].steps;
    if(!Array.isArray(st)) return steps;
    for(let i=0;i<st.length;i++){
      steps.push({ idx:i, from:null, to:null, text: osrmStepText(st[i]) });
    }
  }catch(e){}
  return steps;
}

var TTS={
  unlocked:false, wired:false,
  unlockOnce:function(){
    if(this.unlocked) return;
    try{ var u=new SpeechSynthesisUtterance(' '); u.volume=0; u.lang='ja-JP'; window.speechSynthesis.speak(u); this.unlocked=true; }catch(e){}
  },
  wire:function(){
    if(this.wired) return; this.wired=true;
    var self=this, f=function(){ self.unlockOnce(); };
    document.addEventListener('click',f,{once:true,capture:true,passive:true});
    document.addEventListener('touchend',f,{once:true,capture:true,passive:true});
    document.addEventListener('keydown',f,{once:true,capture:true});
  },
  speak:function(t){ try{ if(!t) return; var u=new SpeechSynthesisUtterance(t); u.lang='ja-JP'; u.rate=1; u.pitch=1; u.volume=1; window.speechSynthesis.speak(u);}catch(e){} }
};
TTS.wire();
window.TTS = window.TTS || TTS;

function emitHud(remainMeters, etaSeconds, statusJa, nextText, nextDistM){
  var detail = {
    distanceLeftMeters: (isFinite(remainMeters) && remainMeters >= 0) ? remainMeters : NaN,
    eta: (isFinite(etaSeconds) && etaSeconds > 0) ? (Date.now() + Math.round(etaSeconds * 1000)) : null,
    status: statusJa,
    nextTurnText: (typeof nextText === 'string' && nextText.length) ? nextText : null,
    nextTurnDistanceMeters: (isFinite(nextDistM) && nextDistM >= 0) ? nextDistM : null
  };
  try { window.dispatchEvent(new CustomEvent('hud:update', { detail })); } catch (e) {}
}

export class NavigationController {
  constructor(mapCtrl){
    this.mapCtrl = mapCtrl;
    this.dest    = null;
    this.active  = false;

    this.routeCoords = [];
    this.totalM = NaN;
    this.totalS = NaN;

    this.routeSteps = [];
    this._stepSpoken = {};
    this._preAnnounceDistM = 200;
    this._nearAnnounceM    = 25;

    this._nextTurnText = null;
    this._nextTurnDistM = NaN;

    this.hereInitial = null;
    this.hereLast    = null;
    this._watchId = null;

    this._hudTimer = null;
    this._offRouteThresholdM = 80;
    this._rerouteCooldownMs = 12000;
    this._lastRerouteAt = 0;
  }

  setHereInitial(ll){ this.hereInitial = Array.isArray(ll)? ll : null; }
  setDestination(p){ this.dest = p; }

  _buildGetUrl(start, goal){
    return API_BASE.replace(/\/+$/,'') + '/route?start='+start.lng+','+start.lat+'&goal='+goal.lng+','+goal.lat;
  }

  async _fetchORS_POST(payload){
    const url = API_BASE.replace(/\/+$/,'') + '/route';
    const r = await fetch(url,{method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload)});
    if(!r.ok) throw new Error('ORS POST failed: '+r.status);
    return r.json();
  }
  async _fetchORS_GET(start,goal){
    const r = await fetch(this._buildGetUrl(start,goal));
    if(!r.ok) throw new Error('ORS GET failed: '+r.status);
    return r.json();
  }

  _applyRoute(coordsOrFc){
    let fc;
    if (coordsOrFc && coordsOrFc.type==='FeatureCollection') {
      fc = coordsOrFc;
      const ext = extractFromORSFeatureCollection(fc);
      this.routeCoords = ext.coords || [];
      if (!isFinite(this.totalM) || !(this.totalM>0)) this.totalM = ext.distance;
      if (!isFinite(this.totalS) || !(this.totalS>0)) this.totalS = ext.duration;
    } else {
      const coords = coordsOrFc || [];
      this.routeCoords = coords;
      fc = {
        type:'FeatureCollection',
        features: this.routeCoords.length>1 ? [{ type:'Feature', geometry:{ type:'LineString', coordinates:this.routeCoords }, properties:{} }] : []
      };
    }
    try { if(this.mapCtrl && typeof this.mapCtrl.drawRoute==='function') this.mapCtrl.drawRoute(fc); } catch(e){}
  }

  _computeTotalsFromAny(data, coordsFallback){
    let r0 = (data && data.routes && data.routes[0]) ? data.routes[0] : null;
    let sum = extractSummaryFromORS(r0);
    let totalM = Number(sum.distance!=null ? sum.distance : NaN);
    let totalS = Number(sum.duration!=null ? sum.duration : NaN);

    if (!isFinite(totalM) || !isFinite(totalS)) {
      const fc = extractFromORSFeatureCollection(data);
      if (isFinite(fc.distance)) totalM = fc.distance;
      if (isFinite(fc.duration)) totalS = fc.duration;
      if ((!coordsFallback || coordsFallback.length<2) && fc.coords && fc.coords.length>1) coordsFallback = fc.coords;
    }

    if((!isFinite(totalM) || totalM<=0) && coordsFallback && coordsFallback.length>1){
      totalM = lineLengthMeters(coordsFallback);
    }
    if((!isFinite(totalS) || totalS<=0) && isFinite(totalM) && totalM>0){
      totalS = (totalM/(50*1000))*3600;
    }

    this.totalM = totalM;
    this.totalS = totalS;
    return coordsFallback;
  }

  _captureStepsFromAny(data){
    this.routeSteps = [];
    this._stepSpoken = {};
    if (data && data.type==='FeatureCollection'){
      this.routeSteps = extractStepsFromORSFeatureCollection(data);
      return;
    }
    const r0 = data && data.routes && data.routes[0];
    const orsSteps = extractStepsFromORSRoute(r0);
    if (orsSteps.length){ this.routeSteps = orsSteps; return; }
    const osrmSteps = extractStepsFromOSRM(data);
    if (osrmSteps.length){ this.routeSteps = osrmSteps; }
  }

  _startHud(){
    var self=this;
    if(this._hudTimer) clearInterval(this._hudTimer);
    this._hudTimer = setInterval(function(){
      if(!self.active) return;
      var pos = self.hereLast ? self.hereLast : (self.hereInitial ? {lng:self.hereInitial[0], lat:self.hereInitial[1]} : null);
      if(!pos || !self.routeCoords || self.routeCoords.length<2) return;

      var best=-1, bestD=Infinity;
      for(var i=0;i<self.routeCoords.length;i++){
        var c=self.routeCoords[i];
        var d=haversineMeters({lat:c[1],lng:c[0]}, pos);
        if(d<bestD){ bestD=d; best=i; }
      }

      var remain=0;
      for(var j=Math.max(0,best); j<self.routeCoords.length-1; j++){
        remain += haversineMeters({lat:self.routeCoords[j][1],lng:self.routeCoords[j][0]}, {lat:self.routeCoords[j+1][1],lng:self.routeCoords[j+1][0]});
      }
      if(!isFinite(remain)||remain<0) remain=0;

      let etaSec=0;
      if(isFinite(self.totalM)&&self.totalM>0 && isFinite(self.totalS)&&self.totalS>0){
        etaSec = self.totalS * clamp(remain/self.totalM,0,1);
      }

      try { self._updateTurnByTurn(best, bestD, pos); } catch(e){}

      const status = (bestD>self._offRouteThresholdM) ? 'コース外' : '案内中';

      emitHud(remain, etaSec, status, self._nextTurnText, self._nextTurnDistM);

      if(bestD>self._offRouteThresholdM){
        var t=nowMs();
        if(t-self._lastRerouteAt>self._rerouteCooldownMs){
          self._lastRerouteAt=t;
          self._rerouteFrom(pos);
        }
      }

      try{
        if(self.mapCtrl && typeof self.mapCtrl.followUser==='function'){
          self.mapCtrl.followUser([pos.lng, pos.lat], { center:false, zoom:null });
        }
      }catch(e){}
    },1000);
  }
  _stopHud(){ if(this._hudTimer) clearInterval(this._hudTimer); this._hudTimer=null; }

  _startGeoWatch(){
    var self=this;
    if(!('geolocation' in navigator)) return;
    if(this._watchId!=null) return;
    this._watchId = navigator.geolocation.watchPosition(
      function(p){
        self.hereLast = { lng: p.coords.longitude, lat: p.coords.latitude };
        try{
          if(self.mapCtrl && typeof self.mapCtrl.followUser==='function'){
            self.mapCtrl.followUser([self.hereLast.lng, self.hereLast.lat], { center:true, zoom:16 });
          }
        }catch(e){}
      },
      function(){},
      { enableHighAccuracy:true, timeout:12000, maximumAge:3000 }
    );
  }
  _stopGeoWatch(){
    if(this._watchId!=null && 'geolocation' in navigator){
      try{ navigator.geolocation.clearWatch(this._watchId); }catch(e){}
    }
    this._watchId=null;
  }

  _nextStepIndexFromVertex(vIdx){
    if(!Array.isArray(this.routeSteps) || !this.routeSteps.length) return -1;
    for(let i=0;i<this.routeSteps.length;i++){
      const s=this.routeSteps[i];
      const start = Number.isFinite(s.from)? s.from : null;
      if(start==null){
        if(!this._stepSpoken[i] || !this._stepSpoken[i].main) return i;
      }else{
        if(start>=vIdx && (!this._stepSpoken[i] || !this._stepSpoken[i].main)) return i;
      }
    }
    return -1;
  }

  _updateTurnByTurn(bestVertexIdx, bestVertexDistM, pos){
    if(!this.routeCoords || this.routeCoords.length<2){
      this._nextTurnText = null;
      this._nextTurnDistM = NaN;
      return;
    }

    const iNext = this._nextStepIndexFromVertex(bestVertexIdx);
    if(iNext<0){
      this._nextTurnText = null;
      this._nextTurnDistM = NaN;
      return;
    }

    const step = this.routeSteps[iNext] || {};
    const startIdx = Number.isFinite(step.from)? step.from : null;

    let distAheadM = 0;
    if(startIdx==null){
      distAheadM = Math.max(0, polySegMeters(this.routeCoords, bestVertexIdx, this.routeCoords.length-1));
    }else{
      distAheadM = bestVertexDistM + Math.max(0, polySegMeters(this.routeCoords, bestVertexIdx, Math.max(bestVertexIdx, startIdx)));
    }

    this._nextTurnText = step.text || null;
    this._nextTurnDistM = isFinite(distAheadM) ? Math.max(0, distAheadM) : null;

    if(distAheadM<=this._preAnnounceDistM && (!this._stepSpoken[iNext] || !this._stepSpoken[iNext].pre)){
      const txt = step.text || '進みます';
      if(!/^出発します$/.test(txt) && !/^目的地に到着します$/.test(txt)){
        TTS.speak('まもなく、' + txt + '。' + Math.max(10, Math.round(distAheadM/10)*10) + 'メートル先です');
        this._stepSpoken[iNext] = Object.assign({}, this._stepSpoken[iNext], {pre:true});
      }else{
        this._stepSpoken[iNext] = Object.assign({}, this._stepSpoken[iNext], {pre:true});
      }
    }

    if(distAheadM<=this._nearAnnounceM && (!this._stepSpoken[iNext] || !this._stepSpoken[iNext].main)){
      const txt = step.text || '進みます';
      TTS.speak(txt);
      this._stepSpoken[iNext] = Object.assign({}, this._stepSpoken[iNext], {main:true});
    }
  }

  async _rerouteFrom(fromPos){
    try{
      var goal=this.dest; if(!goal) return;

      let data=null, coords=[];
      try{
        const payload={ coordinates:[[fromPos.lng,fromPos.lat],[goal.lng,goal.lat]], profile:'driving-car', avoidTolls:true };
        data = await this._fetchORS_POST(payload);
        this._captureStepsFromAny(data);

        if (data && data.type==='FeatureCollection'){
          const fc = extractFromORSFeatureCollection(data);
          coords = fc.coords;
          this.totalM = fc.distance; this.totalS = fc.duration;
          if(!coords || coords.length<2) throw new Error('empty FC coords');
        } else {
          const r0 = (data && data.routes && data.routes[0]) ? data.routes[0] : null;
          coords = extractRouteCoordsFromORS(r0);
          if(!coords || coords.length<2) throw new Error('empty ORS coords');
          this._computeTotalsFromAny(data, coords);
        }
      }catch(e1){
        data = await this._fetchORS_GET(fromPos, goal);
        this._captureStepsFromAny(data);

        if (data && data.type==='FeatureCollection'){
          const fc = extractFromORSFeatureCollection(data);
          coords = fc.coords;
          this.totalM = fc.distance; this.totalS = fc.duration;
        } else {
          const osrm = extractFromOSRM(data);
          coords = osrm.coords;
          if(!isFinite(this.totalM)||!(this.totalM>0)) this.totalM=osrm.distance;
          if(!isFinite(this.totalS)||!(this.totalS>0)) this.totalS=osrm.duration;
        }
        if(!coords || coords.length<2) throw new Error('empty coords after GET');
      }

      this._applyRoute(coords);
      TTS.speak('ルートを再検索しました');
    }catch(e){
      // swallow
    }
  }

  async start(){
    if(!this.dest) return;

    var startPos = this.hereLast ? this.hereLast
                 : (this.hereInitial ? { lng:this.hereInitial[0], lat:this.hereInitial[1] }
                 : { lng:139.767, lat:35.681 });

    let data=null, coords=[];
    try{
      const payload={ coordinates:[[startPos.lng,startPos.lat],[this.dest.lng,this.dest.lat]], profile:'driving-car', avoidTolls:true };
      data = await this._fetchORS_POST(payload);
      this._captureStepsFromAny(data);

      if (data && data.type==='FeatureCollection'){
        const fc = extractFromORSFeatureCollection(data);
        coords = fc.coords;
        this.totalM = fc.distance; this.totalS = fc.duration;
        if(!coords||coords.length<2) throw new Error('empty FC coords');
      } else {
        const r0 = (data && data.routes && data.routes[0]) ? data.routes[0] : null;
        coords = extractRouteCoordsFromORS(r0);
        if(!coords||coords.length<2) throw new Error('empty ORS coords');
        this._computeTotalsFromAny(data, coords);
      }
    }catch(e1){
      try{
        data = await this._fetchORS_GET(startPos, this.dest);
        this._captureStepsFromAny(data);

        if (data && data.type==='FeatureCollection'){
          const fc = extractFromORSFeatureCollection(data);
          coords = fc.coords;
          this.totalM = fc.distance; this.totalS = fc.duration;
        } else {
          const osrm=extractFromOSRM(data);
          coords=osrm.coords;
          if(!isFinite(this.totalM)||!(this.totalM>0)) this.totalM=osrm.distance;
          if(!isFinite(this.totalS)||!(this.totalS>0)) this.totalS=osrm.duration;
        }
        if(!coords||coords.length<2) throw new Error('empty coords after GET');
      }catch(e2){
        this.stop();
        TTS.speak('ルートを取得できませんでした');
        emitHud(NaN, 0, 'エラー', null, null);
        return;
      }
    }

    this._applyRoute(coords);

    this.active=true;
    this._nextTurnText=null; this._nextTurnDistM=NaN;
    this._startGeoWatch();
    this._startHud();

    try{ TTS.unlockOnce(); TTS.speak('ナビを開始します'); }catch(e){}

    emitHud(this.totalM, this.totalS, '案内中', null, null);
  }

  stop(){
    var wasActive = this.active;
    this.active=false;
    this._stopHud();
    this._stopGeoWatch();
    this.routeCoords=[];
    this.totalM=NaN; this.totalS=NaN;
    this.routeSteps=[]; this._stepSpoken={};
    this._nextTurnText=null; this._nextTurnDistM=NaN;
    try{ if(this.mapCtrl && typeof this.mapCtrl.clearRoute==='function') this.mapCtrl.clearRoute(); }catch(e){}
    emitHud(NaN, 0, '待機中', null, null);
    try{ if (wasActive) TTS.speak('案内を終了します'); }catch(e){}
  }
}
