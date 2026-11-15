// Your car's heading on the rank map (ADR 0011 §3). GPS heading only when moving (it is noise when still); else the
// bearing from a fix at least 12 m back (and further than both fixes' accuracy) within 20 s, unless the phone says it is
// still; held while parked within 10 m for up to 10 minutes (a coarse fix changes nothing); otherwise none, and the map
// draws a ring, because a car shape always claims a direction. In memory only, never stored.
import { distM, bearingDeg } from './geo.js';

const MOVING_MS = 2, STILL_MS = 0.5; // m/s
const GAP_M = 12, RECENT_MS = 20000, HOLD_M = 10, HOLD_MS = 10 * 60000, COARSE_M = 30;

/** nextHeading(state | null, fix) -> {heading: degrees | null, at, setT, recent} */
export function nextHeading(state, f) {
  const t = +f.t, here = [f.lon, f.lat];
  const good = f.accuracy == null || f.accuracy <= COARSE_M;
  const kept = ((state && state.recent) || []).filter((p) => t - p.t <= RECENT_MS);
  let heading = null, at = null, setT = null;
  if (Number.isFinite(f.heading) && f.speed >= MOVING_MS) {
    heading = f.heading; at = here; setT = t;
  } else if (!good) {
    return state || { heading: null, at: null, setT: null, recent: [] }; // a coarse fix decides nothing (review fix)
  } else if (!(Number.isFinite(f.speed) && f.speed < STILL_MS)) { // the phone says it is still: jitter, not a move
    const back = [...kept].reverse().find((p) => distM([p.lon, p.lat], here) >= Math.max(GAP_M, (p.acc || 0) + (f.accuracy || 0)));
    if (back) { heading = bearingDeg([back.lon, back.lat], here); at = here; setT = t; }
  }
  if (heading === null && state && state.heading != null && distM(state.at, here) <= HOLD_M && t - state.setT <= HOLD_MS) {
    ({ heading, at, setT } = state);
  }
  return { heading, at, setT, recent: good ? [...kept, { lon: f.lon, lat: f.lat, t, acc: f.accuracy }] : kept };
}
