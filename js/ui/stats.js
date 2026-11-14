// Stats (spec §8b): the driver's own history on this phone. Past only; never a prediction (ADR 0002, ADR 0005).
import { h, iconButton } from './dom.js';
import { computeStats } from '../engine/stats.js';
import { dublinTime } from '../engine/time.js';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const fmtMin = (m) => (m == null ? '–' : m >= 60 ? `${Math.floor(m / 60)} h ${Math.round(m % 60)} min` : `${Math.round(m)} min`);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
function dayName(date) {
  const wd = (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7;
  return `${DAYS[wd]} ${+date.slice(8)} ${MONTHS[+date.slice(5, 7) - 1]}`;
}

export function stats(S, A, parts) {
  const st = computeStats(S.waits, S.now, { params: S.data.params, byId: S.byId });
  const head = h('header', { class: 'top' }, iconButton('back', 'Back', A.back, 'nav-back'), h('span', { class: 'clock' }, parts.time));
  const note = h('p', { class: 'note' }, "Kerb only sees ranks while it's on screen, so waits while another app was open are missing.");
  if (!st.total) {
    return [head, h('main', { class: 'sheet', 'data-test': 'stats' }, h('h2', {}, 'Your stats'), note,
      h('p', {}, 'No waits yet. Leave Kerb on screen at a rank: it logs the wait by itself after 2 minutes.'))];
  }
  const ls = st.lastShift;
  const maxBand = Math.max(...st.byBand.map((b) => b.median || 0), 1);
  return [head, h('main', { class: 'sheet', 'data-test': 'stats' },
    h('h2', {}, 'Your stats'),
    note,
    h('h3', {}, `Last shift: ${dayName(ls.date)}`),
    h('p', { 'data-test': 'stats-last-shift' },
      `${plural(ls.waits, 'wait')}, ${fmtMin(ls.minutes)} at ranks, ${plural(ls.fares, 'fare')} of ${ls.answered} answered. `
      + `Longest: ${ls.longest.name}, ${ls.longest.uncertain ? 'at least ' : ''}${fmtMin(ls.longest.min)}. `
      + `Shortest: ${ls.shortest.name}, ${fmtMin(ls.shortest.min)}.`),
    h('h3', {}, 'By rank'),
    h('div', {}, st.byStand.map((b) => h('div', { class: 'statrow', 'data-test': 'stats-stand-row' },
      h('span', { class: 'statname' }, b.name),
      h('span', {}, `${plural(b.n, 'wait')}, usually ${fmtMin(b.median)}${b.answered ? `, fares on ${b.fares} of ${b.answered} answered` : ''}`
        + (b.fareMedian && b.fareMedian.median != null && b.fares ? `; a fare came after about ${b.fareMedian.atLeast ? 'over ' : ''}${fmtMin(b.fareMedian.median)}` : '')
        + (b.uncertain ? ` (${b.uncertain} with an uncertain end)` : ''))))),
    h('h3', {}, 'By time of day (time at the rank)'),
    h('div', { class: 'bands' }, st.byBand.map((b) => h('div', { class: 'band', 'data-test': 'stats-band' },
      h('span', { class: 'bandlabel' }, b.band),
      h('span', { class: 'bandbar', role: 'img', 'aria-label': b.n ? `${b.band}: ${fmtMin(b.median)} over ${plural(b.n, 'wait')}` : `${b.band}: no waits` },
        h('i', { style: `width:${b.n ? Math.max(4, (100 * b.median) / maxBand) : 0}%` })),
      h('span', { class: 'bandval' }, b.n ? `${fmtMin(b.median)} (${b.n})` : '–')))),
    h('h3', {}, 'All waits'),
    h('p', {}, `${plural(st.total, 'wait')} logged, usually ${fmtMin(st.overallMedian)} at the rank; ${plural(st.fares, 'fare')} of ${st.answered} answered.`
      + (st.unconfirmed ? ` ${st.unconfirmed} logged automatically and not yet confirmed: open the Log to confirm or delete them.` : '')),
    h('p', { class: 'note' }, 'These are your past waits. They are not a forecast.'))];
}
