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

    searchCard: $('searchCard'),
    searchList: $('searchList'),

    settingsCard: $('settingsCard'),
    btnOpenSettings: $('btnOpenSettings'),
    btnSettingsClose: $('btnSettingsClose'),
    setAvoidTolls: $('setAvoidTolls'),
    setProfile: $('setProfile'),
    setTtsVolume: $('setTtsVolume'),
    setTtsRate: $('setTtsRate'),
    setTheme: $('setTheme'),

    appMenu: $('appMenu'),
    favoritesList: $('favorites-list'),
    historyList: $('history-list'),
    historyClear: $('history-clear'),
    btnFavCurrent: $('btnFavCurrent'),
    avoidTollsToolbar: $('avoidTolls'),
  };

  const hud = createHUD();
  const hudSink = (snap) => hud.update(snap);

  const searchApi = setupSearch(els, mapCtrl);
  setupSettings(els);

  const routeApi = setupStartStop(els, navCtrl, {
    onGoalFixed: () => {},
    onStarted:   (place) => { addHistory(place); renderQuickLists(); },
    onTick:      (snap)  => { hudSink(snap); }
  });

  els.btnSearch   && els.btnSearch.addEventListener('click', (e)=>{ e.preventDefault(); searchApi.onSearch(); });
  els.addr        && els.addr.addEventListener('keydown', (e)=>{ if (e.key==='Enter'){ e.preventDefault(); searchApi.onSearch(); } });
  els.btnStart && els.btnStart.addEventListener('click', async (e) => {
    e.preventDefault();
  
    try { await routeApi.centerLikeStart(mapCtrl, { zoom: 17 }); } catch {}
  
    try {
      window.TTS?.unlockOnce?.();
      window.TTS?.speak?.('ナビを開始します');
    } catch {}
  
    routeApi.onStart(searchApi);
  });
  els.btnStop          && els.btnStop.addEventListener('click',   (e)=>{ e.preventDefault(); routeApi.onStop(); });
  els.btnFollowToggle  && els.btnFollowToggle.addEventListener('click', (e)=>{ e.preventDefault(); routeApi.onFollowToggle(); });

  els.btnRecenter && els.btnRecenter.addEventListener('click', async (e)=>{
    e.preventDefault();
    try{
      await routeApi.centerLikeStart(mapCtrl);
      toast('現在地に戻して追従をONにしました');
    }catch(err){
      console.error(err);
      toast('現在地に戻れませんでした');
    }
  });

  try {
    mapCtrl.onUserInteract?.(() => {
      try { navCtrl.setFollowEnabled(false); } catch {}
      if (els.btnFollowToggle) els.btnFollowToggle.textContent = '北固定';
    });
  } catch {}

  if (els.btnFavCurrent){
    els.btnFavCurrent.addEventListener('click', (e)=>{
      e.preventDefault();
      Promise.resolve(searchApi.onFavCurrent()).then(()=>renderQuickLists());
    });
  }

  renderQuickLists();

  function findGoButton(target){
    if (!(target instanceof Element)) return null;
    return target.closest('[data-action="start"], .fav-go, .js-go, .go, .play') ||
           ([...target.closest('li, div, span, a, button')?.querySelectorAll('button, a')] || [])
             .find(el => el.textContent?.trim() === '▶') || null;
  }
  function findItemNode(btn){
    if (!btn) return null;
    return btn.closest('[data-lng][data-lat]') ||
           btn.closest('[data-coords]') ||
           btn.closest('li') || btn.parentElement;
  }

  document.addEventListener('click', (e)=>{
    const t = e.target instanceof Element ? e.target : null;

    if (t && t.closest('#searchList')) return;

    const listRoot = t && t.closest('#favorites-list, #history-list');
    const goBtn = listRoot && findGoButton(t);
    if (listRoot && goBtn) {
      e.preventDefault();

      const item = findItemNode(goBtn);
      let lng = Number(item?.dataset?.lng);
      let lat = Number(item?.dataset?.lat);

      if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
        const coords = (item?.dataset?.coords || goBtn.dataset?.coords || '').split(',');
        if (coords.length === 2) {
          lng = Number(coords[0]);
          lat = Number(coords[1]);
        }
      }

      const name =
        (item?.dataset?.name ||
         goBtn.dataset?.name ||
         goBtn.getAttribute('title') ||
         goBtn.textContent ||
         '').trim() || (els.addr?.value || '目的地');

      if (Number.isFinite(lng) && Number.isFinite(lat)) {
        if (els.addr) els.addr.value = name;
        if (searchApi?.state) searchApi.state.goalLngLat = [lng, lat];

        Promise
          .resolve(routeApi.centerLikeStart(mapCtrl, { zoom: 17 }))
          .then(() => {
            try {
              window.TTS?.unlockOnce?.();
              window.TTS?.speak?.('ナビを開始します');
            } catch {}
          })
          .then(() => routeApi.onStart(searchApi))
          .catch(() => routeApi.onStart(searchApi));
      } else {
        toast('この項目に座標が無いみたいです');
      }
      return;
    }

    const q = (sel)=> t && t.closest(sel);
    if (q('#btnSearch'))        { e.preventDefault(); searchApi.onSearch(); return; }
    if (q('#btnStart'))         { e.preventDefault(); routeApi.onStart(searchApi); return; }
    if (q('#btnStop'))          { e.preventDefault(); routeApi.onStop(); return; }
    if (q('#btnFollowToggle'))  { e.preventDefault(); routeApi.onFollowToggle(); return; }
    if (q('#btnOpenSettings'))  { e.preventDefault(); els.btnOpenSettings?.click(); return; }
    if (q('#btnSettingsClose')) { e.preventDefault(); els.btnSettingsClose?.click(); return; }
    if (q('#btnFavCurrent'))    { e.preventDefault(); Promise.resolve(searchApi.onFavCurrent()).then(()=>renderQuickLists()); return; }
  }, { capture: true });

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

  //console.log('[SVN] UI boot complete');
}
