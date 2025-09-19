import { API_BASE, CONST } from './config.js';
import { getSettings } from './settings.js';

function toast(msg, ms=1800){ const el=document.getElementById("toast"); el.textContent=msg; el.style.display="block"; clearTimeout(el._t); el._t=setTimeout(()=>el.style.display="none", ms); }
function hav(a,b){ const R=6371000, toRad=x=>x*Math.PI/180; const dLat=toRad(b[1]-a[1]), dLng=toRad(b[0]-a[0]), la1=toRad(a[1]), la2=toRad(b[1]); const A=Math.sin(dLat/2)**2+Math.cos(la1)*Math.cos(la2)*Math.sin(dLng/2)**2; return 2*R*Math.asin(Math.sqrt(A)); }
function nearestIndex(p, line){ let mi=0, md=Infinity; for(let i=0;i<line.length;i++){ const d=hav(p,line[i]); if(d<md){md=d;mi=i;} } return mi; }
function toXY(ll){ return [ ll[0]*111320*Math.cos(ll[1]*Math.PI/180), ll[1]*110540 ]; }
function pointToSegmentDistance(p,a,b){ const P=toXY(p), A=toXY(a), B=toXY(b), AB=[B[0]-A[0],B[1]-A[1]], AP=[P[0]-A[0],P[1]-A[1]]; const ab2=AB[0]*AB[0]+AB[1]*AB[1]||1; let t=(AP[0]*AB[0]+AP[1]*AB[1])/ab2; t=Math.max(0,Math.min(1,t)); const X=[A[0]+AB[0]*t,A[1]+AB[1]*t]; return Math.hypot(P[0]-X[0], P[1]-X[1]); }
function minDistanceToPolyline(point, line){ let md=Infinity; for(let i=1;i<line.length;i++){ const d=pointToSegmentDistance(point,line[i-1],line[i]); if(d<md) md=d; } return md; }
function computeCourseFromPositions(prev, curr){
  if (!prev || !curr) return null;
  const toRad = d => d*Math.PI/180, toDeg = r => r*180/Math.PI;
  const dLng = toRad(curr[0]-prev[0]);
  const y = Math.sin(dLng) * Math.cos(toRad(curr[1]));
  const x = Math.cos(toRad(prev[1]))*Math.sin(toRad(curr[1])) - Math.sin(toRad(prev[1]))*Math.cos(toRad(curr[1]))*Math.cos(dLng);
  let brng = toDeg(Math.atan2(y, x));
  return (brng + 360) % 360;
}

/* 進行アイコン推定（ざっくりヒューリスティック） */
function symbolForInstruction(instr=""){
  const t = instr.toLowerCase();
  if (t.includes('u-turn') || t.includes('uturn') || t.includes('u ターン') || t.includes('uターン')) return '↩︎';
  if (t.includes('roundabout') || t.includes('ロータリー')) return '⟳';
  if (t.includes('slight right') || t.includes('斜め右')) return '↗︎';
  if (t.includes('slight left') || t.includes('斜め左')) return '↖︎';
  if (t.includes('right') || t.includes('右')) return '↱';
  if (t.includes('left') || t.includes('左')) return '↰';
  if (t.includes('merge') || t.includes('ramp')) return '⤴︎';
  return '⤴︎'; // straight/continue
}
function formatMeters(m){
  if (!isFinite(m)) return '—';
  if (m>=1000) return (m/1000).toFixed(1)+'km';
  return Math.max(0, Math.round(m))+'m';
}

export class NavigationController {
  constructor(mapCtrl){
    this.map = mapCtrl;
    this.here = null; this.goal = null;
    this.routeCoords = []; this.steps = [];
    this.stepPreviewed = new Set(); this.previewHistory = new Map();
    this.offRouteCount = 0; this.lastRerouteAt = 0;
    this.arrivalPreviewed = false; this.watchId = null; this.wakeLock = null;

    this.remainEl = document.getElementById("remainKm");
    this.etaEl = document.getElementById("eta");
    this.statusEl = document.getElementById("status");

    this._lastSpeechAt = 0;

    // maneuver UI refs
    this.manu = document.getElementById('maneuver');
    this.manIcon = document.getElementById('manIcon');
    this.manDist = document.getElementById('manDist');
    this.manInstr = document.getElementById('manInstr');
    this.currentManIdx = -1;
  }

