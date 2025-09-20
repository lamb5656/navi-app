// お気に入り/履歴のレンダリング＋操作ユーティリティ
import { toast } from './dom.js';
import { getSettings, setSettings, makeId } from '../settings.js';

const LS_KEY = 'svn_settings'; // settings.js に合わせてる前提

function loadLists(){
  const s = getSettings() || {};
  return {
    favorites: Array.isArray(s.favorites) ? s.favorites : [],
    history:   Array.isArray(s.history)   ? s.history   : [],
  };
}
function saveLists({ favorites, history }){
  const s = getSettings() || {};
  s.favorites = favorites;
  s.history   = history;
  setSettings(s);
}

export function isFavorite(item){
  const { favorites } = loadLists();
  return !!favorites.find(f => f.lng === item.lng && f.lat === item.lat && f.name === item.name);
}

export function toggleFavorite(item){
  const lists = loadLists();
  const idx = lists.favorites.findIndex(f => f.lng === item.lng && f.lat === item.lat && f.name === item.name);
  if (idx >= 0) {
    lists.favorites.splice(idx, 1);
    toast('お気に入りから削除したにゃ');
  } else {
    lists.favorites.unshift({ id: makeId(), name: item.name, lng: Number(item.lng), lat: Number(item.lat) });
    toast('お気に入りに追加したにゃ');
  }
  saveLists(lists);
}

export function addHistory(item){
  const lists = loadLists();
  lists.history = lists.history.filter(h => !(h.lng === item.lng && h.lat === item.lat && h.name === item.name));
  lists.history.unshift({ id: makeId(), name: item.name, lng: Number(item.lng), lat: Number(item.lat) });
  lists.history = lists.history.slice(0, 30); // 直近30件
  saveLists(lists);
}

function renderList(container, items, opt = {}){
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

    // アイテム本体
    const name = document.createElement('span');
    name.className = 'poi-name';
    name.textContent = it.name || '(名称未設定)';

    // 開始（▶）
    const go = document.createElement('button');
    go.className = 'fav-go';
    go.dataset.action = 'start';
    go.setAttribute('aria-label', 'start');
    go.title = 'この目的地で開始';
    go.textContent = '▶';

    // トグル（★）
    const star = document.createElement('button');
    star.className = 'fav-star';
    star.title = 'お気に入りに追加/削除';
    star.textContent = opt.alwaysStar ? '★' : '☆';
    star.addEventListener('click', (e)=>{
      e.preventDefault(); e.stopPropagation();
      toggleFavorite({ name: it.name, lng: it.lng, lat: it.lat });
      renderQuickLists(); // 再描画
    });

    // 削除（🗑）
    const del = document.createElement('button');
    del.className = 'fav-del';
    del.title = 'この項目を削除';
    del.textContent = '🗑';
    del.addEventListener('click', (e)=>{
      e.preventDefault(); e.stopPropagation();
      if (opt.type === 'favorites') {
        const lists = loadLists();
        const i = lists.favorites.findIndex(f => f.lng === it.lng && f.lat === it.lat && f.name === it.name);
        if (i>=0) { lists.favorites.splice(i,1); saveLists(lists); }
      } else if (opt.type === 'history') {
        const lists = loadLists();
        const i = lists.history.findIndex(h => h.lng === it.lng && h.lat === it.lat && h.name === it.name);
        if (i>=0) { lists.history.splice(i,1); saveLists(lists); }
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

export function renderQuickLists(){
  const els = {
    fav: document.getElementById('favorites-list'),
    his: document.getElementById('history-list'),
  };
  const lists = loadLists();

  renderList(els.fav, lists.favorites, { type: 'favorites', alwaysStar: true });
  renderList(els.his, lists.history,   { type: 'history',   alwaysStar: false });
}
