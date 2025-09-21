import { API_BASE } from '../../config.js';
import { $, forceOpen, forceClose, toast } from './dom.js';

function formatJapaneseAddress(a = {}, fallback = '') {
  const pref = a.state || a.province || a.prefecture || '';
  const city = a.city || a.town || a.village || '';
  const ward = a.ward || a.district || a.county || '';
  const block = a.suburb || a.neighbourhood || a.quarter || '';
  const road = a.road || a.footway || '';
  const house = a.house_number || '';
  const poi = a.public_building || a.school || a.hospital || a.amenity || a.building || a.shop || a.attraction || '';
  const line1 = [pref, city, ward, block, road].filter(Boolean).join('');
  const line2 = [house, poi].filter(Boolean).join(' ');
  const s = [line1, line2].filter(Boolean).join(' ');
  return s || fallback;
}
function distanceKm([lng1, lat1], [lng2, lat2]) {
  const R=6371, toRad=(d)=>d*Math.PI/180;
  const dLat=toRad(lat2-lat1), dLng=toRad(lng2-lng1);
  const a=Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLng/2)**2;
  return 2*R*Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}
function scoreForResult(item){
  const t = (item.addresstype || item.type || '').toLowerCase();
  const cat = (item.category || '').toLowerCase();
  const isAddress = ['house','residential','yes','building','postcode','block','neighbourhood'].includes(t) || cat==='place';
  const isRoad = t==='road' || cat==='highway';
  return isAddress ? 100 : (isRoad ? 80 : 60);
}

// ▼ これで置き換え
async function searchNominatim(q, nearLngLat) {
  const base = new URLSearchParams();
  base.set('text', q);         // Workers 側で Nominatim の q に橋渡し
  base.set('limit', '15');
  base.set('lang', 'ja');
  base.set('country', 'jp');
  base.set('addr', '1');

  // 住所っぽいか（数字や丁目が含まれる？）
  const looksAddress = /[0-9０-９\-ー−‐]|丁目|番地|号/.test(q);

  // 1) まず全国フリー検索（バイアスを付けない）
  let params1 = new URLSearchParams(base);
  let r = await fetch(`${API_BASE}/geocode?${params1.toString()}`);
  let json = r.ok ? await r.json() : [];
  let arr = Array.isArray(json) ? json : (json?.results || json?.features || []);

  // 2) 0件なら近傍バイアス付きで再検索（地図中心がある場合のみ）
  if ((!arr || !arr.length) && nearLngLat && Number.isFinite(nearLngLat[0]) && Number.isFinite(nearLngLat[1])) {
    const params2 = new URLSearchParams(base);
    params2.set('ll', `${nearLngLat[0]},${nearLngLat[1]}`);
    params2.set('bias', '1'); // Workers が viewbox+bounded=1 を付与
    r = await fetch(`${API_BASE}/geocode?${params2.toString()}`);
    json = r.ok ? await r.json() : [];
    arr = Array.isArray(json) ? json : (json?.results || json?.features || []);
  }

  // 3) まだ0件 かつ 住所っぽい入力のときは structured=1 で再検索（番地に強い）
  if ((!arr || !arr.length) && looksAddress) {
    const params3 = new URLSearchParams(base);
    if (nearLngLat && Number.isFinite(nearLngLat[0]) && Number.isFinite(nearLngLat[1])) {
      params3.set('ll', `${nearLngLat[0]},${nearLngLat[1]}`); // スコア付け用に渡すだけ
    }
    params3.set('structured', '1');
    r = await fetch(`${API_BASE}/geocode?${params3.toString()}`);
    json = r.ok ? await r.json() : [];
    arr = Array.isArray(json) ? json : (json?.results || json?.features || []);
  }

  return arr || [];
}

export function setupSearch(els, mapCtrl){
  const state = { goalLngLat: null, nearLngLat: null };

  function getCenter() {
    try {
      const c = mapCtrl?.getCenter?.();
      if (c && Number.isFinite(c.lng) && Number.isFinite(c.lat)) return [c.lng, c.lat];
    } catch {}
    return null;
  }

  async function onSearch(){
    const input = els.addr?.value?.trim();
    if (!input) { toast('住所や施設名を入力してください'); return; }
    forceOpen(els.searchCard);
    state.nearLngLat = getCenter();

    let results = [];
    try { results = await searchNominatim(input, state.nearLngLat); }
    catch(e){ console.warn('geocode error', e); toast('検索に失敗しました'); return; }

    const list = (results || []).map(r => {
      const lat = Number(r.lat ?? r.y ?? r.geometry?.coordinates?.[1]);
      const lng = Number(r.lon ?? r.x ?? r.geometry?.coordinates?.[0]);
      const name = formatJapaneseAddress(r.address || {}, r.display_name || r.name || '');
      const cand = { name, lat, lng, raw: r, score: scoreForResult(r) };
      if (state.nearLngLat && Number.isFinite(lat) && Number.isFinite(lng)) {
        cand.__distanceKm = distanceKm(state.nearLngLat, [lng, lat]);
        cand.score += Math.max(0, 30 - Math.min(30, cand.__distanceKm));
      }
      return cand;
    }).filter(c => c.name && Number.isFinite(c.lat) && Number.isFinite(c.lng));

    // 座標重複の除去（≈10cm）
    const seen = new Set();
    const deduped = list.filter(c => {
      const key = `${c.lng.toFixed(6)},${c.lat.toFixed(6)}`;
      if (seen.has(key)) return false; seen.add(key); return true;
    }).sort((a,b)=>b.score-a.score).slice(0,15);

    renderCandidates(deduped);
  }

  function renderCandidates(list){
    const ul = els.searchList; if (!ul) return;
    ul.innerHTML = '';
    if (!list.length) { ul.innerHTML = '<li class="empty">候補が見つかりません。地名から徐々に細かく入れてみて</li>'; return; }

    for (const c of list) {
      const li = document.createElement('li');
      li.className = 'cand';
      li.innerHTML = `
        <div class="cand-title">${c.name}</div>
        ${typeof c.__distanceKm === 'number' ? `<div class="cand-sub">${c.__distanceKm.toFixed(1)} km 以内</div>` : ''}
      `;
      // ★ 1タップ即決＆即クローズ（pointerdown/capture）
      li.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        state.goalLngLat = [c.lng, c.lat];
        if (els.addr) els.addr.value = c.name;
        forceClose(els.searchCard);
        toast('目的地をセットしたにゃ');
      }, { capture: true });
      ul.appendChild(li);
    }
  }

  async function onFavCurrent(){
    if (!state.goalLngLat || !els.addr?.value) { toast('まず目的地を検索してください'); return; }
    const [lng, lat] = state.goalLngLat;
    window.__lastSelectedGoal = { name: els.addr.value, lng, lat };
    toast('現在の目的地を☆登録したにゃ（メニュー→お気に入り）');
  }

  return { onSearch, onFavCurrent, state };
}
