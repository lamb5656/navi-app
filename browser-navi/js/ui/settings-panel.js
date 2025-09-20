import { getSetting, setSetting } from '../settings.js';
import { forceOpen, forceClose, toast } from './dom.js';

export function setupSettings(els){
  const syncAvoidUIFromStore = () => {
    const v = !!getSetting('avoidTolls');
    if (els.avoidTollsToolbar) els.avoidTollsToolbar.checked = v;
    if (els.setAvoidTolls) els.setAvoidTolls.checked = v;
  };
  const fillSettingsFromStore = () => {
    if (els.setProfile)   els.setProfile.value   = getSetting('profile') || 'driving-car';
    if (els.setTtsVolume) els.setTtsVolume.value = String(getSetting('ttsVolume') ?? 1);
    if (els.setTtsRate)   els.setTtsRate.value   = String(getSetting('ttsSpeed')  ?? 1);
    if (els.setTheme)     els.setTheme.value     = getSetting('theme') || 'auto';
    syncAvoidUIFromStore();
  };

  els.btnOpenSettings && els.btnOpenSettings.addEventListener('click', (e)=>{ e.preventDefault(); fillSettingsFromStore(); forceOpen(els.settingsCard); });
  els.btnSettingsClose && els.btnSettingsClose.addEventListener('click',(e)=>{
    e.preventDefault();
    if (els.setAvoidTolls) setSetting('avoidTolls', !!els.setAvoidTolls.checked);
    if (els.setProfile)    setSetting('profile', els.setProfile.value);
    if (els.setTtsVolume)  setSetting('ttsVolume', Number(els.setTtsVolume.value));
    if (els.setTtsRate)    setSetting('ttsSpeed',  Number(els.setTtsRate.value));
    if (els.setTheme)      setSetting('theme',     els.setTheme.value);
    syncAvoidUIFromStore();
    forceClose(els.settingsCard);
    toast('設定を保存しました');
  });
}
