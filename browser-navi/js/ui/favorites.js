import { StorageKeys, loadList, saveList, trimMax, upsertPlace, makePlaceId } from '../settings.js';
import { HISTORY_MAX, FAVORITES_MAX, MERGE_DISTANCE_M } from '../../config.js';
import { $ } from './dom.js';
import { setGoalAndMaybeStart } from '../nav.js';

// Optional: normalize legacy names on render (convert comma style to Japanese)
function formatAddressJa(raw) {
  if (!raw) return '';
  // If already looks Japanese-ordered, keep it
  if (/(都|道|府|県).*(市|区)/.test(raw)) return raw;

  const parts = String(raw).split(',').map(s => s.trim()).filter(Boolean);
  const cleaned = parts.filter(s => s !== '日本' && !/^\d{3}-\d{4}$/.test(s));
  const pref = cleaned.find(s => /(都|道|府|県)$/.test(s));
  const city = cleaned.find(s => s.endsWith('市'));
  const ward = cleaned.find(s => s.endsWith('区'));
  const town = cleaned.find(s => /(丁目|町|村)$/.test(s));
  const poi  = cleaned[0];

  const uniq = [];
  for (const v of [pref, city, ward, town]) {
    if (v && !uniq.includes(v)) uniq.push(v);
  }
  const core = uniq.join('');
  if (poi && !uniq.includes(poi)) return core ? `${core} ${poi}` : poi;
  return core || cleaned.join(' ');
}

const els = {
  favoritesList: $('favorites-list'),
  historyList: $('history-list'),
  historyClear: $('history-clear'),
};

export function renderQuickLists(){
  if (!els.favoritesList || !els.historyList) return;
  const favs = loadList(StorageKeys.FAVORITES);
  const hist = loadList(StorageKeys.HISTORY);

  const favHtml = (favs && favs.length)
    ? favs.map((p,i)=>chipHtml(p,i,true)).join('')
    : '<div class="sr-empty">お気に入りはまだありません</div>';

  const histHtml = (hist && hist.length)
    ? hist.map((p,i)=>chipHtml(p,i,false)).join('')
    : '<div class="sr-empty">履歴はまだありません</div>';

  els.favoritesList.innerHTML = favHtml;
  els.historyList.innerHTML   = histHtml;

  (els.favoritesList.querySelectorAll('.act-start') ?? []).forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const idx = Number(btn.dataset.idx);
      const p = loadList(StorageKeys.FAVORITES)[idx]; if (!p) return;
      setGoalAndMaybeStart(p);
    });
  });
  (els.historyList.querySelectorAll('.act-start') ?? []).forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const idx = Number(btn.dataset.idx);
      const p = loadList(StorageKeys.HISTORY)[idx]; if (!p) return;
      setGoalAndMaybeStart(p);
    });
  });

  [...els.favoritesList.querySelectorAll('.act-fav'), ...els.historyList.querySelectorAll('.act-fav')].forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const k = btn.dataset.key; const idx = Number(btn.dataset.idx);
      const key = k==='fav' ? StorageKeys.FAVORITES : StorageKeys.HISTORY;
      const list = loadList(key);
      const p = list[idx]; if (!p) return;
      toggleFavorite(p);
      renderQuickLists();
    });
  });

  [...els.favoritesList.querySelectorAll('.act-del'), ...els.historyList.querySelectorAll('.act-del')].forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const k = btn.dataset.key; const idx = Number(btn.dataset.idx);
      const key = k==='fav' ? StorageKeys.FAVORITES : StorageKeys.HISTORY;
      const list = loadList(key);
      list.splice(idx,1); saveList(key, list);
      renderQuickLists();
    });
  });

  if (els.historyClear && !els.historyClear._svnBound){
    els.historyClear._svnBound = true;
    els.historyClear.addEventListener('click', ()=>{
      saveList(StorageKeys.HISTORY, []); renderQuickLists();
    });
  }
}

function chipHtml(place, idx, isFav) {
  // name only (no lat/lng meta)
  const name = escapeHtml(formatAddressJa(place.name || '目的地'));
  const star = isFavorite(place) ? '★' : '☆';
  return `
    <div class="svn-chip">
      <div>${name}</div>
      <div class="actions">
        <button class="svn-iconbtn act-start" title="Start" data-idx="${idx}">▶</button>
        <button class="svn-iconbtn act-fav" title="Favorite" data-key="${isFav?'fav':'hist'}" data-idx="${idx}">${star}</button>
        <button class="svn-iconbtn act-del" title="Delete" data-key="${isFav?'fav':'hist'}" data-idx="${idx}">✕</button>
      </div>
    </div>
  `;
}

function escapeHtml(s){ return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

export function toggleFavorite(place) {
  const favs = loadList(StorageKeys.FAVORITES);
  const id = place.id || makePlaceId(place.lat, place.lng);
  const idx = favs.findIndex(p => (p.id || makePlaceId(p.lat, p.lng)) === id);
  if (idx >= 0) { favs.splice(idx, 1); }
  else {
    // ensure name formatted on save
    const name = formatAddressJa(place.name || '目的地');
    favs.unshift({ ...place, name, id, addedAt: Date.now() });
    trimMax(favs, FAVORITES_MAX);
  }
  saveList(StorageKeys.FAVORITES, favs);
}

export function isFavorite(place) {
  const favs = loadList(StorageKeys.FAVORITES);
  const id = place.id || makePlaceId(place.lat, place.lng);
  return favs.some(p => (p.id || makePlaceId(p.lat, p.lng)) === id);
}

export function addHistory(place) {
  const hist = loadList(StorageKeys.HISTORY);
  const now = Date.now();
  const withId = {
    ...place,
    name: formatAddressJa(place.name || '目的地'),
    id: place.id || makePlaceId(place.lat, place.lng),
    ts: now
  };
  const merged = upsertPlace(hist, withId, MERGE_DISTANCE_M);
  trimMax(merged, HISTORY_MAX);
  saveList(StorageKeys.HISTORY, merged);
}
