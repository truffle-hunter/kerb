// Stats (spec §8b): the driver's own history on this phone. Past only; never a prediction (ADR 0002, ADR 0005).
import { h, iconButton } from './dom.js';
import { computeStats } from '../engine/stats.js';
import { dublinTime, hhmm } from '../engine/time.js';
import { onShiftMinutes, fatigueStage } from '../engine/shift.js';
import { wavesSplit } from '../engine/tonight.js';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const fmtMin = (m) => (m == null ? '–' : m >= 60 ? `${Math.floor(m / 60)} h ${Math.round(m % 60)} min` : `${Math.round(m)} min`);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
function dayName(date) {
  const wd = (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7;
  return `${DAYS[wd]} ${+date.slice(8)} ${MONTHS[+date.slice(5, 7) - 1]}`;
}

export function stats(S, A, parts) {
  const st = computeStats(S.waits, S.now, { params: S.data.params, byId: S.byId, shifts: S.shifts });
  const head = h('header', { class: 'top' }, iconButton('back', 'Back', A.back, 'nav-back'), h('span', { class: 'clock' }, parts.time));
  const note = h('p', { class: 'note' }, "Kerb only sees ranks while it's on screen, so waits while another app was open are missing.");
  if (!st.total && !st.lastShift && !st.thisShift) {
    return [head, h('main', { class: 'sheet', 'data-test': 'stats' }, h('h2', {}, 'Your stats'), note,
      h('p', {}, 'No waits yet. Leave Kerb on screen at a rank: it logs the wait by itself after 2 minutes.'))];
  }
  const ls = st.lastShift, ts = st.thisShift;
  const maxBand = Math.max(...st.byBand.map((b) => b.median || 0), 1);
  const P = S.data.params.shift;
  const tired = fatigueStage(onShiftMinutes(S.shifts, S.now.getTime(), P.fatigue_window_h), P) >= 3;
  // a shift's line (ADR 0010): time on shift where it was a real shift, then the waits as before
  const line = (x) => `${x.on_min != null ? `${fmtMin(x.on_min)} on shift, ` : ''}${plural(x.waits, 'wait')}, ${fmtMin(x.minutes)} at ranks, `
    + `${plural(x.fares, 'fare')} of ${x.answered} answered.`
    + (x.longest ? ` Longest: ${x.longest.name}, ${x.longest.uncertain ? 'at least ' : ''}${fmtMin(x.longest.min)}. `
      + `Shortest: ${x.shortest.name}, ${fmtMin(x.shortest.min)}.` : '');
  return [head, h('main', { class: 'sheet', 'data-test': 'stats' },
    h('h2', {}, 'Your stats'),
    note,
    tired ? h('p', { class: 'warn', 'data-test': 'stats-fatigue' }, `${P.fatigue_h[2]} h on shift. The NTA rule is no more than ${P.fatigue_h[2]} h `
      + "carrying passengers on 3 days running. Kerb can't see fares, so this counts all your time on shift.") : null,
    ts ? h('div', { 'data-test': 'stats-this-shift' }, h('h3', {}, `This shift: since ${hhmm(new Date(ts.start))}`), h('p', {}, line(ts))) : null,
    ls ? h('h3', {}, ls.start ? `Last shift: ${dayName(ls.date)}, ${hhmm(new Date(ls.start))}–${hhmm(new Date(ls.end))}` : `Last shift: ${dayName(ls.date)}`) : null,
    ls ? h('p', { 'data-test': 'stats-last-shift' }, line(ls)) : null,
    st.total ? [
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
    ...(wavesLine(S) || []), // h() flattens one level only
    h('h3', {}, 'All waits'),
    h('p', {}, `${plural(st.total, 'wait')} logged, usually ${fmtMin(st.overallMedian)} at the rank; ${plural(st.fares, 'fare')} of ${st.answered} answered.`
      + (st.unconfirmed ? ` ${st.unconfirmed} logged automatically and not yet confirmed: open the Log to confirm or delete them.` : '')),
    ] : null,
    h('p', { class: 'note' }, 'These are your past waits. They are not a forecast.'))];
}

/** ADR 0015: his waits that began during a big let-out or closing time against the rest, past tense with counts. Only
 * waits logged since Tonight carry the waves, so older ones are left out; nothing under 3 waits in all. */
function wavesLine(S) {
  const ws = wavesSplit(S.waits, S.data.params);
  if (ws.during.n + ws.other.n < 3) return null;
  const part = (x) => (x.n ? `${plural(x.n, 'wait')}, usually ${fmtMin(x.median)}, ${plural(x.fares, 'fare')}` : 'none yet');
  return [h('h3', {}, 'Let-outs and closing time'),
    h('p', { 'data-test': 'stats-waves' }, `During big let-outs and closing time: ${part(ws.during)}. At other times: ${part(ws.other)}.`)];
}
