import { StorageKeys, loadList, saveList, trimMax, upsertPlace, makePlaceId } from '../settings.js';
import { HISTORY_MAX, FAVORITES_MAX, MERGE_DISTANCE_M } from '../../config.js';
import { $ } from './dom.js';
import { setGoalAndMaybeStart } from '../nav.js';

const els = {
  favoritesList: $('favorites-list'),
  historyList: $('history-list'),
  historyClear: $('history-clear'),
};

export function renderQuickLists(){
  if (!els.favoritesList || !els.historyList) return;
  const favs = loadList(StorageKeys.FAVORITES);
  const hist = loadList(StorageKeys.HISTORY);
  els.favoritesList.innerHTML = favs.map((p,i)=>chipHtml(p,i,true)).join('') || '<div class="sr-empty">お気に入りはまだありません</div>';
  els.historyList.innerHTML   = hist.map((p,i)=>chipHtml(p,i,false)).join('') || '<div class="sr-empty">履歴はまだありません</div>';

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

function chipHtml(p, idx, isFav) {
  const star = isFavorite(p) ? '★' : '☆';
  const name = escapeHtml(p.name || '目的地');
  return `
    <div class="svn-chip">
      <div>
        <div>${name}</div>
        <div class="meta">${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}</div>
      </div>
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
    favs.unshift({ ...place, id, addedAt: Date.now() });
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
  const withId = { ...place, id: place.id || makePlaceId(place.lat, place.lng), ts: now };
  const merged = upsertPlace(hist, withId, MERGE_DISTANCE_M);
  trimMax(merged, HISTORY_MAX);
  saveList(StorageKeys.HISTORY, merged);
}