  setGoal(lngLat){ this.goal = lngLat; this.map.setGoal(lngLat); }
  setHereInitial(lngLat){ this.here = lngLat; this.map.setHere(lngLat); this.map.focusHere(lngLat); }

  speak(text){
    const now = Date.now();
    if (now - this._lastSpeechAt < CONST.MIN_SPEECH_INTERVAL_MS) return;
    this._lastSpeechAt = now;
    try{
      const s = getSettings();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = s.ttsRate ?? 1.0; u.pitch = 1.0; u.volume = s.ttsVolume ?? 1.0;
      window.speechSynthesis.cancel(); window.speechSynthesis.speak(u);
    }catch(e){ console.warn('TTS failed', e); }
  }

  setStatus(t){ this.statusEl.textContent = t; }

  async fetchRoute(start, goal, opt={}){
    const s = getSettings();
    const body = JSON.stringify({ coordinates:[start, goal], avoidTolls: !!opt.avoidTolls, profile: s.profile });
    const res = await fetch(`${API_BASE}/route`, { method:'POST', headers:{'Content-Type':'application/json'}, body });
    if (!res.ok) throw new Error('route error');
    return res.json();
  }

  setupGuidance(feature){
    this.routeCoords = feature.geometry.coordinates;
    const seg = feature.properties?.segments?.[0] || {};
    this.steps = seg.steps || [];
    this.stepPreviewed.clear(); this.previewHistory.clear(); this.arrivalPreviewed = false;
    this.currentManIdx = -1; this.hideManeuver();
    this.map.drawRouteFeature(feature);
    if (this.here) this.map.focusHere(this.here);
  }

  async start(avoidTolls){
    if (!this.goal){ toast("まず目的地を検索・選択してください"); return; }
    try{
      if (!this.here){ toast("現在地の取得を待っています…"); }
      const data = await this.fetchRoute(this.here || this.goal, this.goal, { avoidTolls });
      const feat = data.features[0];
      this.setupGuidance(feat);

      this.setStatus('案内中');
      document.body.classList.add('navigating');
      document.getElementById('btnStart').disabled = true;
      document.getElementById('btnStop').disabled = false;

      this.map.setFollowMode('course');
      document.getElementById('btnFollowToggle').textContent = '進行方向';
      this.map.setAutoFollow(true);

      if ('wakeLock' in navigator && navigator.wakeLock?.request){
        try{ this.wakeLock = await navigator.wakeLock.request('screen'); }catch{}
      }
      this.beginWatch();
      this.speak('案内を開始します');
    }catch(e){
      console.error(e); toast('ルート取得に失敗しました');
    }
  }

  stop(){
    if (this.watchId){ navigator.geolocation.clearWatch(this.watchId); this.watchId = null; }
    if (this.wakeLock){ try{ this.wakeLock.release(); }catch{} this.wakeLock = null; }
    this.setStatus('停止中');
    document.getElementById('btnStart').disabled = false;
    document.getElementById('btnStop').disabled = true;
    document.body.classList.remove('navigating');
    this.hideManeuver();
    this.speak('案内を停止しました');
  }

  updateHUD(remainMeters, etaSec){
    this.remainEl.textContent = isFinite(remainMeters) ? (remainMeters/1000).toFixed(1) : '–';
    if (isFinite(etaSec)){
      const d = new Date(Date.now()+etaSec*1000);
      this.etaEl.textContent = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    } else this.etaEl.textContent = '–:–';
  }

  estimateRemain(point){
    if (!this.routeCoords.length) return { meters: NaN, eta: NaN };
    const idx = nearestIndex(point, this.routeCoords);
    let meters = hav(point, this.routeCoords[idx]);
    for (let i=idx;i<this.routeCoords.length-1;i++) meters += hav(this.routeCoords[i], this.routeCoords[i+1]);
    const speed = 11.1;
    return { meters, eta: meters / speed };
  }

