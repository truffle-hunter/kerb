// Wait statistics for the driver's own dashboard. Waits that ended without a fare are right-censored
// (the wait lasted at least that long), so medians use Kaplan-Meier rather than a plain median.

/** Kaplan-Meier median of waits [{wait_min, censored}] -> {median, n, atLeast}. atLeast: survival never fell to 0.5,
 *  so the median is longer than the longest wait seen (reported as that wait). */
export function kmMedian(waits) {
  const w = waits.filter((x) => Number.isFinite(x.wait_min)).sort((a, b) => a.wait_min - b.wait_min || a.censored - b.censored);
  if (!w.length) return { median: null, n: 0, atLeast: false };
  let s = 1, atRisk = w.length, i = 0;
  while (i < w.length) {
    const t = w[i].wait_min;
    let deaths = 0, leaving = 0;
    while (i < w.length && w[i].wait_min === t) { if (!w[i].censored) deaths++; leaving++; i++; }
    if (deaths) {
      s *= 1 - deaths / atRisk;
      if (s <= 0.5) return { median: t, n: w.length, atLeast: false };
    }
    atRisk -= leaving;
  }
  return { median: w[w.length - 1].wait_min, n: w.length, atLeast: true };
}

import { dublinParts } from './time.js';

export function median(xs) {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const BANDS = ['00–04', '04–08', '08–12', '12–16', '16–20', '20–24'];
const serviceDate = (iso, startHour) => dublinParts(new Date(Date.parse(iso) - startHour * 3600000)).date;
const answeredOf = (ws) => ws.filter((w) => w.outcome === 'fare' || w.outcome === 'left_empty');

/** The driver's own history (spec §8b): plain medians of time at the rank (most automatic waits are never answered,
 *  so a Kaplan-Meier "time to a fare" is reported only over answered waits), the last shift, each stand, six bands,
 *  and a shorter / about usual / longer label per wait. Describes the past only; never a prediction (ADR 0002). */
export function computeStats(waits, now, ctx) {
  const P = ctx.params;
  const S = P.stats || { shorter: 0.75, longer: 1.25, stand_min_n: 5, overall_min_n: 3 };
  const startHour = P.demand.service_day_start_hour;
  const ws = waits.filter((w) => Number.isFinite(w.wait_min));
  const ans = answeredOf(ws);
  const overall = median(ws.map((w) => w.wait_min));

  const groups = new Map();
  for (const w of ws) { if (!groups.has(w.stand)) groups.set(w.stand, []); groups.get(w.stand).push(w); }
  const byStand = [...groups.entries()].map(([stand, g]) => {
    const a = answeredOf(g);
    const km = kmMedian(a.map((w) => ({ wait_min: w.wait_min, censored: w.outcome !== 'fare' || w.end_uncertain || w.start_uncertain })));
    return { stand, name: ctx.byId[stand] ? ctx.byId[stand].name : stand, n: g.length, median: median(g.map((w) => w.wait_min)),
      fares: a.filter((w) => w.outcome === 'fare').length, answered: a.length, fareMedian: km.n ? km : null,
      uncertain: g.filter((w) => w.end_uncertain || w.start_uncertain).length };
  }).sort((x, y) => y.n - x.n || x.name.localeCompare(y.name));

  const byBand = BANDS.map((band, i) => {
    const g = ws.filter((w) => Math.floor(dublinParts(new Date(w.joined_at)).hour / 4) === i);
    return { band, n: g.length, median: median(g.map((w) => w.wait_min)) };
  });

  let lastShift = null;
  if (ws.length) {
    const date = ws.map((w) => serviceDate(w.joined_at, startHour)).sort().pop();
    const g = ws.filter((w) => serviceDate(w.joined_at, startHour) === date);
    const sorted = [...g].sort((a, b) => a.wait_min - b.wait_min);
    const pick = (w) => ({ min: w.wait_min, stand: w.stand, name: ctx.byId[w.stand] ? ctx.byId[w.stand].name : w.stand, uncertain: !!(w.end_uncertain || w.start_uncertain) });
    lastShift = { date, waits: g.length, minutes: g.reduce((t, w) => t + w.wait_min, 0), fares: g.filter((w) => w.outcome === 'fare').length,
      answered: answeredOf(g).length, longest: pick(sorted[sorted.length - 1]), shortest: pick(sorted[0]) };
  }

  const standMedian = new Map(byStand.map((b) => [b.stand, b]));
  const labels = new Map();
  for (const w of ws) {
    const b = standMedian.get(w.stand);
    const usual = b && b.n >= S.stand_min_n ? b.median : ws.length >= S.overall_min_n ? overall : null;
    labels.set(w.joined_at, usual == null || usual <= 0 ? 'not enough yet'
      : w.wait_min < S.shorter * usual ? 'shorter' : w.wait_min > S.longer * usual ? 'longer' : 'about usual');
  }

  return { total: ws.length, unconfirmed: ws.filter((w) => w.confirmed === false).length, answered: ans.length,
    fares: ans.filter((w) => w.outcome === 'fare').length, overallMedian: overall, lastShift, byStand, byBand,
    label: (joinedAt) => labels.get(joinedAt) || 'not enough yet', now };
}
