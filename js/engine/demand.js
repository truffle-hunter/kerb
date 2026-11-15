// "Demand likely" score, level and one reason (spec §7.4, ADR 0002). Demand only: it never models supply.
import { dublinParts } from './time.js';
import { distM } from './geo.js';
import { status, isUsable } from './legal.js';
import { triggersAround } from './triggers.js';

const MIN = 60000;
const DISTINCT_M = 300;
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function timeWords(now, P) {
  const p = dublinParts(now);
  const svc = dublinParts(new Date(now.getTime() - P.service_day_start_hour * 60 * MIN));
  const h = p.hour;
  const part = h >= 20 || h < 4 ? 'night' : h >= 17 ? 'evening' : h >= 12 ? 'afternoon' : 'morning';
  return `${DAYS[part === 'night' ? svc.weekday : p.weekday]} ${part}`;
}

/** 0 before the lead-in, ramps to 1 by t - before, flat to t + flat, falls to 0 at t + end (minutes). */
export function kernel(dtMin, P) {
  const lead = P.kernel_lead_min ?? P.kernel_before_min;
  if (dtMin < -lead) return 0;
  if (dtMin < -P.kernel_before_min) return (dtMin + lead) / (lead - P.kernel_before_min);
  if (dtMin <= P.kernel_flat_min) return 1;
  if (dtMin < P.kernel_end_min) return (P.kernel_end_min - dtMin) / (P.kernel_end_min - P.kernel_flat_min);
  return 0;
}

export function score(stand, now, ctx, trig) {
  const P = ctx.params.demand;
  const p = dublinParts(now);
  const svc = dublinParts(new Date(now.getTime() - P.service_day_start_hour * 60 * MIN));
  const base = (P.weekday_share[svc.weekday] * P.hour_share[p.hour])
    / (Math.max(...P.weekday_share) * Math.max(...P.hour_share));
  const c = (ctx.catchments && ctx.catchments[stand.id]) || { pubs: 0, clubs: 0, rooms: 0, stations: 0, idx_pub: 0, idx_club: 0, idx_room: 0, idx_station: 0 };
  const night = p.hour >= P.night_hours[0] || p.hour < P.night_hours[1];
  const pubF = night ? 1 : P.pub_day_factor;
  const comp = { pub: c.idx_pub * pubF, club: c.idx_club * pubF, room: c.idx_room, station: c.idx_station };
  const catchIdx = comp.pub + comp.club + comp.room + comp.station;
  const catchment = P.catch_floor + catchIdx / P.catch_norm;
  const top = Object.entries(comp).sort((a, b) => b[1] - a[1])[0];
  let catchLabel = timeWords(now, P);
  if (catchIdx / P.catch_norm > P.catch_floor) {
    catchLabel = top[0] === 'club' ? `${c.clubs} nightclubs within 400 m`
      : top[0] === 'pub' ? `${c.pubs} pubs within 400 m`
        : top[0] === 'room' ? `${c.rooms.toLocaleString('en-IE')} hotel rooms nearby`
          : 'Station beside the rank';
  }
  const parts = [{ label: catchLabel, value: base * catchment }];
  // ADR 0013: the same numbers, split for "Why this rank?" (additive: score, level, reason and parts are unchanged)
  const detail = { when: timeWords(now, P), base, night, time: base * P.catch_floor,
    catch: Object.fromEntries(Object.entries(comp).map(([k, v]) => [k, (base * v) / P.catch_norm])),
    counts: { pubs: c.pubs, clubs: c.clubs, rooms: c.rooms, stations: c.stations }, triggers: [], rain: null };
  const pubShare = Math.min(1, (c.idx_pub + c.idx_club) / P.catch_norm);
  let rain = 0;
  for (const t of trig || []) {
    if (t.kind === 'rain') { rain = P.kind_weight.rain; parts.push({ label: t.label, value: 0 }); continue; }
    const k = kernel((now - t.t) / MIN, P);
    if (!k) continue;
    const near = t.place && stand.head ? distM(stand.head, t.place) : null;
    const prox = t.kind === 'closing' || t.kind === 'late_closing' ? pubShare
      : near !== null ? Math.max(0, 1 - near / (t.kind === 'event' ? P.event_proximity_m : P.proximity_m)) : 0;
    const v = (P.kind_weight[t.kind] ?? 0) * t.weight * prox * k;
    if (v > 0) {
      parts.push({ label: t.label, value: v });
      detail.triggers.push({ kind: t.kind, label: t.label, t: t.t, distM: t.kind === 'closing' || t.kind === 'late_closing' ? null : near, value: v });
    }
  }
  let total = parts.reduce((s, x) => s + x.value, 0);
  if (rain) {
    const rainPart = parts.find((x) => x.value === 0 && /^Rain/.test(x.label));
    rainPart.value = total * rain;
    detail.rain = { label: rainPart.label, value: rainPart.value };
    total *= 1 + rain;
  }
  const level = total >= P.high ? 'high' : total >= P.medium ? 'medium' : 'low';
  const reason = parts.reduce((a, b) => (b.value > a.value ? b : a)).label;
  return { score: total, level, reason, parts, detail };
}

/** Top stands to head for: recommendable, legally usable now, permit-gated, ranked by demand ÷ (1 + km / k). */
export function recommend(stands, now, ctx, kmById, { permit = false, n = 3 } = {}) {
  const trig = triggersAround(now, ctx, ctx.params.demand.kernel_end_min, ctx.params.demand.kernel_lead_min ?? 60);
  const k = ctx.params.rank.k_km;
  const out = [];
  for (const s of stands) {
    if (!s.recommendable || (s.access === 'daa_permit' && !permit) || !kmById[s.id]) continue;
    const st = status(s, now, ctx);
    if (!isUsable(st)) continue;
    const d = score(s, now, ctx, trig);
    const { km, approx } = kmById[s.id];
    out.push({ stand: s, km, approx, status: st, demand: d, rankScore: d.score / (1 + km / k) });
  }
  out.sort((a, b) => b.rankScore - a.rankScore);
  // Alternatives must be different places: skip a stand on the same street within 300 m of one already picked
  // (Lansdowne Road has three stands; offering it three times gives the driver no choice).
  const picked = [];
  for (const r of out) {
    if (picked.length >= n) break;
    const dup = picked.some((p) => p.stand.street === r.stand.street && p.stand.head && r.stand.head
      && distM(p.stand.head, r.stand.head) < DISTINCT_M);
    if (!dup) picked.push(r);
  }
  return picked;
}
