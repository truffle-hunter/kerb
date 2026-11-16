// "Tonight" (ADR 0015, spec docs/superpowers/specs/2026-11-16-kerb-tonight-design.md): the night ahead on one easy-to-close
// sheet, built like "Why this rank?" (ADR 0013). It maps tonightModel() onto nodes and does no arithmetic of its own.
import { h } from './dom.js';
import { tonightModel, dayLabel } from '../engine/tonight.js';
import { hhmm } from '../engine/time.js';

const clock = (r) => (r.n === 1 ? `${r.approx ? '~' : ''}${hhmm(r.from)}` : `${hhmm(r.from)}–${hhmm(r.to)}`);

/** One wave: its clock, a dot sized by its strongest item (the words carry the content), and his record when he has one. */
const waveRow = (e) => h('li', { class: 'tnrow', 'data-test': 'tonight-row', 'data-dot': e.row.dot },
  h('span', { class: 'tntime' }, clock(e.row)),
  h('i', { class: `tndot ${e.row.dot}`, 'aria-hidden': 'true' }),
  h('span', { class: 'tntitle' }, e.row.title),
  e.record ? h('span', { class: 'note tnrec', 'data-test': 'tonight-record' }, e.record) : null);

const quietRow = (e) => h('li', { class: 'tnrow quiet', 'data-test': 'tonight-quiet' },
  h('span', { class: 'tntime' }, `${hhmm(e.from)}–${hhmm(e.to)}`),
  h('i', { class: 'tndot none', 'aria-hidden': 'true' }),
  h('span', { class: 'tntitle' }, 'Quiet · nothing scheduled'));

const weekRow = (w, i) => h('li', { class: `tnweek${w.standsOut ? ' out' : ''}`, 'data-test': 'tonight-week-row', 'data-stands-out': String(w.standsOut) },
  h('span', { class: 'tnday' }, i === 0 ? `${w.label}, tonight` : w.label),
  h('span', { class: 'tnwhat' },
    !w.loaded ? 'Not loaded yet' : w.top.length ? w.top.map((r) => r.short).join(' · ') : 'Nothing scheduled',
    w.rain ? ' · Rain' : '',
    w.standsOut ? [' · ', h('b', {}, 'Stands out')] : null));

const fact = (label, value, test) => h('div', { class: 'tnfact' }, h('dt', {}, label), h('dd', { 'data-test': test }, value));

// The model doesn't depend on where the car is, so a GPS fix reuses it: it changes with the minute, the forecast, the log
// and the bundle (review I3: a long log costs tens of ms to summarise).
let memo = { key: null, model: null };
function model(S) {
  const key = [Math.floor(S.now / 60000), S.forecast ? +S.forecast.fetched : 0, S.events.length, S.shifts.length,
    S.data.meta.bundle_version, S.ctx.live ? S.ctx.live.items?.length : 0].join('|');
  if (memo.key !== key) memo = { key, model: tonightModel({ ctx: S.ctx, now: S.now, forecast: S.forecast, waits: S.waits, shifts: S.shifts }) };
  return memo.model;
}

/** The sheet. It survives re-renders on every fix and tick and keeps its scroll (main.js). */
export function tonightSheet(S, A) {
  const m = model(S);
  const body = [
    m.timetable.current ? null : h('p', { class: 'warn', 'data-test': 'tonight-stale' },
      `Timetables out of date (they ran to ${m.timetable.to ? dayLabel(m.timetable.to) : 'an earlier date'}): trains, trams and ferries not shown`),
    m.entries.length ? h('ol', { class: 'tnrows' }, m.entries.map((e) => (e.type === 'quiet' ? quietRow(e) : waveRow(e))))
      : h('p', {}, 'Nothing scheduled for the rest of the night.'),
    h('p', { class: 'tnrain', 'data-test': 'tonight-rain' }, m.rain),
    h('dl', { class: 'tnfacts' },
      fact('Cabs out (NTA 2026 survey, not live)', m.cabs, 'tonight-cabs'),
      fact('Tariff (public holidays and special nights not included)', m.tariff, 'tonight-tariff')),
    h('h3', {}, 'This week'),
    h('ol', { class: 'tnweeks' }, m.week.map(weekRow)),
    m.hours.length ? [h('h3', {}, 'Your hours'),
      m.hours.map((x) => h('p', { 'data-test': 'tonight-hours' }, h('b', {}, x.label), `: ${x.text}`)),
      h('p', { class: 'note' }, 'Shown for you; not part of the demand guess.')] : null,
    h('p', { class: 'note', 'data-test': 'tonight-honest' }, 'Timetables and guesses · your record is yours'),
  ];
  return h('div', { class: 'overlay why tonight', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'tonight-title', 'data-test': 'tonight-sheet',
    onclick: (ev) => { if (ev.target === ev.currentTarget) A.closeTonight(); } }, // a tap on the backdrop, never inside the card
  h('div', { class: 'card' },
    h('h2', { id: 'tonight-title' }, m.title),
    h('div', { class: 'whybody tnbody', 'data-test': 'tonight-body' }, body.flat(Infinity)), // h() flattens one level only
    h('button', { class: 'btn big', type: 'button', 'data-test': 'tonight-close', onclick: () => A.closeTonight() }, 'Close')));
}
