// /browser-navi/js/ui/search.js
import { toast, forceOpen, forceClose } from './dom.js';
import { API_BASE } from '../../config.js';
import { withBackoff } from '../libs/net.js';
import { toggleFavorite } from './favorites.js';

export function setupSearch(els, mapCtrl){
  const state = { goalLngLat: null }; // [lng, lat]

  const normalizeGeocode = (data)=>{
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.results)) return data.results;
    if (Array.isArray(data?.data)) return data.data;
    if (Array.isArray(data?.features)) {
      return data.features.map(f=>{
        const c = f?.geometry?.coordinates;
        return c && { lon: Number(c[0]), lat: Number(c[1]), display_name: f?.properties?.display_name || f?.properties?.name || '' };
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
      const name = it.display_name || it.name || it.label || '名称未設定';
      const lng  = Number(it.lon ?? it.lng ?? it.longitude ?? it.center?.[0]);
      const lat  = Number(it.lat ?? it.latitude ?? it.center?.[1]);
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;

      const btn  = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sr-item';
      btn.textContent = name;
      btn.dataset.name = name;
      btn.dataset.lng = String(lng);
      btn.dataset.lat = String(lat);

      let handled = false;
      const onPick = (e)=>{
        if (handled) return; handled = true;
        e.preventDefault(); e.stopPropagation();
        state.goalLngLat = [lng, lat];
        if (els.addr) els.addr.value = name;
        try {
          if (mapCtrl?.map) mapCtrl.map.easeTo({ center: state.goalLngLat, zoom: Math.max(mapCtrl.map.getZoom(), 14), duration: 400 });
        } catch {}
        closeSearch();
        toast('目的地を設定しました');
      };

      btn.addEventListener('pointerdown', onPick, { passive: false });
      btn.addEventListener('click', onPick, { passive: false });
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
    if (els.addr) els.addr.value = it.display_name || els.addr.value;
    return state.goalLngLat;
  }

  async function onFavCurrent(routeApi){
    const goal = state.goalLngLat || await ensureGoalFromInput();
    if (!goal){ toast('先に目的地を選んでにゃ'); return; }
    toggleFavorite({ name: (els.addr?.value || '目的地'), lng: Number(goal[0]), lat: Number(goal[1]) });
    // 目に見える反応
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
