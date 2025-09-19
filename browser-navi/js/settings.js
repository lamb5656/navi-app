// /browser-navi/js/settings.js
// App settings (persisted to localStorage). ESM named exports.

const LS_KEY = 'navi.settings.v1';

// Defaults
const DEFAULTS = {
  avoidTolls: false,         // boolean
  ttsVolume: 1,              // 0.0 - 1.0
  ttsSpeed: 1,               // 0.5 - 2.0 (browser dependent)
  profile: 'driving-car',    // 'driving-car' | 'foot-walking' | 'cycling-regular'
  theme: 'auto',             // 'auto' | 'light' | 'dark'
};

// ---- persistence ----
function readStore() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    // merge with defaults for forward-compat
    return { ...DEFAULTS, ...parsed };
  } catch {
    return { ...DEFAULTS };
  }
}

function writeStore(obj) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(obj));
  } catch {
    // ignore quota or private mode errors
  }
}

// ---- public API ----
export function loadSettings() {
  return readStore();
}

export function saveSettings(next) {
  writeStore(next);
}

export function getSetting(name) {
  const s = readStore();
  return s[name];
}

export function setSetting(name, value) {
  const s = readStore();
  s[name] = value;
  writeStore(s);
  // side-effects
  if (name === 'theme') {
    applyTheme(value);
    attachAutoThemeListener(value);
  }
}

// Convenience wrapper
export function setTheme(theme) {
  setSetting('theme', theme);
}

// ---- theme handling ----
export function applyTheme(theme) {
  const root = document.documentElement;
  let mode = theme;

  if (theme === 'auto') {
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    mode = prefersDark ? 'dark' : 'light';
  }
  root.dataset.theme = mode; // CSS: [data-theme="dark"] etc.
}

// re-bind media query listener when in 'auto'
function attachAutoThemeListener(theme) {
  if (!window.matchMedia) return;
  // remove old listener if any
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

// Call once on boot (safe to call multiple times)
export function initSettings() {
  const s = readStore();
  applyTheme(s.theme);
  attachAutoThemeListener(s.theme);
}

// Optional: migrate/clean keys in the future
export function resetSettings() {
  writeStore({ ...DEFAULTS });
  initSettings();
}
