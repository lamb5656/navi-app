// Boot sequence: create map, nav, wire UI, and expose controllers to window.

import { ensureMaplibre } from './libs/maplibre-loader.js';
import { MapController } from './map.js';
import { NavigationController } from './nav.js';
import { bindUI } from './ui.js';

// PWA (Service Worker)
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {});
}

(async function boot() {
  try {
    await ensureMaplibre();

    // 1) Map
    const mapCtrl = new MapController();
    if (typeof mapCtrl.init === 'function') {
      await mapCtrl.init();
    }

    // 2) Navigation
    const navCtrl = new NavigationController(mapCtrl);

    // 3) Bind UI after DOM ready
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
        // ★ HUD/デバッグ用に window に公開（これが無いと UI から見えない）
        window.mapCtrl = mapCtrl;
        window.navCtrl = navCtrl;
        console.log('[SVN] UI bound & controllers exposed on window');
      } catch (e) {
        console.error('[SVN] bindUI failed', e);
      }
    });

    // 初回位置（表示だけ。追従は開始後に切り替え）
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
