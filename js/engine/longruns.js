// "Long runs" (ADR 0017, spec docs/superpowers/specs/2026-11-16-kerb-long-runs-design.md): where a 10 km+ fare is more
// likely, now and later tonight. Pure functions over the bundle (stands, catchments, timetables, params.long), legal
// status at each entry's own time, score() for the demand level beside it, and his log for his own record. Nothing
// here changes score() or the pick, predicts a wait (ADR 0002), gives a drive, arrival or leave-by time (ADR 0003),
// names a fare in euro (charter), or names a town as served or unserved by night buses (spec §6).
import { status } from './legal.js';
import { score } from './demand.js';
import { triggersAround, timetableStatus } from './triggers.js';
import { nightWindow, dayLabel } from './tonight.js';
import { dublinParts, dublinTime, addDays, daysBetween, hhmm } from './time.js';
import { distM } from './geo.js';

const MIN = 60000, HOUR = 3600000, DAY = 86400000;
const COUNTS = new Set(['open', 'event_active']);
const LISTABLE = new Set(['open', 'event_active', 'hours_unknown']); // the airport and stations: unpublished hours are named
const LEVEL = { low: 1, medium: 2, high: 3 };
const KINDS = ['airport', 'hotel', 'trains', 'dart'];
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const STATION = /arrives (.+?) \d\d:\d\d/;

const fmtKm = (km, approx) => `${approx ? '~' : ''}${km < 10 ? km.toFixed(1) : Math.round(km)} km`; // as ui/dom.js fmtKm
const and = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const fullDate = (d) => `${+d.slice(8)} ${MONTHS[+d.slice(5, 7) - 1]} ${d.slice(0, 4)}`;
const span = (a, b) => (hhmm(a) === hhmm(b) ? hhmm(a) : `${hhmm(a)}–${hhmm(b)}`);

/** The card's fixed lines (spec §3, §5), verbatim. */
function fixed(L) {
  return {
    sub: 'Where a long fare is more likely. Guesses: nobody publishes trip lengths by rank.',
    means: `Long means ${L.km} km or more. One Dublin fare in four was 9.5 km or more (NTA meter survey, 2015).`,
    tariff: "After about 15 km the meter's rate per km goes up, except Saturday and Sunday 00:00–04:00 and special nights (S.I. 479/2024).",
    footer: "A long run usually means an empty drive back (Kerb's reasoning). Dublin cabs drove 8.0 km before each hiring for every 6.9 km hired (NTA 2015).",
    honest: "Timetables and guesses · length is Kerb's reasoning, not a measurement",
    empty: "Nothing on Kerb's list right now. Long fares still turn up anywhere.",
  };
}

/** The windows every kind is judged by, for the night Tonight shows (spec §4): its date D names the evening; the hotel
 * window alone goes by the clock (plan review C4). Times come from triggers.json only. */
function windows(ctx, now) {
  const params = ctx.params, L = params.long, P = params.demand;
  const w = nightWindow(now, params.plan), D = w.date, next = addDays(D, 1);
  const horizon = new Date(w.to.getTime() + HOUR);
  const timetable = timetableStatus(now, ctx);
  const loaded = timetable.current && !!ctx.triggers && D <= ctx.triggers.to;
  const items = loaded ? ctx.triggers.items.map((x) => ({ ...x, t: new Date(Date.parse(x.t)) })) : [];
  const between = (a, b) => (x) => x.t >= a && x.t <= b;
  const evening = between(dublinTime(D, '21:00'), dublinTime(next, '03:00'));
  const lastRail = items.filter((x) => x.kind === 'last_rail' && evening(x)).sort((a, b) => a.t - b.t);
  const luas = items.filter((x) => x.kind === 'last_luas' && evening(x)).sort((a, b) => a.t - b.t);
  // hotels: the next 04:00-06:30 whose end is after now
  const today = dublinParts(now).date;
  let hotel = { from: dublinTime(today, L.hotel.from), to: dublinTime(today, L.hotel.to) };
  if (now >= hotel.to) hotel = { from: dublinTime(addDays(today, 1), L.hotel.from), to: dublinTime(addDays(today, 1), L.hotel.to) };
  const late = items.filter((x) => x.kind === 'late_arrival' && between(dublinTime(D, L.trains.after), dublinTime(next, '04:00'))(x));
  const trains = Object.keys(L.trains.stations).map((station) => {
    const its = late.filter((x) => (STATION.exec(x.label) || [])[1] === station).sort((a, b) => a.t - b.t);
    if (!its.length) return null;
    const first = its[0].t, last = its[its.length - 1].t;
    return { station, items: its, first, last, openFrom: new Date(first.getTime() - P.kernel_before_min * MIN),
      openTo: new Date(last.getTime() + P.kernel_flat_min * MIN), lastDep: lastRail.filter((x) => x.label.includes(station)).pop() || null };
  }).filter(Boolean);
  const dartItem = lastRail.find((x) => x.label.startsWith(L.dart.label)) || null;
  const dart = dartItem ? { item: dartItem, from: dartItem.t, to: dublinTime(next, L.dart.until) } : null;
  return { D, horizon, timetable, loaded, hotel, trains, dart, luas };
}

