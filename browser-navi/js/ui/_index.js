// /browser-navi/js/ui/_index.js
import { $, forceOpen, forceClose, toast } from './dom.js';
import { setupSearch } from './search.js';
import { renderQuickLists, addHistory } from './favorites.js';
import { setupSettings } from './settings-panel.js';
import { setupStartStop } from './startstop.js';
import { createHUD } from './hud.js';

export function bindUI(mapCtrl, navCtrl){
  const els = {
    addr:            $('addr'),
    btnSearch:       $('btnSearch'),
    btnStart:        $('btnStart'),
    btnStop:         $('btnStop'),
    btnFollowToggle: $('btnFollowToggle'),
    btnRecenter:     $('btnRecenter'),
    // search card
    searchCard: $('searchCard'),
    searchList: $('searchList'),
    // settings
    settingsCard: $('settingsCard'),
    btnOpenSettings: $('btnOpenSettings'),
    btnSettingsClose: $('btnSettingsClose'),
    setAvoidTolls: $('setAvoidTolls'),
    setProfile: $('setProfile'),
    setTtsVolume: $('setTtsVolume'),
    setTtsRate: $('setTtsRate'),
    setTheme: $('setTheme'),
    // menus & lists
    appMenu: $('appMenu'),
    favoritesList: $('favorites-list'),
    historyList: $('history-list'),
    historyClear: $('history-clear'),
    btnFavCurrent: $('btnFavCurrent'),
    avoidTollsToolbar: $('avoidTolls'),
  };

  // === HUD ===
  const hud = createHUD();
  const hudSink = (snap) => hud.update(snap);

  // 小機能セットアップ
  const searchApi = setupSearch(els, mapCtrl);
  setupSettings(els);

  // Start/Stop：navCtrl からの進捗は hooks.onTick 経由で HUD に流す
  const routeApi = setupStartStop(els, navCtrl, {
    onGoalFixed: (place) => { addHistory(place); renderQuickLists(); },
    onStarted:   (place) => { addHistory(place); renderQuickLists(); },
    onTick:      (snap)  => { hudSink(snap); }
  });

  // 検索UI
  els.btnSearch   && els.btnSearch.addEventListener('click', (e)=>{ e.preventDefault(); searchApi.onSearch(); });
  els.addr        && els.addr.addEventListener('keydown', (e)=>{ if (e.key==='Enter'){ e.preventDefault(); searchApi.onSearch(); } });

  // Start / Stop / Follow
  els.btnStart         && els.btnStart.addEventListener('click',  (e)=>{ e.preventDefault(); routeApi.onStart(searchApi); });
  els.btnStop          && els.btnStop.addEventListener('click',   (e)=>{ e.preventDefault(); routeApi.onStop(); });
  els.btnFollowToggle  && els.btnFollowToggle.addEventListener('click', (e)=>{ e.preventDefault(); routeApi.onFollowToggle(); });
  els.btnRecenter      && els.btnRecenter.addEventListener('click', ()=> toast('中心に戻しました'));

  // お気に入り登録（現在の目的地）
  if (els.btnFavCurrent){
    els.btnFavCurrent.addEventListener('click', (e)=>{
      e.preventDefault();
      Promise.resolve(searchApi.onFavCurrent()).then(()=>renderQuickLists());
    });
  }

  renderQuickLists();

  // =========================
  // クリック委譲（capture）
  // =========================
  function findGoButton(target){
    if (!(target instanceof Element)) return null;
    return target.closest('[data-action="start"], .fav-go, .js-go, .go, .play') ||
           // 「▶」一文字ボタン/リンクにも対応
           ([...target.closest('li, div, span, a, button')?.querySelectorAll('button, a')] || [])
             .find(el => el.textContent?.trim() === '▶') || null;
  }
  function findItemNode(btn){
    if (!btn) return null;
    // 近い順に探す
    return btn.closest('[data-lng][data-lat]') ||
           btn.closest('[data-coords]') ||
           btn.closest('li') || btn.parentElement;
  }

  document.addEventListener('click', (e)=>{
    const t = e.target instanceof Element ? e.target : null;

    // 0) 検索候補の内側なら、委譲は何もしない（候補の pointerdown を優先）
    if (t && t.closest('#searchList')) return;

    // 1) お気に入り／履歴の「▶（開始）」を処理
    const listRoot = t && t.closest('#favorites-list, #history-list');
    const goBtn = listRoot && findGoButton(t);
    if (listRoot && goBtn) {
      e.preventDefault();
      const item = findItemNode(goBtn);
      // 座標の取得（data-lng/lat or data-coords="lng,lat"）
      let lng = Number(item?.dataset?.lng);
      let lat = Number(item?.dataset?.lat);
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
        const coords = (item?.dataset?.coords || goBtn.dataset?.coords || '').split(',');
        if (coords.length === 2) {
          lng = Number(coords[0]); lat = Number(coords[1]);
        }
      }
      // 名称
      const name = (item?.dataset?.name || goBtn.dataset?.name || goBtn.getAttribute('title') || goBtn.textContent || '').trim() || (els.addr?.value || '目的地');

      if (Number.isFinite(lng) && Number.isFinite(lat)) {
        if (els.addr) els.addr.value = name;
        if (searchApi?.state) searchApi.state.goalLngLat = [lng, lat];
        Promise.resolve(routeApi.onStart(searchApi)).catch(()=>{});
      } else {
        toast('この項目に座標情報が無いみたい…（レンダリングを最新化してにゃ）');
      }
      return;
    }

    // 2) 通常の委譲（個別ボタン）
    const q = (sel)=> t && t.closest(sel);
    if (q('#btnSearch'))        { e.preventDefault(); searchApi.onSearch(); return; }
    if (q('#btnStart'))         { e.preventDefault(); routeApi.onStart(searchApi); return; }
    if (q('#btnStop'))          { e.preventDefault(); routeApi.onStop(); return; }
    if (q('#btnFollowToggle'))  { e.preventDefault(); routeApi.onFollowToggle(); return; }
    if (q('#btnOpenSettings'))  { e.preventDefault(); els.btnOpenSettings?.click(); return; }
    if (q('#btnSettingsClose')) { e.preventDefault(); els.btnSettingsClose?.click(); return; }
    if (q('#btnFavCurrent'))    { e.preventDefault(); Promise.resolve(searchApi.onFavCurrent()).then(()=>renderQuickLists()); return; }
  }, { capture: true });

  // 検索カードの外側タップで閉じる（capture で先取り）
  document.addEventListener('pointerdown', (e) => {
    const open = !!els.searchCard && els.searchCard.style.display !== 'none';
    if (!open) return;
    const insideCard = els.searchCard.contains(e.target);
    const isInput = (e.target === els.addr || (els.addr && els.addr.contains && els.addr.contains(e.target)));
    if (!insideCard && !isInput) {
      e.stopPropagation();
      forceClose(els.searchCard);
    }
  }, true);

  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && els.searchCard) forceClose(els.searchCard); });

  console.log('[SVN] UI boot complete');
}