  beginWatch(){
    if (this.watchId) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = navigator.geolocation.watchPosition(
      (pos)=>this.#onPosition(pos),
      (err)=>{ console.error(err); toast('現在地の取得に失敗しました'); },
      { enableHighAccuracy:true, maximumAge:2000, timeout:10000 }
    );
  }

  showManeuver(step, remainM){
    if (!step) return this.hideManeuver();
    this.manIcon.textContent = symbolForInstruction(step.instruction||'');
    this.manDist.textContent = formatMeters(remainM);
    this.manInstr.textContent = step.instruction || '進行方向です';
    this.manu.style.display = 'flex';
    // 簡易レーン表示（中央をアクティブに）
    document.getElementById('lane1').classList.remove('active');
    document.getElementById('lane2').classList.add('active');
    document.getElementById('lane3').classList.remove('active');
  }
  hideManeuver(){ this.manu.style.display = 'none'; }

  #onPosition(pos){
    const prev = this.here;
    this.here = [pos.coords.longitude, pos.coords.latitude];
    this.map.setHere(this.here);

    // heading
    let heading = (typeof pos.coords.heading === 'number' && !Number.isNaN(pos.coords.heading)) ? pos.coords.heading : null;
    if (heading == null){
      const c = computeCourseFromPositions(prev, this.here);
      if (c != null) heading = c;
    }
    if (heading != null) this.map.setHeading(heading);
    this.map.updateViewToHere(this.here);

    if (!this.routeCoords.length){ this.map.focusHere(this.here); return; }

    const est = this.estimateRemain(this.here);
    this.updateHUD(est.meters, est.eta);

    // 到着磨き：50m 予告 → 20m 到着
    if (!this.arrivalPreviewed && est.meters <= 50){ this.arrivalPreviewed = true; this.speak('まもなく目的地に到着します'); }
    if (est.meters <= 20){ this.speak('目的地に到着しました'); toast('到着しました。おつかれさまにゃ'); this.stop(); return; }

    // 次ステップ案内 + 進行カード更新
    const idx = nearestIndex(this.here, this.routeCoords);
    let nextIdx = -1;
    for (let i=0;i<this.steps.length;i++){ const wp=this.steps[i]?.way_points?.[1]; if (typeof wp==="number" && wp>idx){ nextIdx=i; break; } }
    if (nextIdx>=0){
      const step=this.steps[nextIdx], wp=step.way_points[1];
      const remainToNext=hav(this.here, this.routeCoords[wp]);

      // 300mカード表示・更新
      if (remainToNext <= CONST.PREVIEW_M + 20){ this.showManeuver(step, remainToNext); this.currentManIdx = nextIdx; }
      else { this.hideManeuver(); this.currentManIdx = -1; }

      // 音声：300m予告（重複抑制）
      if(!this.stepPreviewed.has(nextIdx) && remainToNext<=CONST.PREVIEW_M){
        const key=`${wp}:${(step.instruction||'').trim()}`, now=Date.now(), last=this.previewHistory.get(key)||0;
        if(now-last>=CONST.PREVIEW_COOLDOWN_MS){ this.stepPreviewed.add(nextIdx); this.previewHistory.set(key, now); this.speak(`300メートル先、${step.instruction||'進行方向です'}`); }
      }
      // 直前案内
      if(remainToNext<=CONST.EXECUTE_M){ this.speak(step.instruction||'その先です'); this.hideManeuver(); }
    } else {
      this.hideManeuver();
    }

    // オフルート → ヒステリシス → リルート
    const off = minDistanceToPolyline(this.here, this.routeCoords);
    if (off > CONST.OFF_ROUTE_METERS) this.offRouteCount++; else this.offRouteCount = 0;
    const nowT = Date.now();
    if (this.offRouteCount >= CONST.OFF_ROUTE_HYST_COUNT && (nowT - this.lastRerouteAt) >= CONST.REROUTE_COOLDOWN_MS){
      this.lastRerouteAt = nowT;
      this.setStatus(`コース外 ${off|0}m → リルート中…`);
      const avoidTolls = getSettings().avoidTolls;
      this.fetchRoute(this.here, this.goal, { avoidTolls })
        .then(d=>{ const f=d.features[0]; this.setupGuidance(f); this.speak('ルートを再検索しました'); })
        .catch(console.error);
    }
  }
}
