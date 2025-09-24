// /browser-navi/js/nav.js
// Android WebView friendly: no optional chaining / nullish. English-only comments.

import { API_BASE } from '../config.js';

// -------- utils --------
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
function kmStr(m){ if(!isFinite(m)) return '--'; if(m<1000) return Math.round(m)+' m'; return (m/1000).toFixed(1)+' km'; }
function etaText(sec){ if(!isFinite(sec)||sec<=0) return '--:--'; var s=Math.round(sec), h=(s/3600)|0, m=((s%3600)/60)|0; return h>0?(h+'h '+m+'m'):(m+'m'); }

// -------- polyline decode --------
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

// -------- TTS --------
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

function emitHudForUI(remainMeters, etaSeconds, statusJa){
  var detail = {
    distanceLeftMeters: (isFinite(remainMeters) && remainMeters >= 0) ? remainMeters : NaN,
    eta: (isFinite(etaSeconds) && etaSeconds > 0) ? (Date.now() + Math.round(etaSeconds * 1000)) : null,
    status: statusJa
  };
  try { window.dispatchEvent(new CustomEvent('hud:update', { detail: detail })); } catch (e) {}
}

// -------- NavigationController --------
export class NavigationController {
  constructor(mapCtrl){
    this.mapCtrl = mapCtrl;
    this.dest    = null;
    this.active  = false;

    this.routeCoords = [];
    this.totalM = NaN;
    this.totalS = NaN;

    this.hereInitial = null; // [lng,lat], set by main.js
    this.hereLast    = null; // {lng,lat}, updated by geolocation watch
    this._watchId = null;

    this._hudTimer = null;
    this._offRouteThresholdM = 80;
    this._rerouteCooldownMs = 6000;
    this._lastRerouteAt = 0;
  }

  setHereInitial(ll){ this.hereInitial = Array.isArray(ll)? ll : null; }
  setDestination(p){ this.dest = p; }

  _buildGetUrl(start, goal){
    return API_BASE.replace(/\/+$/,'') + '/route?start='+start.lng+','+start.lat+'&goal='+goal.lng+','+goal.lat;
  }

