export function ensureMaplibre() {
  return new Promise((resolve) => {
    if (window.maplibregl) return resolve();

    function loadScript(src, next){ const s=document.createElement('script'); s.src=src; s.async=false; s.onload=next; s.onerror=next; document.head.appendChild(s); }
    function loadCSS(href){ if (document.querySelector(`link[href="${href}"]`)) return;
      const l=document.createElement('link'); l.rel='stylesheet'; l.href=href; document.head.appendChild(l);
    }

    loadScript('./vendor/maplibre-gl.js', function(){
      if (window.maplibregl) return resolve();
      const cdnJS = 'https://cdn.jsdelivr.net/npm/maplibre-gl@3.6.1/dist/maplibre-gl.js';
      const cdnCSS= 'https://cdn.jsdelivr.net/npm/maplibre-gl@3.6.1/dist/maplibre-gl.css';
      loadScript(cdnJS, function(){
        if (!window.maplibregl) {
          const upJS = 'https://unpkg.com/maplibre-gl@3.6.1/dist/maplibre-gl.js';
          const upCSS= 'https://unpkg.com/maplibre-gl@3.6.1/dist/maplibre-gl.css';
          loadScript(upJS, function(){ loadCSS(upCSS); resolve(); });
        } else { loadCSS(cdnCSS); resolve(); }
      });
    });
  });
}
