const KEY = 'svnavi_settings_v1';
const defaults = {
  avoidTolls: true,
  profile: 'driving-car', // driving-car | foot-walking | cycling-regular
  ttsRate: 1.0,
  ttsVolume: 1.0,
  theme: 'auto' // auto | light | dark
};

let state = { ...defaults, ...(JSON.parse(localStorage.getItem(KEY) || '{}')) };

export function getSettings(){ return state; }
export function saveSettings(part){
  state = { ...state, ...part };
  localStorage.setItem(KEY, JSON.stringify(state));
  applyTheme();
}
export function applyTheme(){
  const t = state.theme || 'auto';
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.body.classList.remove('theme-dark','theme-light');
  if (t==='dark' || (t==='auto' && prefersDark)) document.body.classList.add('theme-dark');
  else if (t==='light') document.body.classList.add('theme-light'); // lightはデフォとほぼ同じ
}
window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
applyTheme();
