// "Why this?" on every Tonight row (ADR 0016, spec docs/superpowers/specs/2026-11-16-kerb-tonight-why-design.md): every
// reason a row is on the night, as plain strings, like explain() does for a rank. Pure: all wording and arithmetic live
// here; the sheet only maps fields to nodes. Ranks are judged at each item's own time, never at now. Nothing here
// predicts a wait (ADR 0002), shows a drive, arrival or leave-by clock (ADR 0003), or touches the score.
import { nightRows, rowKey, quietKey, rowWindow, rowRecord, recordLine, tariffBand, cabsOut, spans, forecastFresh, dayLabel,
  stripClock } from './tonight.js';
import { status } from './legal.js';
import { distM } from './geo.js';
import { twins } from './demand.js';
import { dublinParts, hhmm } from './time.js';

const HOUR = 3600000, MIN = 60000;
const OPEN = new Set(['open', 'event_active']); // "open then": hours_unknown is named, never counted (plan review, Codex)
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const VENUE_NAMES = { aviva: 'Aviva Stadium', 'croke-park': 'Croke Park', '3arena': '3Arena', rds: 'RDS', dalymount: 'Dalymount Park',
  'richmond-park': 'Richmond Park', 'shelbourne-park': 'Shelbourne Park', 'tolka-park': 'Tolka Park' };
const FOOTER = "Timetables and guesses. Kerb never predicts how long you'll wait, or that anyone will be there.";
const RECORD_NOTE = 'Shown for you; not part of the demand guess.';
const DOT = { large: 'Large dot', medium: 'Medium dot', small: 'Small dot', ring: 'Ring' };
const PLACE = { event: 'venue', late_arrival: 'station', ferry: 'terminal', last_rail: 'stop', last_luas: 'stop' };
const TIMETABLE = new Set(['last_rail', 'last_luas', 'late_arrival', 'ferry']);
const SPAN_WORDS = { 30: 'half an hour', 45: 'three quarters of an hour', 60: 'an hour', 90: 'an hour and a half', 120: 'two hours' };

const num = (v) => String(+v.toFixed(2));
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const dMon = (iso) => `${+iso.slice(8, 10)} ${MONTHS[+iso.slice(5, 7) - 1]}`;
const r10 = (m) => Math.round(m / 10) * 10;
const dist = (m) => (m < 20 ? 'under 20 m' : `${r10(m)} m`); // as the Why sheet: never "0 m", no false precision
const within = (m) => (m >= 1000 ? `${num(m / 1000)} km` : `${m} m`);
const clockOf = (r) => (r.n === 1 ? `${r.approx ? '~' : ''}${hhmm(r.from)}` : `${hhmm(r.from)}–${hhmm(r.to)}`);
const spanWords = (m) => SPAN_WORDS[m] || `${m} minutes`;
const radiusOf = (kind, D) => (kind === 'event' ? D.event_proximity_m : D.proximity_m);

/** Recommendable stands with a head within `radius` of `place`, nearest first, with their legal state at t. */
function nearStands(ctx, place, t, radius) {
  if (!place) return [];
  const out = [];
  for (const s of ctx.stands || []) {
    if (!s.recommendable || !s.head) continue;
    const d = distM(s.head, place);
    if (d <= radius) out.push({ s, d, state: status(s, t, ctx).state });
  }
  return out.sort((a, b) => a.d - b.d);
}

/** Twins (same street within 300 m) as one place, then one line per distinct name, nearest first. */
function places(list) {
  const groups = [];
  for (const o of list) {
    const g = groups.find((x) => twins(x[0].s, o.s));
    if (g) g.push(o); else groups.push([o]);
  }
  const seen = new Set();
  return groups.filter((g) => !seen.has(g[0].s.name) && seen.add(g[0].s.name));
}

function whereOf(g) {
  const lo = g[0].d, hi = g[g.length - 1].d;
  return g.length === 1 || r10(lo) === r10(hi) ? dist(lo) : `${lo < 20 ? 'under 20' : r10(lo)}–${r10(hi)} m`;
}

