export const $ = (id) => document.getElementById(id);

function ensureForceStyle() {
  let styleTag = document.getElementById('svn-force-style');
  if (!styleTag) {
    styleTag = document.createElement('style');
    styleTag.id = 'svn-force-style';
    styleTag.textContent = `.svn-force-open{display:block!important;visibility:visible!important;opacity:1!important;pointer-events:auto!important}`;
    document.head.appendChild(styleTag);
  }
}

export function forceOpen(el){ if(!el) return; ensureForceStyle(); el.classList.add('svn-force-open'); el.style.display=''; }
export function forceClose(el){ if(!el) return; el.classList.remove('svn-force-open'); el.style.display='none'; }

export function toast(msg, ms = 2000) {
  let t = document.getElementById('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; document.body.appendChild(t); }
  t.textContent = msg; t.style.opacity = '1'; t.style.display = 'block';
  setTimeout(() => (t.style.opacity = '0'), ms);
}
