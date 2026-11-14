// The driver's own history at a rank (ADR 0008): the only minutes Kerb shows. Past tense, with a count, from the
// driver's confirmed waits; never a forecast and never blended into the demand level (ADR 0002 as amended).
import { dublinParts } from './time.js';

const WEEKS = 12;     // older waits say little about the rank today
const LAST = 8;       // the most recent waits used
const MIN_N = 3;      // fewer than this: no summary line
const band = (d) => Math.floor(dublinParts(d).hour / 4); // the six 4-hour bands of Stats

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const fmt = (m) => (m >= 60 ? `${Math.floor(m / 60)} h ${Math.round(m % 60)} min` : `${Math.round(m)} min`);
// time at the rank only bounds the wait for a fare from below when it didn't end in one, or its start/end is unsure
const atLeastOne = (w) => w.outcome !== 'fare' || !!(w.end_uncertain || w.start_uncertain);

/**
 * Confirmed waits at `stand` from the last 12 weeks, most recent first. The summary uses the last 8 from the same
 * 4-hour band as `now` when there are 3 or more of those, otherwise the last 8 at any hour.
 */
export function ownHistory(waits, stand, now) {
  const since = now - WEEKS * 7 * 86400000;
  const all = waits.filter((w) => w.stand === stand && w.confirmed !== false && !w.off_shift && Number.isFinite(w.wait_min)
    && Date.parse(w.joined_at) >= since && Date.parse(w.joined_at) <= now)
    .sort((a, b) => Date.parse(b.joined_at) - Date.parse(a.joined_at));
  const sameBand = all.filter((w) => band(new Date(w.joined_at)) === band(now));
  const inBand = sameBand.length >= MIN_N;
  const used = (inBand ? sameBand : all).slice(0, LAST);
  return {
    n: used.length, all: all.length, inBand,
    median: used.length ? median(used.map((w) => w.wait_min)) : null,
    atLeast: used.length > 0 && used.filter(atLeastOne).length * 2 >= used.length,
    fares: used.filter((w) => w.outcome === 'fare').length,
    recent: all.slice(0, MIN_N - 1).map((w) => w.wait_min),
  };
}

/** "Your last 6 waits here: usually 12 min, 5 ended in a fare", or null under 3 waits. "At least" when half or more
 * didn't end in a fare (or had an unsure start or end): then the minutes only bound the wait for a fare. */
export function historyLine(h) {
  if (!h || h.n < MIN_N) return null;
  return `Your last ${h.n} waits here${h.inBand ? ' around this time' : ''}: usually ${h.atLeast ? 'at least ' : ''}${fmt(h.median)}`
    + `, ${h.fares} ended in a fare`;
}

/** For the detail sheet under 3 waits: "You've logged 2 waits here: 14 and 9 min." */
export function fewLine(h) {
  if (!h || h.all === 0 || h.n >= MIN_N) return null;
  const mins = h.recent.map((m) => Math.round(m));
  return h.all === 1 ? `You've logged 1 wait here: ${mins[0]} min.` : `You've logged ${h.all} waits here: ${mins.join(' and ')} min.`;
}
