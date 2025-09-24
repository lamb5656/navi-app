import { API_BASE } from '../../config.js';
import { $, forceOpen, forceClose, toast } from './dom.js';

function normalizeJaAddress(input) {
  if (!input) return '';
  const z2h = s => s.replace(/[０-９Ａ-Ｚａ-ｚ]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));
  let q = z2h(input).trim();
  q = q.replace(/[ー―－‐−]/g, '-').replace(/\s+/g, ' ');
  q = q.replace(/(?<=市|区|町)(\d+)-/u, (_m, n) => `${n}丁目-`);
  q = q.replace(/(?<=市|区|町)\s*(\d+)\s+(?=\d)/u, (_m, n) => `${n}丁目 `);
  return q;
}

async function fetchJson(url, opt = {}, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal, ...opt });
    if (!r.ok) return { ok: false, status: r.status, data: null };
    const data = await r.json().catch(() => null);
    return { ok: true, status: r.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  } finally {
    clearTimeout(id);
  }
}

function formatJapaneseAddress(a = {}, fallback = '') {
  const pref = a.state || a.province || a.prefecture || '';
  const city = a.city || a.town || a.village || '';
  const ward = a.ward || a.district || a.county || a.city_district || '';
  const block = a.suburb || a.neighbourhood || a.quarter || a.district || a.hamlet || '';
  const road = a.road || a.pedestrian || a.footway || '';
  const house = a.house_number || '';
  const poi = a.public_building || a.school || a.hospital || a.amenity || a.building || a.shop || a.attraction || '';
  const line1 = [pref, city, ward, block, road].filter(Boolean).join('');
  const line2 = [house, poi].filter(Boolean).join(' ');
  const s = [line1, line2].filter(Boolean).join(' ');
  return s || fallback;
}

function distanceKm([lng1, lat1], [lng2, lat2]) {
  const R = 6371, toRad = (d) => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function scoreForResult(item) {
  const t = (item.addresstype || item.type || '').toLowerCase();
  const cat = (item.category || '').toLowerCase();
  const isAddress = ['house', 'residential', 'yes', 'building', 'railway', 'highway']
    .some(x => t.includes(x) || cat.includes(x));
  return (isAddress ? 100 : 0) + (item.importance ? item.importance * 10 : 0);
}

function toArray(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.features)) return data.features;
  if (data && Array.isArray(data.results)) return data.results;
  return [];
}

function extractRecord(r) {

  if (r && r.type === 'Feature') {
    const c = r.geometry && Array.isArray(r.geometry.coordinates) ? r.geometry.coordinates : [NaN, NaN];
    const p = r.properties || {};
    return {
      lat: Number(c[1]),
      lon: Number(c[0]),
      address: p.address || {},
      display_name: p.display_name || '',
      name: p.name || '',
      addresstype: p.addresstype || p.type || '',
      category: p.category || '',
      type: p.type || '',
      importance: p.importance || 0
    };
  }

  return {
    lat: Number(r.lat ?? r.y ?? (r.geometry && r.geometry.coordinates && r.geometry.coordinates[1])),
    lon: Number(r.lon ?? r.x ?? (r.geometry && r.geometry.coordinates && r.geometry.coordinates[0])),
    address: r.address || {},
    display_name: r.display_name || '',
    name: r.name || '',
    addresstype: r.addresstype || r.type || '',
    category: r.category || '',
    type: r.type || '',
    importance: r.importance || 0
  };
}

async function searchNominatim(rawInput, nearLngLat) {
  const q = normalizeJaAddress(rawInput);

  const base = new URLSearchParams();
  base.set('text', q);
  base.set('limit', '15');
  base.set('lang', 'ja');
  base.set('country', 'jp');
  base.set('addr', '1');

  const looksAddress = /[0-9\-]|丁目|番地|号/.test(q);

  let { ok, status, data } = await fetchJson(`${API_BASE}/geocode?${base.toString()}`);
  let arr = toArray(data);

  if ((!arr || !arr.length) && nearLngLat && Number.isFinite(nearLngLat[0]) && Number.isFinite(nearLngLat[1])) {
    const p2 = new URLSearchParams(base);
    p2.set('ll', `${nearLngLat[0]},${nearLngLat[1]}`);
    p2.set('bias', '1');
    ({ ok, status, data } = await fetchJson(`${API_BASE}/geocode?${p2.toString()}`));
    arr = toArray(data);
  }

  if ((!arr || !arr.length) && looksAddress) {
    const p3 = new URLSearchParams(base);
    p3.set('structured', '1');
    if (nearLngLat && Number.isFinite(nearLngLat[0]) && Number.isFinite(nearLngLat[1])) {
      p3.set('ll', `${nearLngLat[0]},${nearLngLat[1]}`);
    }
    ({ ok, status, data } = await fetchJson(`${API_BASE}/geocode?${p3.toString()}`));
    arr = toArray(data);
  }

  if (!arr || !arr.length) {
    const qParams = new URLSearchParams();
    qParams.set('q', q);
    qParams.set('format', 'jsonv2');
    qParams.set('limit', '15');
    qParams.set('addressdetails', '1');
    qParams.set('accept-language', 'ja');
    qParams.set('countrycodes', 'jp');
    if (nearLngLat && Number.isFinite(nearLngLat[0]) && Number.isFinite(nearLngLat[1])) {
      const [lng, lat] = nearLngLat;
      const box = 0.5;
      qParams.set('viewbox', `${lng - box},${lat + box},${lng + box},${lat - box}`);
      qParams.set('bounded', '0');
    }
    const res = await fetchJson(`https://nominatim.openstreetmap.org/search?${qParams.toString()}`);
    if (res.ok && Array.isArray(res.data)) {
      arr = res.data.map(r => ({
        lat: r.lat, lon: r.lon,
        display_name: r.display_name,
        address: r.address || {},
        addresstype: r.addresstype || r.type || '',
        category: r.category || '',
        type: r.type || '',
        importance: r.importance || 0
      }));
    }
  }

  return arr || [];
}

