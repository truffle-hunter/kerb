// "Tonight" (ADR 0015, spec docs/superpowers/specs/2026-11-16-kerb-tonight-design.md): the night ahead as wave rows, quiet
// stretches, a rain band, cabs-out and tariff strips, seven week rows, and the driver's own record per wave. Pure
// functions over the bundle, the cached forecast and his log. Nothing here touches score() or the pick, and nothing
// here predicts a wait (ADR 0002), a drive or arrival time (ADR 0003), or blends his waits into the guess (ADR 0008).
import { triggersAround, timetableStatus } from './triggers.js';
import { dublinParts, dublinTime, addDays, hhmm } from './time.js';
import { distM } from './geo.js';

const MIN = 60000, HOUR = 3600000, DAY = 86400000;
const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WD_PLURAL = ['Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays', 'Sundays'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const NOT_IN_NIGHT = new Set(['rain', 'live_rail', 'live_luas']); // rain has its own band; live items are not a timetable
const CITYWIDE = new Set(['closing', 'late_closing']);
const RECORD_WEEKS = 12, RECORD_LAST = 8, RECORD_MIN = 3, HOURS_MIN_SHIFTS = 3;
const pad = (n) => String(n).padStart(2, '0');
const median = (xs) => { const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const fmtMin = (m) => (m >= 60 ? `${Math.floor(m / 60)} h ${Math.round(m % 60)} min` : `${Math.round(m)} min`);
const weekdayOf = (date) => dublinParts(dublinTime(date, '12:00')).weekday;
const nightDateOf = (t, P) => dublinParts(new Date(t.getTime() - P.night_to_hour * HOUR)).date;

/** "Thu 19 Nov" for a Dublin date. */
export const dayLabel = (date) => `${WD[weekdayOf(date)]} ${+date.slice(8)} ${MONTHS[+date.slice(5, 7) - 1]}`;

/** The night Kerb shows (spec §2): before 06:00 the rest of it; by day the coming one, 16:00-06:00; from 16:00, now to
 * 06:00. `date` names the night: the Dublin date of now - 6 h. */
export function nightWindow(now, P) {
  const date = nightDateOf(now, P);
  const start = dublinTime(date, `${pad(P.night_from_hour)}:00`);
  return { from: now < start ? start : now, to: dublinTime(addDays(date, 1), `${pad(P.night_to_hour)}:00`), date };
}

/** Timetabled items in [from, to]: trains, trams, ferries, let-outs, closing. No rain, no live relay items. */
export const nightItems = (ctx, from, to) =>
  triggersAround(from, ctx, 0, (to - from) / MIN).filter((x) => !NOT_IN_NIGHT.has(x.kind));

/** The key his waits record for an item (spec §8): let-outs by venue, closing citywide, timetables by kind and place. */
export function itemKey(x) {
  if (x.kind === 'event') return `event:${x.venue}`;
  if (CITYWIDE.has(x.kind) || !x.place) return x.kind;
  return `${x.kind}@${x.place[0].toFixed(3)},${x.place[1].toFixed(3)}`;
}

/** What a key is worth (kind weight x venue weight), so records and comparisons keep to waves that matter. */
export function keyValue(key, params) {
  const kw = params.demand.kind_weight;
  if (key.startsWith('event:')) return (kw.event ?? 0) * (params.demand.venue_weight[key.slice(6)] ?? 0.3);
  return kw[key.split('@')[0]] ?? 0;
}

const itemValue = (x, params) => (params.demand.kind_weight[x.kind] ?? 0) * x.weight;
const dotOf = (v, dots) => (v >= dots[2] ? 'large' : v >= dots[1] ? 'medium' : v >= dots[0] ? 'small' : 'ring');
export const stripClock = (label, t) => label.replace(new RegExp(`\\s*~?${hhmm(t)}`), '').replace(/\s+/g, ' ').trim();

function groupOf(x, i) {
  if (x.kind === 'last_rail' || x.kind === 'last_luas') return 'last';
  if (x.kind === 'ferry') return 'ferry';
  if (x.kind === 'late_arrival') { const m = /arrives (.+?) \d\d:\d\d/.exec(x.label); return m ? `arr:${m[1]}` : `one:${i}`; }
  return `one:${i}`; // let-outs, closing and anything else stand alone
}

function makeRow(items, group, params) {
  const first = items[0], last = items[items.length - 1], n = items.length;
  const value = Math.max(...items.map((x) => itemValue(x, params)));
  const keys = [...new Set(items.map(itemKey))];
  const approx = n === 1 && first.label.includes(`~${hhmm(first.t)}`);
  let title, name;
  if (n > 1 && group === 'last') name = 'Last trains and trams';
  else if (n > 1 && group.startsWith('arr:')) name = `Trains in at ${group.slice(4)}`;
  else if (n > 1 && group === 'ferry') name = 'Ferries berth';
  if (name) title = `${name} ×${n}`;
  else { title = stripClock(first.label, first.t); name = first.kind === 'event' ? title.replace(/ lets out$/, '') : title; }
  const clock = `${approx ? '~' : ''}${hhmm(first.t)}`;
  const recordKeys = keys.filter((k) => keyValue(k, params) >= params.plan.dots[0]);
  return { title, from: first.t, to: last.t, approx, n, value, dot: dotOf(value, params.plan.dots), kind: first.kind, keys, group,
    recordKeys: value >= params.plan.dots[0] ? recordKeys : [], short: `${clock} ${name}`,
    card: n > 1 ? `${name} from ${hhmm(first.t)}` : `${title} ${clock}`, items };
}

/** Items grouped into wave rows (spec §2), uncapped, in time order. A group carries on while each item is within the
 * kernel's end (60 min) of the previous one; ferries within 3 hours (plan review C1). A row's dot is its strongest item. */
export function waveRows(items, ctx) {
  const params = ctx.params, P = params.plan;
  const open = new Map(), groups = [];
  [...items].sort((a, b) => a.t - b.t).forEach((x, i) => {
    const g = groupOf(x, i), cur = open.get(g);
    const gap = (g === 'ferry' ? P.ferry_gap_min : params.demand.kernel_end_min) * MIN;
    if (cur && x.t - cur.items[cur.items.length - 1].t <= gap) cur.items.push(x);
    else { const ng = { g, items: [x] }; open.set(g, ng); groups.push(ng); }
  });
  return groups.map((x) => makeRow(x.items, x.g, params)).sort((a, b) => a.from - b.from);
}

/** At most `max` rows: the lowest values go first (on ties the later row), the rest stay in time order. */
export function capRows(rows, max) {
  if (rows.length <= max) return rows;
  const keep = new Set([...rows].sort((a, b) => b.value - a.value || a.from - b.from).slice(0, max));
  return rows.filter((r) => keep.has(r));
}

/** Gaps of at least plan.quiet_min between the rows' windows ([first - kernel lead, last + kernel end]) inside
 * [from, to] (spec §3). Pass every row, before the cap, so "nothing scheduled" is literally true. */
export function quietGaps(rows, from, to, params) {
  const lead = params.demand.kernel_lead_min * MIN, end = params.demand.kernel_end_min * MIN, q = params.plan.quiet_min * MIN;
  const wins = rows.map((r) => [r.from.getTime() - lead, r.to.getTime() + end]).sort((a, b) => a[0] - b[0]);
  const out = [];
  let cur = from.getTime();
  for (const [a, b] of wins) {
    if (a - cur >= q) out.push({ from: new Date(cur), to: new Date(Math.min(a, to.getTime())) });
    cur = Math.max(cur, b);
    if (cur >= to.getTime()) break;
  }
  if (to.getTime() - cur >= q) out.push({ from: new Date(cur), to });
  return out.filter((g) => g.to - g.from >= q);
}

/** The public tariff band at t (spec §5): Special Sat and Sun 00:00-04:00, Premium all Sunday and 20:00-08:00,
 * Standard 08:00-20:00 Mon-Sat. Public holidays are not modelled. */
export function tariffBand(t, P) {
  const p = dublinParts(t), [s0, s1] = P.tariff.special_hours, [a, b] = P.tariff.standard_hours;
  if ((p.weekday === 5 || p.weekday === 6) && p.hour >= s0 && p.hour < s1) return 'special';
  if (p.weekday === 6) return 'premium';
  return p.hour >= a && p.hour < b ? 'standard' : 'premium';
}

/** Many / some / few cabs out at t, from the NTA 2026 driver survey (Dublin % working per band). Not live. */
export function cabsOut(t, P) {
  const hour = dublinParts(t).hour, C = P.cabs_out;
  const start = Object.keys(C.bands).map(Number).filter((h) => h <= hour).sort((a, b) => a - b).pop();
  const pct = C.bands[String(start)];
  return pct >= C.many ? 'many' : pct >= C.some ? 'some' : 'few';
}

/** fn evaluated at `from` and each hour mark up to `to`, merged into [{value, from, to}]. */
export function spans(from, to, fn) {
  const out = [];
  let start = from, cur = fn(from);
  for (let b = Math.floor(from.getTime() / HOUR) * HOUR + HOUR; b < to.getTime(); b += HOUR) {
    const v = fn(new Date(b));
    if (v !== cur) { out.push({ value: cur, from: start, to: new Date(b) }); start = new Date(b); cur = v; }
  }
  out.push({ value: cur, from: start, to });
  return out;
}

const cap1 = (s) => s[0].toUpperCase() + s.slice(1);
const stripText = (sp, capital) => sp.map((s, i) => {
  const v = capital ? cap1(s.value) : s.value;
  return i === 0 ? `${v} to ${hhmm(s.to)}` : `${v} ${hhmm(s.from)}–${hhmm(s.to)}`;
}).join(' · ');

const fresh = (forecast, now, P) => !!forecast && now - forecast.fetched <= P.forecast_max_age_h * HOUR;
/** Is the cached forecast young enough to show (ADR 0016's detail reads its rain the same way as the band). */
export const forecastFresh = fresh;
const wetStep = (s, mm) => s.mm >= mm * ((s.to - s.from) / HOUR); // the same rate, 0.5 mm an hour, at any step length

/** The rain band (spec §4): hourly steps only, merged; the clock in brackets is the forecast's issue time. */
function rainBand(forecast, w, now, params) {
  if (!fresh(forecast, now, params.plan)) return { text: 'No forecast', first: null };
  const hourly = forecast.steps.filter((s) => s.to - s.from === HOUR && s.to > w.from && s.from < w.to);
  if (!hourly.length) return { text: 'No forecast', first: null };
  const spansWet = [];
  for (const s of hourly.filter((x) => x.mm >= params.demand.rain_mm)) {
    const last = spansWet[spansWet.length - 1];
    if (last && s.from <= last.to) last.to = s.to > last.to ? s.to : last.to; else spansWet.push({ from: s.from, to: s.to });
  }
  const issued = forecast.issued ? ` (forecast ${hhmm(forecast.issued)})` : '';
  if (!spansWet.length) return { text: `No rain forecast tonight${issued}`, first: null };
  const clip = (s) => `${hhmm(s.from < w.from ? w.from : s.from)}–${hhmm(s.to > w.to ? w.to : s.to)}`;
  return { text: `Rain ${spansWet.map(clip).join(', ')}${issued}`, first: spansWet[0].from < w.from ? w.from : spansWet[0].from };
}

const strongest = (rows) => [...rows].sort((a, b) => b.value - a.value || a.from - b.from);

/** Seven nights from `date` (spec §6): the two strongest waves, a rain mark where the forecast reaches, "Stands out"
 * for a stadium let-out, two let-outs, or a let-out in rain; nights after the timetables run out are not loaded. */
export function weekRows(ctx, steps, date, params) {
  const P = params.plan, D = params.demand, to = ctx.triggers && ctx.triggers.to;
  return Array.from({ length: 7 }, (_, i) => {
    const d = addDays(date, i);
    const from = dublinTime(d, `${pad(P.night_from_hour)}:00`), end = dublinTime(addDays(d, 1), `${pad(P.night_to_hour)}:00`);
    const covering = (a, b) => steps.filter((s) => s.to > a && s.from < b);
    const near = covering(from, end);
    const rain = near.length ? near.some((s) => wetStep(s, D.rain_mm)) : null;
    if (!to || d > to) return { date: d, label: dayLabel(d), top: [], rain, standsOut: false, loaded: false };
    const rows = waveRows(nightItems(ctx, from, end), ctx);
    const top = strongest(rows).slice(0, 2).sort((a, b) => a.from - b.from);
    const lets = rows.filter((r) => r.kind === 'event');
    const wetLet = lets.some((r) => covering(new Date(r.from - D.kernel_lead_min * MIN), new Date(r.to.getTime() + D.kernel_end_min * MIN))
      .some((s) => wetStep(s, D.rain_mm)));
    const standsOut = lets.some((r) => r.items[0].weight >= P.stadium_weight) || lets.length >= 2 || wetLet;
    return { date: d, label: dayLabel(d), top, rain, standsOut, loaded: true };
  });
}

/** Up to two waves worth a small dot or more starting in the next end_shift_ahead_h hours, in time order (spec §7). */
export function stillToCome(ctx, now, params) {
  const rows = waveRows(nightItems(ctx, now, new Date(now.getTime() + params.plan.end_shift_ahead_h * HOUR)), ctx);
  return rows.filter((r) => r.value >= params.plan.dots[0] && r.from >= now).slice(0, 2);
}

/** The End shift line, or null: never from the first fatigue mark (ADR 0010), never with nothing to come. */
export function endShiftLine(ctx, now, params, onShiftMin) {
  if (onShiftMin >= params.shift.fatigue_h[0] * 60) return null;
  const rows = stillToCome(ctx, now, params);
  return rows.length ? `Still to come: ${rows.map((r) => r.short).join(' · ')}` : null;
}

/** The keys of the waves a wait at `stand` beginning at t sits inside (spec §8): t within [item - kernel lead, item +
 * kernel end], the item within proximity of the stand (events farther), or citywide (closing). */
export function waveKeysAt(stand, t, ctx) {
  const D = ctx.params.demand, keys = new Set();
  for (const x of triggersAround(t, ctx, D.kernel_end_min, D.kernel_lead_min)) {
    if (NOT_IN_NIGHT.has(x.kind)) continue;
    if (CITYWIDE.has(x.kind)) { keys.add(itemKey(x)); continue; }
    if (!stand || !stand.head || !x.place) continue;
    if (distM(stand.head, x.place) <= (x.kind === 'event' ? D.event_proximity_m : D.proximity_m)) keys.add(itemKey(x));
  }
  return [...keys];
}

const counted = (w) => w.confirmed !== false && !w.off_shift && Number.isFinite(w.wait_min);
const hasWaves = (w) => !!w.shown && Array.isArray(w.shown.waves);
const atLeastOne = (w) => w.outcome !== 'fare' || !!(w.end_uncertain || w.start_uncertain);

/** His confirmed on-shift waits at a row's waves, from the last 12 weeks, last 8; null under 3 or on a minor row. */
export function rowRecord(waits, row, now) {
  if (!row || !row.recordKeys || !row.recordKeys.length) return null;
  const since = now - RECORD_WEEKS * 7 * DAY;
  const used = waits.filter((w) => counted(w) && hasWaves(w) && w.shown.waves.some((k) => row.recordKeys.includes(k))
    && Date.parse(w.joined_at) >= since && Date.parse(w.joined_at) <= now)
    .sort((a, b) => Date.parse(b.joined_at) - Date.parse(a.joined_at)).slice(0, RECORD_LAST);
  if (used.length < RECORD_MIN) return null;
  return { n: used.length, median: median(used.map((w) => w.wait_min)), fares: used.filter((w) => w.outcome === 'fare').length,
    atLeast: used.filter(atLeastOne).length * 2 >= used.length };
}

/** "Your waits at this: last 4, usually 6 min, 3 ended in a fare" (ADR 0008 style), or null. */
export const recordLine = (rec) => (rec
  ? `Your waits at this: last ${rec.n}, usually ${rec.atLeast ? 'at least ' : ''}${fmtMin(rec.median)}, ${rec.fares} ended in a fare` : null);

const HOUR_BANDS = [[16, '16–20'], [20, '20–24'], [0, '00–04']];
const bandOf = (hour) => (hour >= 16 && hour < 20 ? 16 : hour >= 20 ? 20 : hour < 4 ? 0 : null);

/** His own hours for tonight's weekday (spec §8): shift time and rank fares per 4-hour band, by the night they belong to
 * (t - 6 h, ruling), from the last 12 weeks; a band is shown from 3 shifts. */
export function yourHours(shifts, waits, now, w) {
  const P = { night_to_hour: 6 };
  const wd = weekdayOf(w.date), since = now - RECORD_WEEKS * 7 * DAY;
  const bandStart = (b) => dublinTime(b === 0 ? addDays(w.date, 1) : w.date, `${pad(b)}:00`);
  const shown = HOUR_BANDS.filter(([b]) => { const a = bandStart(b); return a < w.to && new Date(a.getTime() + 4 * HOUR) > w.from; });
  const cell = new Map(shown.map(([b]) => [b, { ms: 0, shifts: new Set(), fares: 0 }]));
  const cellOf = (t) => { const b = bandOf(dublinParts(t).hour); return b != null && weekdayOf(nightDateOf(t, P)) === wd ? cell.get(b) : null; };
  for (const s of shifts) {
    const a0 = Date.parse(s.start), b0 = s.end ? Date.parse(s.end) : now.getTime();
    if (a0 < since || a0 > now) continue;
    for (let a = a0; a < b0;) {
      const b = Math.min(b0, Math.floor(a / HOUR) * HOUR + HOUR);
      const c = cellOf(new Date(a));
      if (c) { c.ms += b - a; c.shifts.add(s.start); }
      a = b;
    }
  }
  for (const x of waits) {
    if (!counted(x) || x.outcome !== 'fare') continue;
    const t = Date.parse(x.joined_at);
    if (t < since || t > now) continue;
    const c = cellOf(new Date(t));
    if (c) c.fares++;
  }
  return shown.filter(([b]) => cell.get(b).shifts.size >= HOURS_MIN_SHIFTS).map(([b, label]) => {
    const c = cell.get(b);
    return { label: `Your ${WD_PLURAL[wd]} ${label}`,
      text: `${plural(c.fares, 'rank fare')} in ${Math.round(c.ms / HOUR)} h on shift (${c.shifts.size} shifts)` };
  });
}

/** Waits that began during a wave worth a small dot or more, against the rest (Stats, the kill criterion). Only
 * confirmed on-shift waits that carry `waves` (logged after this release) count. */
export function wavesSplit(waits, params) {
  const ok = waits.filter((w) => counted(w) && hasWaves(w));
  const big = (w) => w.shown.waves.some((k) => keyValue(k, params) >= params.plan.dots[0]);
  const sum = (ws) => ({ n: ws.length, median: ws.length ? median(ws.map((w) => w.wait_min)) : null, fares: ws.filter((w) => w.outcome === 'fare').length });
  return { during: sum(ok.filter(big)), other: sum(ok.filter((w) => !big(w))) };
}

/** The rows a night shows: from its start, and once it has begun also the waves still in their tail (the kernel's end,
 * 60 min), so a wave never drops off, and the night is never called quiet, the minute its clock passes (review I1). */
function shownRows(ctx, w, now) {
  const tail = w.from.getTime() === now.getTime() ? ctx.params.demand.kernel_end_min * MIN : 0;
  return waveRows(nightItems(ctx, new Date(w.from.getTime() - tail), w.to), ctx);
}

/** A row's identity across the minute rebuild (ADR 0016 J3): its group, or its item's key when it stands alone, and the
 * time of its last item. Tails are stable while the head drops off, so the key holds until the row is gone. */
export const rowKey = (row) => `${row.group.startsWith('one:') ? itemKey(row.items[0]) : row.group}|${row.to.getTime()}`;
/** A quiet stretch's identity: the end of the gap. */
export const quietKey = (gap) => `quiet|${gap.to.getTime()}`;
/** The span Kerb counts a row over: first item - kernel lead to last item + kernel end, in ms (spec §3). */
export const rowWindow = (row, params) => [row.from.getTime() - params.demand.kernel_lead_min * MIN, row.to.getTime() + params.demand.kernel_end_min * MIN];

/** The night's rows, uncapped, and its quiet stretches: what the list and every row's detail are built from (ADR 0016),
 * so the two always agree. No quiet stretch on a stale bundle (plan review I4). */
export function nightRows(ctx, now) {
  const params = ctx.params, w = nightWindow(now, params.plan);
  const all = shownRows(ctx, w, now);
  const timetable = timetableStatus(now, ctx);
  const loaded = timetable.current && !!ctx.triggers && w.date <= ctx.triggers.to;
  return { window: w, all, timetable, loaded, gaps: loaded ? quietGaps(all, w.from, w.to, params) : [] };
}

function cardText(all, rain) {
  const lets = all.filter((r) => r.kind === 'event').length, top = strongest(all)[0];
  return (lets ? `Tonight: ${plural(lets, 'let-out')}` : top ? `Tonight: ${top.card}` : 'Tonight: nothing scheduled')
    + (rain.first ? ` · rain from ${hhmm(rain.first)}` : '');
}

/** The off-shift line alone, from the rows and the rain: no log, no week (review I3: it is rebuilt on every tick). */
export function tonightCard(ctx, now, forecast) {
  const w = nightWindow(now, ctx.params.plan);
  return cardText(shownRows(ctx, w, now), rainBand(forecast, w, now, ctx.params));
}

/** Everything the sheet shows, as plain data (the UI maps it onto nodes and does no arithmetic of its own). */
export function tonightModel({ ctx, now, forecast, waits, shifts }) {
  const params = ctx.params, P = params.plan;
  const { window: w, all, timetable, gaps } = nightRows(ctx, now);
  const rows = capRows(all, P.max_rows);
  const entries = [
    ...rows.map((row) => ({ type: 'wave', row, record: recordLine(rowRecord(waits, row, now)), key: rowKey(row) })),
    ...gaps.map((g) => ({ type: 'quiet', from: g.from, to: g.to, key: quietKey(g) })),
  ].sort((a, b) => (a.type === 'quiet' ? a.from : a.row.from) - (b.type === 'quiet' ? b.from : b.row.from));
  const rain = rainBand(forecast, w, now, params);
  const card = cardText(all, rain);
  return {
    title: `Tonight, ${dayLabel(w.date)}`, window: w, timetable, entries, rain: rain.text, card,
    cabs: stripText(spans(w.from, w.to, (t) => cabsOut(t, P)), false),
    tariff: stripText(spans(w.from, w.to, (t) => tariffBand(t, P)), true),
    week: weekRows(ctx, fresh(forecast, now, P) ? forecast.steps : [], w.date, params),
    hours: yourHours(shifts, waits, now, w),
  };
}
