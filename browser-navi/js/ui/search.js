// /browser-navi/js/ui/search.js
import { API_BASE } from '../../config.js';
import { $, forceOpen, forceClose, toast } from './dom.js';

const addrKeys = ['house_number', 'postcode', 'state', 'region', 'province', 'county', 'city', 'town', 'village', 'suburb', 'neighbourhood', 'ward', 'quarter', 'district', 'place', 'municipality', 'hamlet', 'island'];
const jpKeys = ['state', 'prefecture', 'province', 'city', 'ward', 'county', 'town', 'village', 'suburb', 'neighbourhood', 'quarter', 'district', 'postcode'];

function formatJapaneseAddress(a = {}, fallback = '') {
  // Nominatimのaddressを日本式に並べ替え
  const pref = a.state || a.province || a.prefecture || '';
  const city = a.city || a.town || a.village || '';
  const ward = a.ward || a.district || a.county || '';
  const block = a.suburb || a.neighbourhood || a.quarter || '';
  const road = a.road || a.footway || '';
  const chome = a.neighbourhood?.match(/(\d+)丁目/) ? a.neighbourhood : (a.suburb?.match(/(\d+)丁目/) ? a.suburb : '');
  const house = a.house_number || '';
  const poi = a.public_building || a.school || a.hospital || a.amenity || a.building || a.shop || a.attraction || '';

  // 「愛知県名古屋市中村区名駅一丁目 名古屋駅」のような並び
  const line1 = [pref, city, ward, block || chome, road].filter(Boolean).join('');
  const line2 = [house, poi].filter(Boolean).join(' ');
  const s = [line1, line2].filter(Boolean).join(' ');
  return s || fallback;
}

function scoreForResult(r) {
  // 住所を最優先、次に道路、その次にPOI
  const t = (r.addresstype || r.type || '').toLowerCase();
  const cat = (r.category || '').toLowerCase();
  const isAddress = ['house', 'residential', 'yes', 'building', 'postcode', 'block', 'neighbourhood'].includes(t) || cat === 'place';
  const isRoad = t === 'road' || cat === 'highway';
  let base = isAddress ? 100 : (isRoad ? 80 : 60);
  // 近さで加点（llが来ていれば）
  if (typeof r.__distanceKm === 'number') {
    const d = r.__distanceKm;
    base += Math.max(0, 30 - Math.min(30, d)); // 0–30kmを最大+30点
  }
  return base;
}

function distanceKm([lng1, lat1], [lng2, lat2]) {
  const R = 6371;
  const toRad = (d) => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function searchNominatim(q, nearLngLat) {
  const params = new URLSearchParams();
  params.set('text', q);
  params.set('limit', '15');          // 候補多め
  params.set('lang', 'ja');           // 日本語優先
  params.set('country', 'jp');        // 日本国内を優先
  params.set('addr', '1');            // addressdetails=1
  if (nearLngLat && Number.isFinite(nearLngLat[0]) && Number.isFinite(nearLngLat[1])) {
    params.set('ll', `${nearLngLat[0]},${nearLngLat[1]}`); // 画面中心
    params.set('bias', '1');                                // 近場優先
  }
  const url = `${API_BASE}/geocode?${params.toString()}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error('geocode failed');
  const json = await r.json(); // プロキシ側でNominatimのjsonv2を返す想定
  const arr = Array.isArray(json) ? json : (json?.results || json?.features || []);
  return arr;
}

function toCandidate(item, nearLngLat) {
  // Nominatim jsonv2 互換：lat/lon, display_name, address, class/category/type
  const lat = Number(item.lat ?? item.y ?? item.geometry?.coordinates?.[1]);
  const lon = Number(item.lon ?? item.x ?? item.geometry?.coordinates?.[0]);
  const name = formatJapaneseAddress(item.address || {}, item.display_name || item.name || '');
  const dist = (nearLngLat && Number.isFinite(lat) && Number.isFinite(lon)) ? distanceKm(nearLngLat, [lon, lat]) : null;

  const c = {
    name,
    lat,
    lng: lon,
    raw: item,
    score: 0
  };
  if (dist != null) c.__distanceKm = dist;
  c.score = scoreForResult({ ...item, __distanceKm: dist });
  return c;
}

function dedupeByLngLat(list) {
  const seen = new Set();
  return list.filter(c => {
    if (!Number.isFinite(c.lat) || !Number.isFinite(c.lng)) return false;
    const key = `${c.lng.toFixed(6)},${c.lat.toFixed(6)}`; // ≈10cm
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function setupSearch(els, mapCtrl){
  const state = {
    goalLngLat: null,
    nearLngLat: null,
  };

  function getCenter() {
    try {
      const center = mapCtrl?.getCenter?.();
      if (center && Number.isFinite(center.lng) && Number.isFinite(center.lat)) {
        return [center.lng, center.lat];
      }
    } catch {}
    return null;
  }

  async function onSearch(){
    const input = els.addr?.value?.trim();
    if (!input) { toast('住所や施設名を入力してにゃ'); return; }

    forceOpen(els.searchCard);

    state.nearLngLat = getCenter();

    let results = [];
    try {
      results = await searchNominatim(input, state.nearLngLat);
    } catch (e) {
      console.warn('geocode error', e);
      toast('検索に失敗したにゃ…少し待って再度試してね');
      return;
    }

    // 整形 → 重複除去 → 住所優先で並べ替え
    let candidates = results.map(r => toCandidate(r, state.nearLngLat))
                            .filter(c => c.name && Number.isFinite(c.lat) && Number.isFinite(c.lng));
    candidates = dedupeByLngLat(candidates).sort((a, b) => b.score - a.score).slice(0, 15);

    renderCandidates(candidates);
  }

  function renderCandidates(list){
    const ul = els.searchList;
    if (!ul) return;

    ul.innerHTML = '';
    if (!list.length) {
      ul.innerHTML = '<li class="empty">候補が見つからないにゃ…番地まで入れるか、周辺に地図を寄せて再検索してみて</li>';
      return;
    }

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
    if (!state.goalLngLat || !els.addr?.value) {
      toast('まず目的地を検索してにゃ'); return;
    }
    // favorites.js 側で取り込む
    const [lng, lat] = state.goalLngLat;
    window.__lastSelectedGoal = { name: els.addr.value, lng, lat };
    toast('現在の目的地を☆登録したにゃ（メニュー→お気に入りを確認してね）');
  }

  return { onSearch, onFavCurrent, state };
}