function placeText(g) {
  const unknown = !g.some((o) => OPEN.has(o.state));
  return `${g[0].s.name}${g.length > 1 ? ` (${g.length} stands)` : ''} ${whereOf(g)}${unknown ? ', hours not published' : ''}`;
}

/** ADR 0018: a rank as a one-tap row to his nav app. `now` is its legal status at the tap when that isn't open. */
export function goItem(s, now, ctx, { where = null, twins = 1, skipped = false, unknown = false, place = null } = {}) {
  const st = status(s, now, ctx);
  return { id: s.id, name: s.name, head: s.head || null, where, twins, skipped, unknown, place, now: OPEN.has(st.state) ? null : st };
}

/** A twin group's Go: its nearest member open then, else the first (spec §2). */
function groupGo(g, now, ctx, place) {
  const open = g.find((o) => OPEN.has(o.state));
  const chosen = open || g[0];
  return goItem(chosen.s, now, ctx, { where: whereOf(g), twins: g.length, skipped: chosen !== g[0], unknown: !open, place });
}

/** Ranks around one place (a let-out, or a row whose items share one place), judged at the item's own time (spec §6).
 * ADR 0018: also the same ranks as Go rows: {lines, go: {lead, items, rest}}; the lines are unchanged. */
function placeRanks(ctx, item, now) {
  const radius = radiusOf(item.kind, ctx.params.demand);
  const near = nearStands(ctx, item.place, item.t, radius);
  const shown = places(near.filter((o) => OPEN.has(o.state) || o.state === 'hours_unknown')).slice(0, 3);
  const open = near.filter((o) => OPEN.has(o.state)).length;
  const lines = [];
  if (shown.length) lines.push(`${open ? 'Open then' : 'Nearest'}, straight line from the ${PLACE[item.kind] || 'stop'}: ${shown.map(placeText).join(' · ')}`);
  lines.push(open === 0 ? `No rank within ${within(radius)} is known to be open then.`
    : open === 1 ? `1 rank within ${within(radius)} is open then.` : `${open} ranks within ${within(radius)} are open then.`);
  const idle = [...new Set(near.filter((o) => o.state === 'event_inactive').map((o) => o.s.name))];
  if (idle.length) lines.push(`Not in use then: ${idle.join(', ')} (event stands, no event on).`);
  const word = PLACE[item.kind] || 'stop';
  const go = shown.length ? { lead: lines[0].slice(0, lines[0].indexOf(': ')), items: shown.map((g) => groupGo(g, now, ctx, word)), rest: lines.slice(1) }
    : { lead: null, items: [], rest: lines };
  return { lines, go };
}

/** The nearest rank open (or of unpublished hours) at one item's time, for rows that span more than one place. */
function itemRank(ctx, x, now) {
  const radius = radiusOf(x.kind, ctx.params.demand);
  const o = nearStands(ctx, x.place, x.t, radius).find((y) => OPEN.has(y.state) || y.state === 'hours_unknown');
  if (!o) return { text: ` · no rank open then within ${within(radius)}`, go: null };
  return { text: ` · ${o.s.name} ${dist(o.d)}${o.state === 'hours_unknown' ? ', hours not published' : ''}`,
    go: goItem(o.s, now, ctx, { where: dist(o.d), unknown: o.state === 'hours_unknown', place: PLACE[x.kind] || 'stop' }) };
}

/** Closing times: citywide, so the ranks with most pubs within the catchment radius, open then (ties: stands.json order). */
function pubRanks(ctx, t, now) {
  const cat = ctx.catchments || {};
  const top = (ctx.stands || []).filter((s) => s.recommendable && cat[s.id] && OPEN.has(status(s, t, ctx).state))
    .sort((a, b) => cat[b.id].pubs - cat[a.id].pubs);
  const seen = new Set(), names = [], picks = [];
  for (const s of top) { if (seen.has(s.name)) continue; seen.add(s.name); names.push(`${s.name} ${cat[s.id].pubs}`); picks.push(s); if (names.length === 3) break; }
  const head = `Citywide; Kerb counts it more where more pubs are within ${ctx.params.catchment.radius_m} m.`;
  const lines = [`${head}${names.length ? ` Most: ${names.join(' · ')}.` : ''}`];
  const go = picks.length ? { lead: `${head} Most, open then:`, items: picks.map((s) => goItem(s, now, ctx, { where: `${cat[s.id].pubs} pubs` })), rest: [] }
    : { lead: null, items: [], rest: lines };
  return { lines, go };
}