  async _fetchORS(payload){
    var url = API_BASE.replace(/\/+$/,'') + '/route';
    var r = await fetch(url,{method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload)});
    if(!r.ok) throw new Error('ORS route failed');
    return r.json();
  }
  async _fetchOSRM(start,goal){
    var r = await fetch(this._buildGetUrl(start,goal));
    if(!r.ok) throw new Error('OSRM route failed');
    return r.json();
  }

  _applyRoute(coords){
    this.routeCoords = coords||[];
    var geo = {
      type:'FeatureCollection',
      features: this.routeCoords.length>1 ? [{ type:'Feature', geometry:{ type:'LineString', coordinates:this.routeCoords }, properties:{} }] : []
    };
    try { if(this.mapCtrl && typeof this.mapCtrl.drawRoute==='function') this.mapCtrl.drawRoute(geo); } catch(e){}
  }

  _computeTotalIfMissing(data){
    var r0 = (data && data.routes && data.routes[0]) ? data.routes[0] : null;
    var sum = extractSummaryFromORS(r0);
    this.totalM = Number(sum.distance!=null ? sum.distance : NaN);
    this.totalS = Number(sum.duration!=null ? sum.duration : NaN);

    var need = !(isFinite(this.totalM) && this.totalM>0);
    if(need){
      var coords = r0 ? extractRouteCoordsFromORS(r0) : [];
      if((!coords||coords.length<2) && data && data.routes){
        var osrmAlt = extractFromOSRM(data);
        if(osrmAlt && osrmAlt.coords && osrmAlt.coords.length>1){
          coords=osrmAlt.coords;
          if(!isFinite(this.totalM)||!(this.totalM>0)) this.totalM=osrmAlt.distance;
          if(!isFinite(this.totalS)||!(this.totalS>0)) this.totalS=osrmAlt.duration;
        }
      }
      if(coords && coords.length>1){
        var L=lineLengthMeters(coords);
        if(!isFinite(this.totalM)||!(this.totalM>0)) this.totalM=L;
        if(!isFinite(this.totalS)||!(this.totalS>0)) this.totalS=(L/(50*1000))*3600; // 50km/h rough
      }
    }
  }

  _startHud(){
    var self=this;
    if(this._hudTimer) clearInterval(this._hudTimer);
    this._hudTimer = setInterval(function(){
      if(!self.active) return;
      var pos = self.hereLast ? self.hereLast : (self.hereInitial ? {lng:self.hereInitial[0], lat:self.hereInitial[1]} : null);
      if(!pos) return;

      // nearest progress
      var best=-1, bestD=Infinity;
      for(var i=0;i<self.routeCoords.length;i++){
        var c=self.routeCoords[i];
        var d=haversineMeters({lat:c[1],lng:c[0]}, pos);
        if(d<bestD){ bestD=d; best=i; }
      }

      // remaining and ETA
      var remain=0;
      for(var j=Math.max(0,best); j<self.routeCoords.length-1; j++){
        remain += haversineMeters({lat:self.routeCoords[j][1],lng:self.routeCoords[j][0]}, {lat:self.routeCoords[j+1][1],lng:self.routeCoords[j+1][0]});
      }
      if(!isFinite(remain)||remain<0) remain=0;

      var eta=0;
      if(isFinite(self.totalM)&&self.totalM>0 && isFinite(self.totalS)&&self.totalS>0){
        eta = self.totalS * clamp(remain/self.totalM,0,1);
      }

      // send both legacy and new fields
      emitHudForUI(remain, eta, '案内中');

      // off-route with cooldown
      if(bestD>self._offRouteThresholdM){
        var t=nowMs();
        if(t-self._lastRerouteAt>self._rerouteCooldownMs){
          self._lastRerouteAt=t;
          self._rerouteFrom(pos);
        }
      }
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
            self.mapCtrl.followUser([self.hereLast.lng, self.hereLast.lat], { center:true, zoom:null });
          }
        }catch(e){}
      },
      function(){},
      { enableHighAccuracy:true, timeout:10000, maximumAge:2000 }
    );
  }
  _stopGeoWatch(){
    if(this._watchId!=null && 'geolocation' in navigator){
      try{ navigator.geolocation.clearWatch(this._watchId); }catch(e){}
    }
    this._watchId=null;
  }

  async _rerouteFrom(fromPos){
    try{
      var goal=this.dest; if(!goal) return;
      var payload={ coordinates:[[fromPos.lng,fromPos.lat],[goal.lng,goal.lat]], profile:'driving-car', avoidTolls:true };
      var data=null, coords=[];
      try{
        data = await this._fetchORS(payload);
        var r0 = (data && data.routes && data.routes[0]) ? data.routes[0] : null;
        coords = extractRouteCoordsFromORS(r0);
        if(!coords || coords.length<2) throw new Error('empty ors coords');
        this._computeTotalIfMissing(data);
      }catch(e1){
        data = await this._fetchOSRM(fromPos, goal);
        var osrm = extractFromOSRM(data);
        coords = osrm.coords;
        if(!coords || coords.length<2) throw new Error('empty osrm coords');
        if(!isFinite(this.totalM)||!(this.totalM>0)) this.totalM=osrm.distance;
        if(!isFinite(this.totalS)||!(this.totalS>0)) this.totalS=osrm.duration;
      }
      this._applyRoute(coords);
      TTS.speak('ルートを再検索しました');
    }catch(e){}
  }

  async start(){
    if(!this.dest) return;

    var startPos = this.hereLast ? this.hereLast
                 : (this.hereInitial ? { lng:this.hereInitial[0], lat:this.hereInitial[1] }
                 : { lng:139.767, lat:35.681 });

    var payload={ coordinates:[[startPos.lng,startPos.lat],[this.dest.lng,this.dest.lat]], profile:'driving-car', avoidTolls:true };
    var data=null, coords=[];
    try{
      data = await this._fetchORS(payload);
      var r0 = (data && data.routes && data.routes[0]) ? data.routes[0] : null;
      coords = extractRouteCoordsFromORS(r0);
      if(!coords||coords.length<2) throw new Error('empty ors coords');
      this._computeTotalIfMissing(data);
    }catch(e1){
      try{
        data = await this._fetchOSRM(startPos, this.dest);
        var osrm=extractFromOSRM(data);
        coords=osrm.coords;
        if(!coords||coords.length<2) throw new Error('empty osrm coords');
        if(!isFinite(this.totalM)||!(this.totalM>0)) this.totalM=osrm.distance;
        if(!isFinite(this.totalS)||!(this.totalS>0)) this.totalS=osrm.duration;
      }catch(e2){
        this.stop();
        TTS.speak('ルートを取得できませんでした');
        emitHudForUI(NaN, 0, 'エラー');
        return;
      }
    }

    this._applyRoute(coords);

    this.active=true;
    this._startGeoWatch();
    this._startHud();

    try{ TTS.unlockOnce(); TTS.speak('ナビを開始します'); }catch(e){}

    // initial HUD push (both styles)
    emitHudForUI(this.totalM, this.totalS, '案内中');
  }

  stop(){
    var wasActive = this.active;
    this.active=false;
    this._stopHud();
    this._stopGeoWatch();
    this.routeCoords=[];
    this.totalM=NaN; this.totalS=NaN;
    try{ if(this.mapCtrl && typeof this.mapCtrl.clearRoute==='function') this.mapCtrl.clearRoute(); }catch(e){}
    emitHudForUI(NaN, 0, '待機中');
    try{ if (wasActive) TTS.speak('案内を終了します'); }catch(e){}
  }
}
