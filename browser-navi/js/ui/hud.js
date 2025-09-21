// HUD updater for IDs: remainKm, eta, status
const get = (id) => document.getElementById(id);

function formatDistanceKm(m) {
  if (!Number.isFinite(m) || m < 0) return '–';
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
  const els = { distanceKm: get('remainKm'), eta: get('eta'), status: get('status') };
  function update(data = {}) {
    if (els.distanceKm) els.distanceKm.textContent = formatDistanceKm(data.distanceLeftMeters);
    if (els.eta)        els.eta.textContent        = formatEta(data.eta);
    if (els.status && typeof data.status === 'string') els.status.textContent = data.status;
  }
  function setStatus(text) { if (els.status) els.status.textContent = text; }
  function reset() {
    if (els.distanceKm) els.distanceKm.textContent = '–';
    if (els.eta)        els.eta.textContent        = '–:–';
    if (els.status)     els.status.textContent     = '待機中';
  }
  reset();
  return { update, setStatus, reset };
}