/** Stand lists, scoring and levels, memoised per call (one trigger scan per judging time). */
function judge(ctx, now) {
  const byId = new Map(ctx.stands.map((s) => [s.id, s]));
  const P = ctx.params.demand;
  const trig = new Map(), scores = new Map();
  const ctxAt = (at) => (at.getTime() === now.getTime() ? ctx : { ...ctx, weather: null, live: null }); // plan review M4
  const scoreAt = (s, at) => {
    const k = `${s.id}|${at.getTime()}`;
    if (!scores.has(k)) {
      const c = ctxAt(at);
      if (!trig.has(at.getTime())) trig.set(at.getTime(), triggersAround(at, c, P.kernel_end_min, P.kernel_lead_min ?? 60));
      scores.set(k, score(s, at, c, trig.get(at.getTime())));
    }
    return scores.get(k);
  };
  const state = (s, t) => status(s, t, ctx).state;
  const level = (ids, at) => ids.map((id) => scoreAt(byId.get(id), at).level).reduce((a, b) => (LEVEL[b] > LEVEL[a] ? b : a), 'low');
  return { byId, scoreAt, state, level };
}

/** One stand per street, in the given order (twins and same-street stands are one place to a driver; spec §4). */
function perStreet(list) {
  const seen = new Set();
  return list.filter((s) => (seen.has(s.street) ? false : (seen.add(s.street), true)));
}

function nightBus(L, D, now) {
  const N = L.nightbus;
  if (daysBetween(N.checked, dublinParts(now).date) > N.max_age_days) return { nitelink: null, allnight: null };
  const wd = dublinParts(dublinTime(D, '12:00')).weekday;
  return {
    nitelink: N.nitelink_nights.includes(wd) ? 'Nitelink buses run tonight (TFI).'
      : `Nitelink runs ${and(N.nitelink_nights.map((d) => DAYS[d]))} nights only (TFI, checked ${fullDate(N.checked)}).`,
    allnight: `${N.allnight_routes} bus routes run all night (TFI).`,
  };
}

const luasLine = (luas) => (luas.length ? `last Luas from the centre ${span(luas[0].t, luas[luas.length - 1].t)}` : null);

