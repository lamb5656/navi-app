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

  const hud = createHUD();

  const searchApi = setupSearch(els, mapCtrl);
  setupSettings(els);

  const routeApi = setupStartStop(els, navCtrl, {
    onGoalFixed: (place) => { addHistory(place); renderQuickLists(); },
    onStarted:   (place) => { addHistory(place); renderQuickLists(); },
    // HUD sink
    onTick: (snap) => { hud.update(snap); }
  });

  // buttons
  els.btnSearch   && els.btnSearch.addEventListener('click', (e)=>{ e.preventDefault(); searchApi.onSearch(); });
  els.addr        && els.addr.addEventListener('keydown', (e)=>{ if (e.key==='Enter'){ e.preventDefault(); searchApi.onSearch(); } });

  els.btnStart         && els.btnStart.addEventListener('click',  (e)=>{ e.preventDefault(); routeApi.onStart(searchApi); });
  els.btnStop          && els.btnStop.addEventListener('click',   (e)=>{ e.preventDefault(); routeApi.onStop(); });
  els.btnFollowToggle  && els.btnFollowToggle.addEventListener('click', (e)=>{ e.preventDefault(); routeApi.onFollowToggle(); });
  els.btnRecenter      && els.btnRecenter.addEventListener('click', ()=> toast('中心に戻しました'));

  if (els.btnFavCurrent){
    els.btnFavCurrent.addEventListener('click', (e)=>{
      e.preventDefault();
      Promise.resolve(searchApi.onFavCurrent()).then(()=>renderQuickLists());
    });
  }

  renderQuickLists();

  // ---- Delegation with guards (prevents "double tap to close") ----
  document.addEventListener('click', (e)=>{
    // 1) 検索候補の内側なら、委譲は何もしない（候補の pointerdown を優先）
    const insideSearchList = e.target instanceof Element && e.target.closest('#searchList');
    if (insideSearchList) return;

    // 2) 通常の委譲
    const q = (sel)=> e.target instanceof Element && e.target.closest(sel);
    if (q('#btnSearch'))        { e.preventDefault(); searchApi.onSearch(); return; }
    if (q('#btnStart'))         { e.preventDefault(); routeApi.onStart(searchApi); return; }
    if (q('#btnStop'))          { e.preventDefault(); routeApi.onStop(); return; }
    if (q('#btnFollowToggle'))  { e.preventDefault(); routeApi.onFollowToggle(); return; }
    if (q('#btnOpenSettings'))  { e.preventDefault(); els.btnOpenSettings?.click(); return; }
    if (q('#btnSettingsClose')) { e.preventDefault(); els.btnSettingsClose?.click(); return; }
    if (q('#btnFavCurrent'))    { e.preventDefault(); Promise.resolve(searchApi.onFavCurrent()).then(()=>renderQuickLists()); return; }
  }, { capture: true });

  // click-outside close for search card
  document.addEventListener('pointerdown', (e) => {
    const open = !!els.searchCard && els.searchCard.style.display !== 'none';
    if (!open) return;
    const insideCard = els.searchCard.contains(e.target);
    const isInput = (e.target === els.addr || (els.addr && els.addr.contains && els.addr.contains(e.target)));
    if (!insideCard && !isInput) {
      e.stopPropagation(); // 外側ハンドラの再オープンを抑止
      forceClose(els.searchCard);
    }
  }, true);

  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && els.searchCard) forceClose(els.searchCard); });

  console.log('[SVN] UI boot complete');
}