function eventWhen(ctx, x) {
  const ev = ((ctx.events && ctx.events.items) || []).find((e) => e.venue === x.venue && Date.parse(e.end) === x.t.getTime());
  if (!ev) return ["Time from Kerb's events list."];
  const start = new Date(ev.start), end = new Date(ev.end);
  let line;
  if (ev.end_basis === 'published') line = `Starts ${hhmm(start)}. ${hhmm(end)} is the published finish.`;
  else if (ev.end_basis === 'curfew') line = `Starts ${hhmm(start)}. ${hhmm(end)} is the venue's curfew; it may finish sooner.`;
  else if (ev.end_basis === 'typical') {
    const m = Math.round((end - start) / MIN), h = Math.floor(m / 60), mm = m % 60;
    const length = h ? (mm ? `${h}\u00a0h\u00a0${mm}` : `${h}\u00a0h`) : 'under an hour'; // one unit, never split across lines
    line = `Starts ${hhmm(start)} (published). The finish is Kerb's estimate: a typical length, ${length}, after the start. It can run over, so the ~ stays.`;
  } else line = `No finish time is published; ~${hhmm(end)} is Kerb's guess.`; // ruling: an RDS "start" is assumed too
  let src = null;
  try { const host = new URL(ev.source).hostname; src = host === 'www.transportforireland.ie' ? 'TFI events page' : host.replace(/^www\./, ''); } catch { /* no source */ }
  const updated = (ctx.events && ctx.events.updated) || (ctx.meta && ctx.meta.events && ctx.meta.events.updated);
  const list = updated ? `Kerb's list updated ${dMon(updated)}.` : '';
  return [line, src ? `Source: ${src}; ${list || "Kerb's events list."}` : list || "Time from Kerb's events list."].filter(Boolean);
}

function timetableSource(ctx, kind) {
  const S = (ctx.meta && ctx.meta.sources) || {};
  if (kind === 'ferry') {
    const y = /(\d{4})/.exec(S.ferry_slots || '');
    return `Source: Dublin Port ${y ? `${y[1]} ` : ''}slot list. Scheduled, not live.`;
  }
  const d = /(\d{4}-\d\d-\d\d)/.exec(S.gtfs || '');
  return `Source: NTA timetable${d ? ` of ${dMon(d[1])}` : ''}. Scheduled, not live.`;
}

function closingWhen(x) {
  const wd = dublinParts(new Date(x.t.getTime() - 6 * HOUR)).weekday; // the evening the closing belongs to
  const days = wd <= 3 ? 'Mon–Thu' : wd <= 5 ? 'Fri and Sat' : 'Sun';
  return [`${days}, last orders are ${hhmm(new Date(x.t.getTime() - 30 * MIN))} by law, plus half an hour's drinking-up.`,
    "Source: the licensing law. Public holidays not included; single pubs' hours aren't loaded."];
}

function lead(row, x) {
  switch (row.kind) {
    case 'event': return `${VENUE_NAMES[x.venue] ? `${VENUE_NAMES[x.venue]}, ` : ''}${dayLabel(dublinParts(x.t).date)}.`;
    case 'last_rail': case 'last_luas':
      return row.n > 1 ? 'After each of these, no more trains or trams leave from there tonight.'
        : `After this, no more ${row.kind === 'last_luas' ? 'trams' : 'trains'} leave from there tonight.`;
    case 'late_arrival': {
      const station = row.group.startsWith('arr:') ? row.group.slice(4) : ((/arrives (.+?) \d\d:\d\d/.exec(x.label) || [])[1]);
      return station ? `People getting off late trains at ${station}.` : 'People getting off a late train.';
    }
    case 'ferry': return 'Foot passengers off the ferry; few each.';
    default: return null;
  }
}

