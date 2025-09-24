import { ensureMaplibre } from './libs/maplibre-loader.js';
import { MapController } from './map.js';
import { NavigationController } from './nav.js';
import { bindUI } from './ui.js';
import { renderQuickLists, clearHistory } from './ui/favorites.js';

const btnHC = document.getElementById('history-clear');

if (btnHC) {
  btnHC.addEventListener('click', () => {
    if (confirm('履歴を全消去しますか？')) clearHistory();
  });
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {});
}

(async function boot() {
  try {
    await ensureMaplibre();

    const mapCtrl = new MapController();
    if (typeof mapCtrl.init === 'function') {
      await mapCtrl.init();
    }

    const navCtrl = new NavigationController(mapCtrl);

    const ready = (fn) => {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', fn, { once: true });
      } else {
        fn();
      }
    };
    ready(() => {
      try {
        bindUI(mapCtrl, navCtrl);

        window.mapCtrl = mapCtrl;
        window.navCtrl = navCtrl;
        //console.log('[SVN] UI bound & controllers exposed on window');
      } catch (e) {
        console.error('[SVN] bindUI failed', e);
      }
    });

    if ('geolocation' in navigator && typeof navCtrl.setHereInitial === 'function') {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const here = [pos.coords.longitude, pos.coords.latitude];
          navCtrl.setHereInitial(here);
        },
        () => {},
        { enableHighAccuracy: true, timeout: 5000 }
      );
    }
  } catch (e) {
    console.error(e);
    try {
      const t = document.getElementById('toast') || document.createElement('div');
      t.id = 'toast';
      t.className = 'toast';
      t.textContent = '初期化に失敗しました。再読み込みしてみてください';
      document.body.appendChild(t);
      t.style.opacity = '1';
      setTimeout(() => (t.style.opacity = '0'), 3500);
    } catch {}
  }
})();