/** Every entry open now or starting before the horizon, before the per-entry extras (head, nearest, record). */
function entries(ctx, now, permit) {
  const L = ctx.params.long, W = windows(ctx, now), J = judge(ctx, now);
  const bus = nightBus(L, W.D, now);
  const out = [];
  const unpublished = (ids, at) => ids.some((id) => J.state(J.byId.get(id), at) === 'hours_unknown');
  const push = (e) => {
    if (!e.stands.length) return;
    if (!e.open && !(e.from < W.horizon)) return;
    if (unpublished(e.stands, e.at)) e.text += ' Rank hours not published.';
    out.push(e);
  };

  if (permit) {
    const ids = L.airport.stands.filter((id) => J.byId.has(id) && LISTABLE.has(J.state(J.byId.get(id), now)));
    push({ kind: 'airport', key: 'airport', name: 'Dublin Airport T1 and T2', when: 'any hour', from: null, to: null, open: true, at: now,
      stands: ids, places: null, level: J.level(ids, now),
      text: `City-centre ranks are about ${L.km_from_airport} km away by road (Kerb's map); half of Dublin fares were under 4.5 km (NTA 2015). `
        + '22 in 100 passengers left the airport by taxi (NTA airport survey 2022, weekdays). '
        + `Kerb's reasoning: most fares from here pass ${L.km} km. Kerb can't see the holding-area queue.` });
  }

  { // hotels before the first flights
    const open = now >= W.hotel.from, at = open ? now : W.hotel.from, rooms = (s) => ctx.catchments?.[s.id]?.rooms ?? 0;
    const listed = perStreet(ctx.stands.filter((s) => s.head && rooms(s) >= L.hotel.min_rooms && COUNTS.has(J.state(s, at)))
      .sort((a, b) => rooms(b) - rooms(a) || (a.id < b.id ? -1 : 1))).slice(0, L.hotel.max);
    push({ kind: 'hotel', key: 'hotel', name: 'Hotel ranks before the first flights', when: `${L.hotel.from}–${L.hotel.to}`,
      from: W.hotel.from, to: W.hotel.to, open, at, stands: listed.map((s) => s.id), places: listed.map((s) => s.street).join(', '),
      level: J.level(listed.map((s) => s.id), at),
      text: `${and(listed.map((s) => rooms(s).toLocaleString('en-IE')))} hotel rooms within 400 m (Fáilte Ireland register). `
        + `The airport is about ${L.km_to_airport} km by road (Kerb's map). About 3 in 10 passengers reached the airport before 07:00, `
        + 'and 1 in 4 came by taxi (NTA airport survey 2022, weekdays). '
        + "Kerb's reasoning: early flights mean airport runs from hotels. Many are booked ahead, which Kerb can't see." });
  }

  for (const T of W.trains) { // late InterCity arrivals, per station
    if (now > T.openTo) continue;
    const open = now >= T.openFrom, at = open ? now : T.first;
    const listed = perStreet(L.trains.stations[T.station].map((id) => J.byId.get(id)).filter((s) => s && LISTABLE.has(J.state(s, at))));
    if (!listed.length) continue;
    const rank = listed[0].name.includes(T.station) ? listed[0].name : `${listed[0].name} (${T.station})`;
    const shown = (open ? T.items.filter((x) => x.t >= now.getTime() - ctx.params.demand.kernel_flat_min * MIN) : T.items).slice(0, L.trains.max_items);
    const arrivals = shown.map((x, i) => { const s = x.label.replace(` arrives ${T.station} `, ' arrives '); return i ? s[0].toLowerCase() + s.slice(1) : s; });
    const dep = [T.lastDep ? T.lastDep.label : null, luasLine(W.luas)].filter(Boolean);
    const depLine = dep.length ? ` ${dep[0][0].toUpperCase()}${dep.join('; ').slice(1)} (timetables).` : '';
    push({ kind: 'trains', key: `trains:${T.station}`, name: rank, when: span(T.first, T.last), from: T.first, to: T.last, open, at,
      stands: listed.map((s) => s.id), places: null, level: J.level(listed.map((s) => s.id), at),
      text: `${arrivals.join('; ')} (Irish Rail timetable).${depLine}${bus.nitelink ? ` ${bus.nitelink}` : ''} `
        + "Kerb's reasoning: some people off a late train are going beyond the tram lines; many only go into town." });
  }

  if (W.dart && now < W.dart.to) { // the centre after the last DART; picks judged at the window start (plan review M2)
    const open = now >= W.dart.from, t0 = W.dart.from;
    const near = ctx.stands.filter((s) => s.head && distM(s.head, L.dart.centre) <= L.dart.centre_m
      && COUNTS.has(J.state(s, t0)) && (!open || COUNTS.has(J.state(s, now))));
    const listed = perStreet(near.map((s) => ({ s, v: J.scoreAt(s, t0).score })).sort((a, b) => b.v - a.v || (a.s.id < b.s.id ? -1 : 1))
      .map((x) => x.s)).slice(0, L.dart.max);
    const ids = listed.map((s) => s.id);
    const deps = [W.dart.item.label, luasLine(W.luas)].filter(Boolean).join('; ');
    push({ kind: 'dart', key: 'dart', name: 'City centre after the last DART', when: `${hhmm(t0)}–${L.dart.until}`, from: t0, to: W.dart.to,
      open, at: t0, stands: ids, places: listed.map((s) => s.street).join(', '), level: J.level(ids, open ? now : t0),
      text: `${deps} (timetables).${bus.nitelink ? ` ${bus.nitelink}` : ''}${bus.allnight ? ` ${bus.allnight}` : ''} `
        + "Kerb's reasoning: with trains finished, some people going far take a cab." });
  }
  return { out, W, J };
}