/** "{tariff} · {cabs} · {rain}" over [from, to] (spec §7). A zero-length span still meets its hourly step (plan review I1). */
function hourLine(from, to, forecast, now, params) {
  const P = params.plan;
  const tar = spans(from, to, (t) => tariffBand(t, P)), cab = spans(from, to, (t) => cabsOut(t, P));
  const tariff = `${cap(tar[0].value)} tariff${tar.slice(1).map((s) => `, then ${cap(s.value)} from ${hhmm(s.from)}`).join('')}`;
  const cabs = cab.length === 1 ? `${cab[0].value} cabs out (survey, not live)`
    : `${cab[0].value}${cab.slice(1).map((s) => `, then ${s.value}`).join('')} cabs out from ${cab.slice(1).map((s) => hhmm(s.from)).join(', ')} (survey, not live)`;
  let rain = 'no forecast';
  if (forecastFresh(forecast, now, P)) {
    const hourly = forecast.steps.filter((s) => s.to - s.from === HOUR && s.from <= to && s.to > from);
    if (hourly.length) rain = hourly.some((s) => s.mm >= params.demand.rain_mm) ? 'rain forecast' : 'no rain forecast';
  }
  return `${tariff} · ${cabs} · ${rain}`;
}

/** Up to three other rows worth a small dot or more whose counting windows overlap this one's, in time order (J8). */
function around(row, all, params) {
  const [a0, a1] = rowWindow(row, params);
  const others = all.filter((r) => r !== row && r.value >= params.plan.dots[0]).filter((r) => {
    const [b0, b1] = rowWindow(r, params);
    return b0 < a1 && a0 < b1;
  }).slice(0, 3);
  return others.length ? others.map((r) => `${clockOf(r)} ${r.title}`).join(' · ') : null;
}

/** The dot in words and numbers, then the scale, read from params so the copy can't drift from the model (J9). */
function strength(row, params) {
  const kw = params.demand.kind_weight, P = params.plan, V = params.demand.venue_weight;
  const scale = [kw.event * P.stadium_weight, kw.event * (V['3arena'] ?? 0), kw.closing, kw.last_rail, kw.last_luas, kw.ferry, kw.late_arrival];
  let what;
  if (row.group === 'last' && row.n > 1) {
    const kinds = new Set(row.items.map((x) => x.kind));
    what = [kinds.has('last_rail') ? `a last train at ${num(kw.last_rail)}` : null, kinds.has('last_luas') ? `a last tram at ${num(kw.last_luas)}` : null]
      .filter(Boolean).join(' and ');
  } else {
    const top = [...row.items].sort((a, b) => (kw[b.kind] ?? 0) * b.weight - (kw[a.kind] ?? 0) * a.weight)[0];
    const subject = top.kind === 'event' ? (top.weight >= P.stadium_weight ? 'a stadium' : 'this venue')
      : { closing: 'pub closing', late_closing: 'late bars closing', late_arrival: 'a train in', ferry: 'a ferry', last_rail: 'a last train',
        last_luas: 'a last tram' }[top.kind] || 'this';
    what = `${subject} at ${num(row.value)}${row.value >= Math.max(...scale) ? ', its highest' : ''}`;
  }
  const line = `${DOT[row.dot]}. Kerb counts ${what}.${row.n > 1 ? " The dot is the row's strongest item, not how many there are." : ''}`;
  return [line, `Stadium ${num(scale[0])} · 3Arena ${num(scale[1])} · pubs close ${num(scale[2])} · last train ${num(scale[3])} · last tram ${num(scale[4])} · `
    + `ferry ${num(scale[5])} · train in ${num(scale[6])}. Every one is a guess until real waits are logged.`];
}

