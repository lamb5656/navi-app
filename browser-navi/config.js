// /browser-navi/config.js
export const API_BASE = "https://ors-proxy.lamb565.workers.dev";
export const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
// History & Favorites
export const HISTORY_MAX = 50;
export const FAVORITES_MAX = 100;
export const MERGE_DISTANCE_M = 20; // consider same place if within 20m

export const CONST = {
  MIN_SPEECH_INTERVAL_MS: 3500,
  PREVIEW_M: 300,
  EXECUTE_M: 40,
  PREVIEW_COOLDOWN_MS: 45000,
  OFF_ROUTE_METERS: 90,
  OFF_ROUTE_HYST_COUNT: 3,
  REROUTE_COOLDOWN_MS: 15000
};
