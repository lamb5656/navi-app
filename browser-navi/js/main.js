// /browser-navi/js/main.js
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

    const mapCtrl = new MapController();
    if (typeof mapCtrl.init === 'function') {
      await mapCtrl.init();
    }

    const navCtrl = new NavigationController(mapCtrl);
    bindUI(mapCtrl, navCtrl);

    // Acquire initial position once
    if ('geolocation' in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const here = [pos.coords.longitude, pos.coords.latitude];
          if (typeof navCtrl.setHereInitial === 'function') {
            navCtrl.setHereInitial(here);
          }
        },
        () => {},
        { enableHighAccuracy: true, timeout: 5000 }
      );
    }
  } catch (e) {
    console.error(e);
    // Minimal user feedback without depending on UI modules
    try {
      const t = document.createElement('div');
      t.className = 'toast';
      t.textContent = 'Init failed. Please reload.';
      document.body.appendChild(t);
      setTimeout(() => t.remove(), 4000);
    } catch {}
  }
})();