function quietDetail(key, gap, night, now, forecast, params) {
  const before = night.all.filter((r) => r.to < gap.to).sort((a, b) => b.to - a.to || b.from - a.from)[0];
  const after = night.all.filter((r) => r.from > gap.from).sort((a, b) => a.from - b.from)[0];
  const D = params.demand;
  return {
    key, kind: 'quiet', passed: false, title: `${hhmm(gap.from)}–${hhmm(gap.to)} Quiet · nothing scheduled`,
    lead: 'No let-out, train, tram, ferry or closing time falls here.',
    when: [`Kerb counts each timed item from ${spanWords(D.kernel_lead_min)} before it to ${spanWords(D.kernel_end_min)} after (a guess), so the gap runs from ${hhmm(gap.from)} to ${hhmm(gap.to)}.`],
    ranks: null, go: null, whenGo: [null], hour: hourLine(gap.from, gap.to, forecast, now, params), around: null, strength: null, record: null,
    bounds: [before ? `Before: ${clockOf(before)} ${before.title}.` : null, after ? `After: ${clockOf(after)} ${after.title}.` : null].filter(Boolean).join(' ') || null,
    footer: FOOTER,
  };
}

/** A quiet stretch in its last hour leaves the list (under quiet_min) but is still quiet: the detail keeps it, from now to
 * its end, while no row's window reaches into it (final review I2), and says "passed" only when it is over. */
function lastHour(key, night, now, params) {
  const to = Number(key.slice(6)), t = now.getTime();
  if (!night.loaded || !(t < to)) return null;
  const busy = night.all.some((r) => { const [a, b] = rowWindow(r, params); return a < to && b > t; });
  return busy ? null : { from: now, to: new Date(to) };
}

/**
 * Every reason the row (or quiet stretch) with `key` is on the night (spec §4-§11), or {key, passed: true} once it has
 * gone. `night` is nightRows(ctx, now) when the caller already has it.
 */
export function rowDetail({ ctx, now, forecast = null, waits = [], key, night = null }) {
  const params = ctx.params, n = night || nightRows(ctx, now);
  if (key.startsWith('quiet|')) {
    const gap = n.gaps.find((g) => quietKey(g) === key) || lastHour(key, n, now, params);
    return gap ? quietDetail(key, gap, n, now, forecast, params) : { key, passed: true, footer: FOOTER };
  }
  const row = n.all.find((r) => rowKey(r) === key);
  if (!row) return { key, passed: true, footer: FOOTER };
  const x = row.items[0];
  const multi = new Set(row.items.map((i) => (i.place ? i.place.join(',') : ''))).size > 1;
  let when, ranks = null, go = null, whenGo = null;
  const take = (r) => { ranks = r.lines; go = r.go; };
  if (row.kind === 'event') { when = eventWhen(ctx, x); take(placeRanks(ctx, x, now)); }
  else if (row.kind === 'closing') { when = closingWhen(x); take(pubRanks(ctx, x.t, now)); }
  else if (row.kind === 'late_closing') {
    when = [`Late bars with an exemption close at ${hhmm(x.t)} (assumed); Kerb doesn't know which are open late tonight.`, "Source: Kerb's assumption, not a list."];
    take(pubRanks(ctx, x.t, now));
  } else {
    const per = row.items.map((i) => (multi ? itemRank(ctx, i, now) : { text: '', go: null })); // ADR 0018: each line's rank as a Go
    when = [...row.items.map((i, k) => `${hhmm(i.t)} ${stripClock(i.label, i.t)}${per[k].text}`),
      ...(TIMETABLE.has(row.kind) ? [timetableSource(ctx, row.kind)] : [])];
    whenGo = [...per.map((p) => p.go), ...(TIMETABLE.has(row.kind) ? [null] : [])];
    if (!multi && x.place) take(placeRanks(ctx, x, now));
  }
  if (!whenGo) whenGo = when.map(() => null);
  const rec = row.recordKeys.length ? recordLine(rowRecord(waits, row, now)) || "Kerb shows your own waits at this once you've logged 3." : null;
  return {
    key, kind: row.kind, passed: false, title: `${clockOf(row)} ${row.title}`, lead: lead(row, x), when, ranks, go, whenGo,
    hour: hourLine(row.from, row.to, forecast, now, params), around: around(row, n.all, params), strength: strength(row, params),
    record: rec ? { text: rec, note: RECORD_NOTE } : null, bounds: null, footer: FOOTER,
  };
}
