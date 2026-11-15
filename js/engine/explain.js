// "Why this rank?" (ADR 0013, spec docs/superpowers/specs/2026-11-15-kerb-why-design.md §3-4): every reason Kerb picked a
// stand, as rows and lines. Pure: all wording and arithmetic live here; the sheet only maps fields to nodes.
import { bearingDeg, cardinal } from './geo.js';

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const kmText = (km) => `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
const gapText = (m) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : kmText(m / 1000));
const near = (m) => (m < 20 ? 'under 20 m' : gapText(m)); // never "0 m", and no compass point for a few metres
const count = (n, one, many) => `${n.toLocaleString('en-IE')} ${n === 1 ? one : many}`;
const CITYWIDE = new Set(['closing', 'late_closing']);

// "less demand (…)": what the other stand has less of. Time and rain scale every stand alike, so they never appear.
const LESS = { pub: 'fewer pubs', club: 'fewer nightclubs', room: 'fewer hotel rooms', station: 'fewer rail and Luas stops',
  event: 'further from the event', closing: 'fewer pubs for closing time', late_closing: 'fewer pubs for closing time',
  last_rail: 'further from the station', live_rail: 'further from the station', last_luas: 'further from the Luas',
  live_luas: 'further from the Luas', ferry: 'further from the ferry', late_arrival: 'further from the airport' };

/** Whole percents that add up to exactly 100 (largest remainder; ties go to the earlier row). */
function percents(values) {
  const total = sum(values);
  const raw = values.map((v) => (v / total) * 100);
  const out = raw.map(Math.floor);
  const order = raw.map((r, i) => [r - out[i], i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  const left = 100 - sum(out);
  for (let k = 0; k < left; k++) out[order[k][1]]++;
  return out;
}

/** What the demand guess is made of: one row per part, largest first, small parts folded into one row at the end. */
function demandRows(d, P, X, radius) {
  const D = d.detail, C = D.counts;
  const rows = [{ key: 'time', label: D.when, note: `a ${D.base < X.quiet ? 'quiet' : D.base < X.busy ? 'steady' : 'busy'} time of the week`, value: D.time }];
  const dayNote = D.night ? null : `counted at ${Math.round(P.pub_day_factor * 100)}% before ${P.night_hours[0]}:00`;
  for (const [key, n, one, many, note] of [['pub', C.pubs, 'pub', 'pubs', dayNote], ['club', C.clubs, 'nightclub', 'nightclubs', dayNote],
    ['room', C.rooms, 'hotel room', 'hotel rooms', null], ['station', C.stations, 'rail and Luas stop', 'rail and Luas stops', null]]) {
    if (n > 0) rows.push({ key, label: `${count(n, one, many)} within ${radius} m`, note, value: D.catch[key] });
  }
  D.triggers.forEach((t, i) => rows.push({ key: `trigger${i}`, label: t.label, value: t.value,
    note: CITYWIDE.has(t.kind) ? 'city-wide, scaled by the pubs here' : `${near(t.distM)} away` }));
  if (D.rain) rows.push({ key: 'rain', label: D.rain.label, note: `adds ${Math.round(P.kind_weight.rain * 100)}% to everything else`, value: D.rain.value });

  const total = sum(rows.map((r) => r.value));
  const extra = new Set(rows.filter((r) => r.key.startsWith('trigger')).sort((a, b) => b.value - a.value).slice(X.max_triggers));
  let fold = rows.filter((r) => r.key !== 'time' && (r.value / total < X.min_share || extra.has(r)));
  if (fold.length === 1) fold = []; // a single part shows as itself: folding it would hide a reason and save no row
  const kept = rows.filter((r) => !fold.includes(r)).sort((a, b) => b.value - a.value);
  if (fold.length) { // the folded row names what is in it, and says "more", not "smaller", when any of it is big
    const small = fold.every((r) => r.value / total < X.min_share);
    kept.push({ key: 'fold', label: `${fold.length} ${small ? 'smaller' : 'more'} things nearby`,
      note: [...fold].sort((a, b) => b.value - a.value).map((r) => r.label).join('; '), value: sum(fold.map((r) => r.value)) });
  }
  const pct = percents(kept.map((r) => r.value));
  return kept.map((r, i) => ({ key: r.key, label: r.label, note: r.note, share: pct[i] }));
}

/** Each part of a demand guess by name, for comparing two stands. */
function parts(d) {
  const out = { ...d.detail.catch };
  for (const t of d.detail.triggers) out[`t:${t.label}`] = (out[`t:${t.label}`] || 0) + t.value;
  return out;
}

function versusLine(me, o, X) {
  const ratio = o.demand.score / me.demand.score;
  const word = ratio > 1 + X.same_demand ? 'more' : ratio < 1 - X.same_demand ? 'less' : 'about the same';
  let why = '';
  if (word === 'less') {
    const mine = parts(me.demand), theirs = parts(o.demand);
    const kinds = Object.fromEntries(me.demand.detail.triggers.map((t) => [`t:${t.label}`, t.kind]));
    const [key, gap] = Object.keys(mine).map((k) => [k, mine[k] - (theirs[k] || 0)]).sort((a, b) => b[1] - a[1])[0] || [];
    if (gap > 0) why = ` (${LESS[kinds[key] || key] || 'less nearby'})`;
  }
  const dm = (o.km - me.km) * 1000;
  const dist = Math.abs(dm) < X.same_dist_m ? 'about as far' : `${gapText(Math.abs(dm))} ${dm > 0 ? 'further' : 'nearer'}`;
  const close = Math.min(o.rankScore, me.rankScore) >= X.close_call * Math.max(o.rankScore, me.rankScore);
  const name = o.stand.name === me.stand.name ? `The other ${o.stand.name} stand` : o.stand.name; // two picks can share a street name
  return { id: o.stand.id, name: o.stand.name, close, text: `${name}: ${word} demand${why}, ${dist}.${close ? ' Close call.' : ''}` };
}

/**
 * Every reason for stand `id` among the recommendations `recs` (recommend()'s output), or null if it isn't one of them.
 * opts: {permit} as in Settings; {from} [lon, lat] for the compass direction.
 */
export function explain(recs, id, ctx, { permit = false, from = null } = {}) {
  const r = recs.find((x) => x.stand.id === id);
  if (!r) return null;
  const X = ctx.params.explain, P = ctx.params.demand;
  const top = recs[0] === r;
  const dir = from && r.stand.head ? ` ${cardinal(bearingDeg(from, r.stand.head))}` : '';
  const against = Math.round(100 * (1 - 1 / (1 + r.km / ctx.params.rank.k_km)));
  const m = r.km * 1000, far = m < 100 ? near(m) : kmText(r.km); // "30 m", never "0.0 km"
  const lines = ['Kerb only suggests stands you can legally use right now.'];
  if (r.stand.access === 'daa_permit') lines.push('Airport stand: shown because your permit is on in Settings.');
  else if (!permit) lines.push('Airport permit stands are left out (permit off in Settings).');
  return {
    stand: r.stand, top, level: r.demand.level,
    verdict: top ? 'Best demand for the distance, of the stands you can legally use now.' : `Kerb now suggests ${recs[0].stand.name}.`,
    rows: demandRows(r.demand, P, X, ctx.params.catchment.radius_m),
    distance: { text: `${m < 20 ? far : r.approx ? `about ${far}${dir}` : `${far}${dir} by road`} · ${against < 5 ? 'distance barely counts' : `distance counts ${against}% against it`}` },
    legal: { status: r.status, lines },
    versus: recs.filter((o) => o !== r).map((o) => versusLine(r, o, X)),
  };
}
