// What is coming in the next hour (spec §7.3). Returns Trigger = {t: Date, kind, label, place: [lon,lat]|null, weight}.
import { dublinParts, dublinTime, addDays, hhmm } from './time.js';

const MIN = 60000;

/** Legal closing for the evening that starts on `date`: pubs (with 30 min drinking-up) and, Fri/Sat, late bars. */
export function closingTimes(date) {
  const wd = dublinParts(dublinTime(date, '12:00')).weekday;
  let pubs;
  if (wd <= 3) pubs = new Date(dublinTime(date, '23:30').getTime() + 30 * MIN);
  else if (wd <= 5) pubs = new Date(dublinTime(addDays(date, 1), '00:30').getTime() + 30 * MIN);
  else pubs = new Date(dublinTime(date, '23:00').getTime() + 30 * MIN);
  const out = [{ t: pubs, kind: 'closing', label: `Pubs close ${hhmm(pubs)}`, place: null, weight: 1 }];
  if (wd === 4 || wd === 5) {
    const late = dublinTime(addDays(date, 1), '02:30');
    out.push({ t: late, kind: 'late_closing', label: 'Late bars close 02:30 (assumed)', place: null, weight: 1 });
  }
  return out;
}

const serviceDate = (now, startHour) => dublinParts(new Date(now.getTime() - startHour * 60 * MIN)).date;

/** All triggers whose time lies in [now - beforeMin, now + afterMin], sorted by time. */
export function triggersAround(now, ctx, beforeMin = 60, afterMin = 60) {
  const lo = now.getTime() - beforeMin * MIN, hi = now.getTime() + afterMin * MIN;
  const P = ctx.params.demand;
  const inWin = (t) => t >= lo && t <= hi;
  const out = [];
  for (const it of (ctx.triggers && ctx.triggers.items) || []) {
    const t = Date.parse(it.t);
    if (inWin(t)) out.push({ t: new Date(t), kind: it.kind, label: it.label, place: it.place, weight: it.weight });
  }
  for (const e of (ctx.events && ctx.events.items) || []) {
    const t = Date.parse(e.end);
    if (!inWin(t)) continue;
    const approx = e.end_basis === 'published' || e.end_basis === 'curfew' ? '' : '~';
    out.push({ t: new Date(t), kind: 'event', label: `${e.label} lets out ${approx}${hhmm(new Date(t))}`,
      place: e.venue_point, weight: P.venue_weight[e.venue] ?? 0.3, venue: e.venue });
  }
  const sd = serviceDate(now, P.service_day_start_hour);
  for (const d of [addDays(sd, -1), sd]) for (const c of closingTimes(d)) if (inWin(c.t.getTime())) out.push(c);
  for (const it of (ctx.live && ctx.live.items) || []) if (inWin(it.t.getTime())) out.push(it);
  const w = ctx.weather;
  const fresh = w && (!w.fetched || now - w.fetched <= (P.weather_max_age_min ?? 60) * MIN);
  if (fresh && w.rainNextHourMm >= P.rain_mm) {
    out.push({ t: now, kind: 'rain', label: `Rain in the next hour (${w.rainNextHourMm.toFixed(1)} mm)`, place: null, weight: 1 });
  }
  return out.sort((a, b) => a.t - b.t);
}

/** Do the bundled timetables (trains, trams, ferries) cover today? {current, to}. */
export function timetableStatus(now, ctx) {
  const today = dublinParts(now).date;
  const t = ctx.triggers || {};
  return { current: !!t.from && t.from <= today && today <= t.to, to: t.to || null };
}

/** The next hour, for display: triggers from now to now + horizonMin. */
export function upcoming(now, ctx, horizonMin = 60) {
  return triggersAround(now, ctx, 0, horizonMin).filter((x) => x.t >= now);
}

const CITYWIDE = new Set(['closing', 'late_closing', 'rain']);

/** The single most important item of `list` for a driver at `near`: kind weight × item weight × closeness (3 km). */
export function nextImportant(list, ctx, near) {
  const P = ctx.params.demand;
  let best = null, bv = 0;
  for (const t of list) {
    const prox = CITYWIDE.has(t.kind) ? 0.6 : t.place && near ? Math.max(0, 1 - distKm(near, t.place) / 3) : 0;
    const v = (P.kind_weight[t.kind] ?? 0) * t.weight * prox;
    if (v > bv) { bv = v; best = t; }
  }
  return best;
}

function distKm(a, b) {
  const dx = (a[0] - b[0]) * 111.32 * Math.cos(((a[1] + b[1]) / 2) * Math.PI / 180), dy = (a[1] - b[1]) * 110.574;
  return Math.hypot(dx, dy);
}
