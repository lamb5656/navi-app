// Lightweight HUD updater for distance/eta/status
const get = (id) => document.getElementById(id);

function formatDistance(m) {
  if (!Number.isFinite(m) || m < 0) return '–';
  if (m >= 1000) return (m / 1000).toFixed(1);
  // show 0.0km when < 1000m to keep layout stable
  return (Math.max(m, 0) / 1000).toFixed(1);
}
function formatEta(v) {
  if (!v) return '–:–';
  const d = typeof v === 'number' ? new Date(v) : new Date(String(v));
  if (isNaN(d.getTime())) return '–:–';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function createHUD() {
  const els = {
    distance: get('hudDistance'),
    eta:      get('hudEta'),
    status:   get('hudStatus'),
  };
  function update(data = {}) {
    // data: { distanceLeftMeters?, eta?, status? }
    if (els.distance) els.distance.textContent = formatDistance(data.distanceLeftMeters) ?? '–';
    if (els.eta)      els.eta.textContent      = formatEta(data.eta);
    if (els.status && typeof data.status === 'string') els.status.textContent = data.status;
  }
  function setStatus(text) { if (els.status) els.status.textContent = text; }
  function reset() {
    if (els.distance) els.distance.textContent = '–';
    if (els.eta)      els.eta.textContent      = '–:–';
    if (els.status)   els.status.textContent   = '待機中';
  }
  // initialize once
  reset();
  return { update, setStatus, reset };
}
