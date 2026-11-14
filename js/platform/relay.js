// Optional relay client (spec §5, ADR 0004): only used when Settings has a relay URL (empty by default).
// Live rail arrivals at the two termini, and Luas disruption messages (a tram outage sends people to taxis).
import { hhmm } from '../engine/time.js';

const MIN = 60000;
const RAIL = { HSTON: { name: 'Heuston', place: [-6.293487, 53.346404] }, CNLLY: { name: 'Connolly', place: [-6.249704, 53.351252] } };
// Only Connolly's Luas code ("con") is verified (Phase 0 evidence); Luas messages are line-wide, so it covers the Red line.
const LUAS = { con: { name: 'Connolly', place: [-6.249704, 53.351252] } };
const NORMAL = /operating normally/i;

async function get(fetchFn, url) {
  try {
    const r = await fetchFn(url);
    return r.ok ? await r.json() : null;
  } catch (e) {
    return null;
  }
}

export async function fetchRail(fetchFn, base, station, now) {
  const body = await get(fetchFn, `${base.replace(/\/$/, '')}/v1/rail?station=${station}`);
  if (!body || !Array.isArray(body.trains)) return null;
  const st = RAIL[station];
  return body.trains
    .filter((t) => Number.isInteger(t.due_min) && t.due_min <= 60 && new RegExp(st.name, 'i').test(t.destination || '')
      && !new RegExp(st.name, 'i').test(t.origin || ''))
    .map((t) => {
      const at = new Date(now.getTime() + t.due_min * MIN);
      const late = t.late_min > 0 ? `, ${t.late_min} min late` : '';
      return { t: at, kind: 'live_rail', label: `Train from ${t.origin} due ${st.name} ${hhmm(at)}${late}`, place: st.place, weight: 1 };
    });
}

export async function fetchLuas(fetchFn, base, stop, now) {
  const body = await get(fetchFn, `${base.replace(/\/$/, '')}/v1/luas?stop=${stop}`);
  if (!body) return null;
  const msg = (body.message || '').trim();
  if (!msg || NORMAL.test(msg)) return [];
  return [{ t: now, kind: 'live_luas', label: `Luas: ${msg.replace(/\.\s*See news\.?$/i, '')}`, place: LUAS[stop] ? LUAS[stop].place : null, weight: 1 }];
}

/** All live items from the relay; feeds that fail are skipped. */
export async function liveItems(fetchFn, base, now) {
  const parts = await Promise.all([
    ...Object.keys(RAIL).map((s) => fetchRail(fetchFn, base, s, now)),
    ...Object.keys(LUAS).map((s) => fetchLuas(fetchFn, base, s, now)),
  ]);
  return { fetched: now, items: parts.filter(Boolean).flat() };
}