export function setupSearch(els, mapCtrl) {
  const state = { goalLngLat: null, nearLngLat: null };

  function getCenter() {
    try {
      const c = mapCtrl?.getCenter?.();
      if (c && Number.isFinite(c.lng) && Number.isFinite(c.lat)) return [c.lng, c.lat];
    } catch {}
    return null;
  }

  async function onSearch() {
    const input = els.addr?.value?.trim();
    if (!input) { toast('住所や施設名を入力してください'); return; }
    forceOpen(els.searchCard);
    state.nearLngLat = getCenter();

    let rawResults = [];
    try { rawResults = await searchNominatim(input, state.nearLngLat); }
    catch (e) { console.warn('geocode error', e); toast('検索に失敗しました'); return; }

    const list = (rawResults || []).map(r0 => {
      const r = extractRecord(r0);
      const lat = Number(r.lat);
      const lng = Number(r.lon);
      const fallback = r.display_name || r.name || '';
      let name = formatJapaneseAddress(r.address || {}, fallback).trim();
      if (!name) name = fallback;
      if (!name && Number.isFinite(lat) && Number.isFinite(lng)) {
        name = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
      }
      const cand = { name, lat, lng, raw: r, score: scoreForResult(r) };
      if (state.nearLngLat && Number.isFinite(lat) && Number.isFinite(lng)) {
        cand.__distanceKm = distanceKm(state.nearLngLat, [lng, lat]);
      }
      return cand;
    }).filter(x => Number.isFinite(x.lat) && Number.isFinite(x.lng));

    list.sort((a, b) => (b.score - a.score) || ((a.__distanceKm || 0) - (b.__distanceKm || 0)));

    renderList(list);
  }

  function renderList(items) {
    const ul = els.searchList;
    ul.innerHTML = '';
    if (!items || !items.length) {
      const li = document.createElement('li');
      li.textContent = '候補が見つかりませんでした';
      ul.appendChild(li);
      return;
    }
    for (const it of items) {
      const li = document.createElement('li');
      li.className = 'search-item';

      const line1 = document.createElement('div');
      line1.className = 'addr-line1';
      line1.textContent = it.name || '(no name)';

      const line2 = document.createElement('div');
      line2.className = 'addr-line2';
      const btn = document.createElement('button');
      btn.className = 'btn-choose';
      btn.textContent = 'ここに行く';
      if (Number.isFinite(it.__distanceKm)) {
        const span = document.createElement('span');
        span.className = 'meta';
        span.textContent = ` / ${it.__distanceKm.toFixed(1)}km`;
        line2.appendChild(span);
      }
      line2.appendChild(btn);

      li.appendChild(line1);
      li.appendChild(line2);

      li.addEventListener('click', (ev) => {
        if (ev.target.tagName === 'BUTTON' || ev.currentTarget === li) {
          const { lat, lng } = it;
          els.addr.value = it.name;
          state.goalLngLat = [lng, lat];
          try { mapCtrl?.setGoal?.(lng, lat); } catch {}
          forceClose(els.searchCard);
          toast('目的地をセットしました');
        }
      }, { capture: true });

      ul.appendChild(li);
    }
  }

  async function onFavCurrent() {
    if (!state.goalLngLat || !els.addr?.value) { toast('まず目的地を検索してください'); return; }
    const [lng, lat] = state.goalLngLat;
    window.__lastSelectedGoal = { name: els.addr.value, lng, lat };
    toast('現在の目的地をお気に入りに登録しました（メニュー→お気に入り）');
  }

  return { onSearch, onFavCurrent, state };
}
