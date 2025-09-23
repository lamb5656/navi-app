const LS_KEY = 'navi.settings.v1';

const DEFAULTS = {
  avoidTolls: false,
  ttsVolume: 1,
  ttsSpeed: 1,
  profile: 'driving-car',
  theme: 'auto',
};

function readStore() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    return { ...DEFAULTS, ...parsed };
  } catch {
    return { ...DEFAULTS };
  }
}

function writeStore(obj) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(obj)); } catch {}
}

export function loadSettings() { return readStore(); }
export function saveSettings(next) { writeStore(next); }
export function getSetting(name) { return readStore()[name]; }

export function setSetting(name, value) {
  const s = readStore();
  s[name] = value;
  writeStore(s);
  if (name === 'theme') {
    applyTheme(value);
    attachAutoThemeListener(value);
  }
}

export function setTheme(theme) { setSetting('theme', theme); }

export function applyTheme(theme) {
  const root = document.documentElement;
  let mode = theme;
  if (theme === 'auto') {
    const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
    mode = prefersDark ? 'dark' : 'light';
  }
  root.dataset.theme = mode;
}

function attachAutoThemeListener(theme) {
  if (!window.matchMedia) return;
  if (attachAutoThemeListener._mq) {
    attachAutoThemeListener._mq.onchange = null;
    attachAutoThemeListener._mq = null;
  }
  if (theme === 'auto') {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.onchange = () => applyTheme('auto');
    attachAutoThemeListener._mq = mq;
  }
}

export function initSettings() {
  const s = readStore();
  applyTheme(s.theme);
  attachAutoThemeListener(s.theme);
}

export function resetSettings() {
  writeStore({ ...DEFAULTS });
  initSettings();
}

export const StorageKeys = {
  HISTORY: 'NAV_HISTORY_V1',
  FAVORITES: 'NAV_FAVORITES_V1'
};

export function loadList(key) {
  try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; }
}

export function saveList(key, arr) {
  localStorage.setItem(key, JSON.stringify(arr));
}

export function upsertPlace(list, place, mergeDistanceM) {

  const existingIdx = list.findIndex(p => distanceM(p.lat, p.lng, place.lat, place.lng) <= mergeDistanceM);
  if (existingIdx >= 0) {
    list[existingIdx] = { ...list[existingIdx], name: place.name, ts: place.ts };
  } else {
    list.unshift(place);
  }
  return list;
}

export function distanceM(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function trimMax(list, max) {
  if (list.length > max) list.length = max;
  return list;
}

export function makePlaceId(lat, lng) {

  return `${lat.toFixed(5)},${lng.toFixed(5)}`;
}
