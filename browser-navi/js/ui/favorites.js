// お気に入り/履歴（settings.js 現行API対応）
import { toast } from './dom.js';
import {
  StorageKeys, loadList, saveList, upsertPlace, trimMax, makePlaceId
} from '../settings.js';

function loadFavorites() { return loadList(StorageKeys.FAVORITES) || []; }
function loadHistory()   { return loadList(StorageKeys.HISTORY)   || []; }
function saveFavorites(a){ saveList(StorageKeys.FAVORITES, a); }
function saveHistory(a)  { saveList(StorageKeys.HISTORY,   a); }

function normalizePlace(p) {
  const lat = Number(p.lat), lng = Number(p.lng);
  return { id: p.id || makePlaceId(lat, lng), name: p.name || '目的地', lat, lng, ts: p.ts || Date.now() };
}

export function isFavorite(item) {
  const favs = loadFavorites();
  const t = normalizePlace(item);
  return favs.some(f => f.id === t.id);
}

export function toggleFavorite(item) {
  const favs = loadFavorites();
  const t = normalizePlace(item);
  const idx = favs.findIndex(f => f.id === t.id);
  if (idx >= 0) { favs.splice(idx, 1); toast('お気に入りから削除しました'); }
  else          { favs.unshift(t);     toast('お気に入りに追加しました'); }
  saveFavorites(favs);
}

export function addHistory(item) {
  // 完全重複（id or name+lng+lat）は1件に
  const hist = loadHistory();
  const p = normalizePlace(item);
  const merged = hist.filter(h => !(h.id === p.id || (h.name === p.name && h.lng === p.lng && h.lat === p.lat)));
  merged.unshift(p);
  trimMax(merged, 30);
  saveHistory(merged);
}

function renderList(container, items, opt = {}) {
  if (!container) return;
  container.innerHTML = '';
  if (!Array.isArray(items) || !items.length) {
    container.innerHTML = '<li class="empty">項目がありません</li>';
    return;
  }

  for (const it of items) {
    const li = document.createElement('li');
    li.className = 'poi';
    li.dataset.name = it.name || '';
    li.dataset.lng = String(it.lng);
    li.dataset.lat = String(it.lat);

    // 1行目：住所フル
    const name = document.createElement('div');
    name.className = 'poi-name';
    name.textContent = it.name || '(名称未設定)';

    // 2行目：ボタン群
    const actions = document.createElement('div');
    actions.className = 'poi-actions';

    const go = document.createElement('button');
    go.className = 'fav-go'; go.dataset.action = 'start';
    go.setAttribute('aria-label', 'start');
    go.title = 'この目的地で開始'; go.textContent = '▶';

    const star = document.createElement('button');
    star.className = 'fav-star'; star.title = 'お気に入りに追加/削除';
    star.textContent = opt.type === 'favorites' ? '★' : '☆';
    star.addEventListener('click', (e)=>{ e.preventDefault(); e.stopPropagation(); toggleFavorite(it); renderQuickLists(); });

    const del = document.createElement('button');
    del.className = 'fav-del'; del.title = 'この項目を削除'; del.textContent = '🗑';
    del.addEventListener('click', (e)=> {
      e.preventDefault(); e.stopPropagation();
      if (opt.type === 'favorites') {
        const favs = loadFavorites(); const i = favs.findIndex(f=>f.id===it.id);
        if (i>=0){ favs.splice(i,1); saveFavorites(favs); }
      } else {
        const hist = loadHistory(); const i = hist.findIndex(h=>h.id===it.id);
        if (i>=0){ hist.splice(i,1); saveHistory(hist); }
      }
      renderQuickLists();
    });

    actions.appendChild(go); actions.appendChild(star); actions.appendChild(del);
    li.appendChild(name); li.appendChild(actions);
    container.appendChild(li);
  }
}

export function renderQuickLists(){
  const els = { fav: document.getElementById('favorites-list'), his: document.getElementById('history-list') };
  renderList(els.fav, loadFavorites(), { type: 'favorites' });
  renderList(els.his, loadHistory(),   { type: 'history' });
}
