// /browser-navi/js/settings.js
// App settings (persisted to localStorage). ESM named exports.

const LS_KEY = 'navi.settings.v1';

const DEFAULTS = {
  avoidTolls: false,
  ttsVolume: 1,
  ttsSpeed: 1,
  profile: 'driving-car',
  theme: 'auto',
};

// ---- persistence ----
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

// ---- public API ----
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

// ---- theme handling ----
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
