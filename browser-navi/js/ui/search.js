import { toast, forceOpen, forceClose } from './dom.js';
import { API_BASE } from '../../config.js';
import { withBackoff } from '../libs/net.js';
import { toggleFavorite } from './favorites.js';
import { renderQuickLists } from './favorites.js';

// Format "display_name" from Nominatim-like strings into Japanese order.
// Example: "名古屋駅, 名駅通, 名駅一丁目, 中村区, 名古屋市, 愛知県, 450-6013, 日本"
// -> "愛知県名古屋市中村区名駅一丁目 名古屋駅"
function formatAddressJa(raw) {
  if (!raw) return '';
  const parts = String(raw).split(',').map(s => s.trim()).filter(Boolean);

  // remove trailing "日本" and postal code like 123-4567
  const cleaned = parts.filter(s => s !== '日本' && !/^\d{3}-\d{4}$/.test(s));

  // heuristics
  const hasSuffix = (suf) => (s) => s.endsWith(suf);
  const pref   = cleaned.find(s => /(都|道|府|県)$/.test(s)); // 東京都, 北海道, 大阪府, 京都府, ～県
  const city   = cleaned.find(hasSuffix('市'));
  const ward   = cleaned.find(hasSuffix('区'));
  const town   = cleaned.find(s => /(丁目|町|村)$/.test(s));

  // POI (landmark) is often the first item
  const poi = cleaned[0];

  // Build core without duplicates
  const uniq = [];
  for (const v of [pref, city, ward, town]) {
    if (v && !uniq.includes(v)) uniq.push(v);
  }
  const core = uniq.join('');

  // If nothing matched, just fallback to joined string
  if (!core && poi) return poi;

  // Append POI at the end with a space
  if (poi && !uniq.includes(poi)) return `${core} ${poi}`;
  return core || cleaned.join(' ');
}

export function setupSearch(els, mapCtrl){
  const state = { goalLngLat: null };

  const normalizeGeocode = (data)=>{
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.results)) return data.results;
    if (Array.isArray(data?.data)) return data.data;
    if (Array.isArray(data?.features)) {
      return data.features.map(f=>{
        const c = f?.geometry?.coordinates;
        const props = f?.properties || {};
        return c && {
          lon: Number(c[0]),
          lat: Number(c[1]),
          display_name: props.display_name || props.name || ''
        };
      }).filter(Boolean);
    }
    if (Array.isArray(data?.items)) return data.items;
    if (Array.isArray(data?.places)) return data.places;
    if (Array.isArray(data?.nominatim)) return data.nominatim;
    return [];
  };

  async function geocode(text){
    const url = `${API_BASE}/geocode?text=${encodeURIComponent(text)}`;
    const res = await withBackoff(() => fetch(url, { headers: { Accept: 'application/json' } }), { retries: 1, base: 300 });
    if (!res.ok) throw new Error(`geocode http ${res.status}`);
    const data = await res.json();
    return normalizeGeocode(data);
  }

  function openSearch(){ forceOpen(els.searchCard); }
  function closeSearch(){ forceClose(els.searchCard); if (document.activeElement === els.addr) els.addr.blur(); }

  function renderSearchResults(items){
    if (!els.searchList) return;
    els.searchList.innerHTML = '';
    if (!Array.isArray(items) || !items.length){
      els.searchList.innerHTML = '<div class="sr-empty">候補がありません</div>';
      openSearch(); return;
    }

    for (const it of items){
      const rawName = it.display_name || it.name || it.label || '';
      const nameJa  = formatAddressJa(rawName) || '名称未設定';
      const lng  = Number(it.lon ?? it.lng ?? it.longitude ?? it.center?.[0]);
      const lat  = Number(it.lat ?? it.latitude ?? it.center?.[1]);
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;

      const btn  = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sr-item';
      btn.textContent = nameJa;
      btn.dataset.name = nameJa;
      btn.dataset.lng = String(lng);
      btn.dataset.lat = String(lat);

      let handled = false;
      const onPick = (e)=>{
        if (handled) return; handled = true;
        e.preventDefault(); e.stopPropagation();
        state.goalLngLat = [lng, lat];
        if (els.addr) { els.addr.value = nameJa; try{ els.addr.blur(); }catch{} }
        try {
          if (mapCtrl?.map) mapCtrl.map.easeTo({ center: state.goalLngLat, zoom: Math.max(mapCtrl.map.getZoom(), 14), duration: 400 });
        } catch {}
        closeSearch();
        toast('目的地を設定しました');
      };

      btn.addEventListener('pointerdown', onPick, { passive: false });
      els.searchList.appendChild(btn);
    }
    openSearch();
  }

  async function onSearch(){
    const q = (els.addr?.value || '').trim();
    if (!q){ toast('検索ワードを入力してください'); return; }
    if (els.searchList) els.searchList.innerHTML = '<div class="sr-loading">検索中…</div>';
    try {
      const items = await geocode(q);
      renderSearchResults(items);
    } catch (err) {
      console.error('[SVN] geocode error', err);
      if (els.searchList) els.searchList.innerHTML = '<div class="sr-error">検索に失敗しました</div>';
      openSearch();
    }
  }

  async function ensureGoalFromInput(){
    if (state.goalLngLat) return state.goalLngLat;
    const q = (els.addr?.value || '').trim();
    if (!q) return null;
    const items = await geocode(q);
    const it = items[0];
    if (!it) return null;
    state.goalLngLat = [Number(it.lon ?? it.lng), Number(it.lat)];
    if (els.addr) {
      const raw = it.display_name || els.addr.value;
      els.addr.value = formatAddressJa(raw) || raw;
    }
    return state.goalLngLat;
  }

  async function onFavCurrent(){
    const goal = state.goalLngLat || await ensureGoalFromInput();
    if (!goal){ toast('先に目的地を選んでにゃ'); return; }
    const name = (els.addr?.value || '目的地').trim();
    toggleFavorite({ name, lng: Number(goal[0]), lat: Number(goal[1]) });
    renderQuickLists();
    if (els.appMenu) els.appMenu.open = true;
    toast('お気に入りに登録したにゃ');
  }

  return {
    state,
    onSearch,
    openSearch,
    closeSearch,
    ensureGoalFromInput,
    onFavCurrent,
  };
}
