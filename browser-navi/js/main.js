import { ensureMaplibre } from './libs/maplibre-loader.js';
import { MapController } from './map.js';
import { NavigationController } from './nav.js';
import { bindUI } from './ui.js';

// PWA（Service Worker）
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js', { scope:'./' }).catch(console.error);
}

(async function boot(){
  await ensureMaplibre();

  const mapCtrl = new MapController();
  mapCtrl.init();

  const navCtrl = new NavigationController(mapCtrl);
  bindUI(mapCtrl, navCtrl);

  // 初期位置を一度取得
  navigator.geolocation.getCurrentPosition((pos)=>{
    const here=[pos.coords.longitude,pos.coords.latitude];
    navCtrl.setHereInitial(here);
  }, ()=>{}, { enableHighAccuracy:true, timeout:5000 });
})();