/** His own record for an entry (ADR 0008): from 3 answered fares in the last 12 weeks whose join snapshot holds the
 * entry's key. Past tense, counts only, never in the score or the order. */
function record(waits, key, now, L) {
  const since = now.getTime() - L.record.weeks * 7 * DAY;
  const answered = (waits || []).filter((w) => w.confirmed !== false && w.outcome === 'fare' && typeof w.long === 'boolean'
    && w.shown && Array.isArray(w.shown.long) && w.shown.long.includes(key)
    && Date.parse(w.joined_at) >= since && Date.parse(w.joined_at) <= now.getTime());
  if (answered.length < L.record.min) return null;
  return `${answered.filter((w) => w.long).length} of your ${answered.length} answered fares here were long.`;
}

/** Everything the card shows, as plain data (spec §12). kmById is null without a real fix (plan review I2). */
export function longModel({ ctx, now, permit = false, kmById = null, waits = [] }) {
  const L = ctx.params.long, F = fixed(L);
  const { out, W, J } = entries(ctx, now, permit);
  for (const e of out) {
    e.head = `${e.name} · ${e.when} · Demand likely: ${e.level}`;
    e.nearest = null;
    if (e.open && kmById) {
      const best = e.stands.map((id) => [id, kmById[id]]).filter(([, k]) => k && Number.isFinite(k.km)).sort((a, b) => a[1].km - b[1].km)[0];
      if (best) e.nearest = `Nearest: ${J.byId.get(best[0]).name}, ${fmtKm(best[1].km, best[1].approx)} from you`;
    }
    e.record = record(waits, e.key, now, L);
  }
  const now_ = out.filter((e) => e.open)
    .sort((a, b) => LEVEL[b.level] - LEVEL[a.level] || KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) || (a.from || 0) - (b.from || 0));
  const later = out.filter((e) => !e.open).sort((a, b) => a.from - b.from);
  const to = W.timetable.to;
  return {
    title: 'Long runs', sub: F.sub, means: F.means, tariff: F.tariff, now: now_, later, empty: now_.length ? null : F.empty,
    stale: W.timetable.current ? null : `Timetables out of date (they ran to ${to ? dayLabel(to) : 'an earlier date'}): train entries not shown`,
    footer: F.footer, honest: F.honest,
  };
}

/** The entry keys whose window is open at t and whose candidate set holds `stand` (spec §9: the join snapshot), all of
 * each kind's stands, not only the listed top 3. */
export function longKindsAt(stand, t, ctx, permit = false) {
  if (!stand) return [];
  const L = ctx.params.long, W = windows(ctx, t);
  const st = status(stand, t, ctx).state, keys = [];
  if (permit && L.airport.stands.includes(stand.id) && LISTABLE.has(st)) keys.push('airport');
  if (t >= W.hotel.from && t < W.hotel.to && stand.head && (ctx.catchments?.[stand.id]?.rooms ?? 0) >= L.hotel.min_rooms && COUNTS.has(st)) keys.push('hotel');
  for (const T of W.trains) {
    if (t >= T.openFrom && t <= T.openTo && L.trains.stations[T.station].includes(stand.id) && LISTABLE.has(st)) keys.push(`trains:${T.station}`);
  }
  if (W.dart && t >= W.dart.from && t < W.dart.to && stand.head && distM(stand.head, L.dart.centre) <= L.dart.centre_m && COUNTS.has(st)) keys.push('dart');
  return keys;
}

/** The fare to ask about during the wait that began at joinedAt (ISO): his most recent finished wait before it, if that
 * ended in a fare under trip_prompt_h hours ago, logged by this release (a long list in its snapshot) and unanswered. */
export function tripAsk(waits, joinedAt, now, params) {
  if (!joinedAt) return null;
  const j = Date.parse(joinedAt);
  let best = null;
  for (const w of waits || []) {
    if (!w.ended_at) continue;
    const e = Date.parse(w.ended_at);
    if (e <= j && (!best || e > Date.parse(best.ended_at))) best = w;
  }
  if (!best || best.outcome !== 'fare' || typeof best.long === 'boolean') return null;
  if (!best.shown || !Array.isArray(best.shown.long)) return null; // plan review I3: no question about waits from before ADR 0017
  return now.getTime() - Date.parse(best.ended_at) < params.long.trip_prompt_h * HOUR ? best : null;
}
