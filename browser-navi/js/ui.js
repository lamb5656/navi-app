import { API_BASE } from './config.js';

export function bindUI(mapCtrl, navCtrl){
  const addr = document.getElementById('addr');
  const card = document.getElementById('searchCard');
  const list = document.getElementById('searchList');

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
  document.getElementById('btnStart').addEventListener('click', ()=>{
    const avoidTolls = document.getElementById('avoidTolls').checked;
    navCtrl.start(avoidTolls);
  });
  document.getElementById('btnStop').addEventListener('click', ()=> navCtrl.stop());

  // 追従トグル（ナビ中に右上表示・ラベルを切替）
  const btnFollow = document.getElementById('btnFollowToggle');
  btnFollow.addEventListener('click', ()=>{
    const next = (mapCtrl.followMode === 'course') ? 'north' : 'course';
    mapCtrl.setFollowMode(next);
    btnFollow.textContent = (next === 'course') ? '進行方向' : '北固定';
    mapCtrl.setAutoFollow(true);
    mapCtrl.updateViewToHere(navCtrl.here);
  });
}
