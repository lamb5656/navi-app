import { API_BASE } from './config.js';
import { getSettings, saveSettings, applyTheme } from './settings.js';

export function bindUI(mapCtrl, navCtrl){
  const addr = document.getElementById('addr');
  const card = document.getElementById('searchCard');
  const list = document.getElementById('searchList');

  // ===== 検索 =====
  async function onSearch(){
    const q = addr.value.trim(); if (!q) return;
    try{
      const res = await fetch(`${API_BASE}/geocode?text=${encodeURIComponent(q)}`, { credentials:'omit' });
      const data = await res.json();
      list.innerHTML = '';
      (data?.features||[]).slice(0,8).forEach(f=>{
        const c = f.geometry.coordinates;
        const name = f.properties?.label || f.properties?.name || `${c[1]},${c[0]}`;
        const div = document.createElement('div');
        div.className = 'item'; div.textContent = name;
        div.addEventListener('click', ()=>{
          navCtrl.setGoal(c);
          mapCtrl.focusHere(c);
          card.style.display = 'none';
        });
        list.appendChild(div);
      });
      card.style.display = 'block';
    }catch(e){ console.error(e); const t=document.getElementById('toast'); t.textContent='検索に失敗しました'; t.style.display='block'; setTimeout(()=>t.style.display='none', 1800); }
  }
  document.getElementById('btnSearch').addEventListener('click', onSearch);

  // ===== ナビ操作 =====
  document.getElementById('btnStart').addEventListener('click', ()=>{
    const avoidTolls = getSettings().avoidTolls;
    navCtrl.start(avoidTolls);
  });
  document.getElementById('btnStop').addEventListener('click', ()=> navCtrl.stop());

  // 追従トグル
  const btnFollow = document.getElementById('btnFollowToggle');
  btnFollow.addEventListener('click', ()=>{
    const next = (mapCtrl.followMode === 'course') ? 'north' : 'course';
    mapCtrl.setFollowMode(next);
    btnFollow.textContent = (next === 'course') ? '進行方向' : '北固定';
    mapCtrl.setAutoFollow(true);
    mapCtrl.updateViewToHere(navCtrl.here);
  });

  // 再中心ボタン（手動パンで body.follow-paused を付与/除去）
  const btnRecenter = document.getElementById('btnRecenter');
  mapCtrl.setOnFollowChange((isAuto)=>{
    document.body.classList.toggle('follow-paused', !isAuto);
  });
  btnRecenter.addEventListener('click', ()=>{
    mapCtrl.recenter(navCtrl.here);
  });

  // ====== 設定（localStorage 永続化） ======
  const s = getSettings();
  // ツールバーの有料回避チェックは設定と同期
  const avoidCb = document.getElementById('avoidTolls');
  avoidCb.checked = !!s.avoidTolls;
  avoidCb.addEventListener('change', e=>{
    saveSettings({ avoidTolls: !!e.target.checked });
    // ヘッダー内の設定カード側チェックとも同期
    const inCard = document.getElementById('setAvoidTolls');
    if (inCard) inCard.checked = !!e.target.checked;
  });

  // 設定カード
  const settingsCard = document.getElementById('settingsCard');
  const openBtn = document.getElementById('btnOpenSettings');
  const closeBtn = document.getElementById('btnSettingsClose');

  const setAvoid = document.getElementById('setAvoidTolls');
  const setProfile = document.getElementById('setProfile');
  const setVol = document.getElementById('setTtsVolume');
  const setRate = document.getElementById('setTtsRate');
  const setTheme = document.getElementById('setTheme');

  function syncSettingsUI(){
    const s2 = getSettings();
    setAvoid.checked = !!s2.avoidTolls;
    setProfile.value = s2.profile;
    setVol.value = s2.ttsVolume;
    setRate.value = s2.ttsRate;
    setTheme.value = s2.theme;
  }
  syncSettingsUI();

  openBtn.addEventListener('click', (e)=>{ e.preventDefault(); syncSettingsUI(); settingsCard.style.display='block'; });
  closeBtn.addEventListener('click', ()=>{ settingsCard.style.display='none'; });

  setAvoid.addEventListener('change', e=>{ saveSettings({ avoidTolls: !!e.target.checked }); avoidCb.checked = e.target.checked; });
  setProfile.addEventListener('change', e=> saveSettings({ profile: e.target.value }));
  setVol.addEventListener('input', e=> saveSettings({ ttsVolume: parseFloat(e.target.value || 1) }));
  setRate.addEventListener('input', e=> saveSettings({ ttsRate: parseFloat(e.target.value || 1) }));
  setTheme.addEventListener('change', e=>{ saveSettings({ theme: e.target.value }); applyTheme(); });
}
