// お気に入り/履歴のレンダリング＋操作ユーティリティ（settings.js 現行API対応版）
import { toast } from './dom.js';
import {
  StorageKeys,        // { FAVORITES, HISTORY }
  loadList, saveList, // listの永続化
  upsertPlace,        // 距離マージ付きの履歴追加
  trimMax,            // 最大件数カット
  makePlaceId         // 安定ID作成（lat/lngを丸め）
} from '../settings.js';

// ---- モデル -------------------------------------------------

function loadFavorites() { return loadList(StorageKeys.FAVORITES) || []; }
function loadHistory()   { return loadList(StorageKeys.HISTORY)   || []; }

function saveFavorites(arr) { saveList(StorageKeys.FAVORITES, arr); }
function saveHistory(arr)   { saveList(StorageKeys.HISTORY,   arr); }

// place: { name, lat, lng, id?, ts? }
function normalizePlace(p) {
  const lat = Number(p.lat), lng = Number(p.lng);
  return {
    id: p.id || makePlaceId(lat, lng),
    name: p.name || '目的地',
    lat, lng,
    ts: p.ts || Date.now()
  };
}

// ---- 判定／更新 -------------------------------------------------

export function isFavorite(item) {
  const favs = loadFavorites();
  const target = normalizePlace(item);
  return favs.some(f => f.id === target.id);
}

export function toggleFavorite(item) {
  const favs = loadFavorites();
  const target = normalizePlace(item);
  const idx = favs.findIndex(f => f.id === target.id);

  if (idx >= 0) {
    favs.splice(idx, 1);
    toast('お気に入りから削除したにゃ');
  } else {
    favs.unshift(target);
    toast('お気に入りに追加したにゃ');
  }
  saveFavorites(favs);
}

export function addHistory(item) {
  // 既存地点と近接(≈1m〜数十m)なら上書き、なければ先頭追加
  const hist = loadHistory();
  const target = normalizePlace(item);
  const merged = upsertPlace(hist, target, /*mergeDistanceM*/ 30);
  trimMax(merged, 30);
  saveHistory(merged);
}

// ---- レンダリング -------------------------------------------------

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

    // 開始（▶）
    const go = document.createElement('button');
    go.className = 'fav-go';
    go.dataset.action = 'start';
    go.setAttribute('aria-label', 'start');
    go.title = 'この目的地で開始';
    go.textContent = '▶';

    // 名称
    const name = document.createElement('span');
    name.className = 'poi-name';
    name.textContent = it.name || '(名称未設定)';

    // お気に入りトグル（★/☆）
    const star = document.createElement('button');
    star.className = 'fav-star';
    star.title = 'お気に入りに追加/削除';
    star.textContent = opt.type === 'favorites' ? '★' : '☆';
    star.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      toggleFavorite(it);
      renderQuickLists(); // 再描画
    });

    // 削除（🗑）
    const del = document.createElement('button');
    del.className = 'fav-del';
    del.title = 'この項目を削除';
    del.textContent = '🗑';
    del.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (opt.type === 'favorites') {
        const favs = loadFavorites();
        const i = favs.findIndex(f => f.id === it.id);
        if (i >= 0) { favs.splice(i, 1); saveFavorites(favs); }
      } else if (opt.type === 'history') {
        const hist = loadHistory();
        const i = hist.findIndex(h => h.id === it.id);
        if (i >= 0) { hist.splice(i, 1); saveHistory(hist); }
      }
      renderQuickLists();
    });

    li.appendChild(go);
    li.appendChild(name);
    li.appendChild(star);
    li.appendChild(del);
    container.appendChild(li);
  }
}

export function renderQuickLists() {
  const els = {
    fav: document.getElementById('favorites-list'),
    his: document.getElementById('history-list'),
  };
  const favs = loadFavorites();
  const hist = loadHistory();

  renderList(els.fav, favs, { type: 'favorites' });
  renderList(els.his, hist, { type: 'history' });
}
