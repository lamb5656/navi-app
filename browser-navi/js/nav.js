// js/nav.js
// 経路探索・案内・TTS・到着・リルート・進行カード
import { withBackoff } from './libs/net.js';
import { getSetting } from './settings.js';
import { showToast } from './ui.js';
import { drawRoute, followUser, clearRoute } from './map.js';

let currentRoute = null;
let watchId = null;
let lastStepIdx = -1;

async function fetchRouteORS(payload) {
  const res = await fetch(`${API_BASE}/route`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error('ORS route failed');
  return res.json();
}

async function fetchRouteOSRM(payload) {
  const [start, goal] = payload.coordinates;
  const res = await fetch(`${API_BASE}/route?start=${start.join(',')}&goal=${goal.join(',')}`);
  if (!res.ok) throw new Error('OSRM route failed');
  return res.json();
}

// ここをリトライ付きでラップ
export async function fetchRouteWithRetry(payload) {
  try {
    return await withBackoff(() => fetchRouteORS(payload), { retries: 2, base: 500 });
  } catch {
    showToast('ORSエラーにゃ。OSRMに切り替えるにゃ…');
    return await withBackoff(() => fetchRouteOSRM(payload), { retries: 2, base: 500 });
  }
}

export async function startNavigation(coords) {
  clearRoute();
  const avoid = getSetting('avoidTolls');
  const profile = getSetting('profile') || 'driving-car';

  const payload = {
    coordinates: coords,
    avoidTolls: !!avoid,
    profile
  };

  const data = await fetchRouteWithRetry(payload);
  currentRoute = data;
  drawRoute(data);

  if (watchId) navigator.geolocation.clearWatch(watchId);
  watchId = navigator.geolocation.watchPosition(handlePosition, console.error, {
    enableHighAccuracy: true,
    maximumAge: 0,
    timeout: 10000
  });
}

function handlePosition(pos) {
  if (!currentRoute) return;
  const { latitude, longitude } = pos.coords;
  followUser([longitude, latitude]);
  updateInstructions([longitude, latitude]);
}

function updateInstructions([lng, lat]) {
  if (!currentRoute?.routes?.[0]) return;
  const steps = currentRoute.routes[0].segments[0].steps;
  const idx = findNextStep(steps, [lng, lat]);
  if (idx !== lastStepIdx) {
    lastStepIdx = idx;
    const step = steps[idx];
    if (step) {
      speakInstruction(step);
      updateProgressCard(step);
    }
  }
}

function findNextStep(steps, [lng, lat]) {
  let minDist = Infinity, minIdx = 0;
  steps.forEach((s, i) => {
    const [slng, slat] = s.way_points_center || s.way_points[0];
    const d = Math.hypot(lng - slng, lat - slat);
    if (d < minDist) {
      minDist = d;
      minIdx = i;
    }
  });
  return minIdx;
}

function speakInstruction(step) {
  const msg = new SpeechSynthesisUtterance(step.instruction);
  msg.rate = getSetting('ttsSpeed') || 1;
  msg.volume = getSetting('ttsVolume') || 1;
  speechSynthesis.speak(msg);
}

function updateProgressCard(step) {
  const el = document.getElementById('progress-card');
  if (!el) return;
  el.textContent = step.instruction + ' / 残り ' + Math.round(step.distance) + ' m';
}

export function stopNavigation() {
  if (watchId) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
  currentRoute = null;
  lastStepIdx = -1;
  clearRoute();
}
