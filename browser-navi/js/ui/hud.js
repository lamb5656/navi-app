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
function formatNextDistance(m){
  if (!Number.isFinite(m) || m < 0) return '–';
  if (m < 1000) return `${Math.round(m)}m`;
  return `${(m/1000).toFixed(1)}km`;
}

export function createHUD() {
  const els = {
    distanceKm: get('remainKm'),
    eta: get('eta'),
    status: get('status'),
    nextDist: get('nextDist'),
    nextText: get('nextText')
  };

  function update(data = {}) {
    if (els.distanceKm) els.distanceKm.textContent = formatDistanceKm(data.distanceLeftMeters);
    if (els.eta)        els.eta.textContent        = formatEta(data.eta);
    if (els.status && typeof data.status === 'string') els.status.textContent = data.status;

    if (els.nextDist) els.nextDist.textContent = formatNextDistance(data.nextTurnDistanceMeters);
    if (els.nextText) els.nextText.textContent = (typeof data.nextTurnText === 'string' && data.nextTurnText.length) ? data.nextTurnText : '';
  }

  function setStatus(text) { if (els.status) els.status.textContent = text; }

  function reset() {
    if (els.distanceKm) els.distanceKm.textContent = '–';
    if (els.eta)        els.eta.textContent        = '–:–';
    if (els.status)     els.status.textContent     = '待機中';
    if (els.nextDist)   els.nextDist.textContent   = '–';
    if (els.nextText)   els.nextText.textContent   = '';
  }

  reset();
  try { window.addEventListener('hud:update', e => update(e.detail)); } catch {}
  return { update, setStatus, reset };
}
