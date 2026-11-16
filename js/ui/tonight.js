// "Tonight" (ADR 0015, spec docs/superpowers/specs/2026-11-16-kerb-tonight-design.md): the night ahead on one easy-to-close
// sheet, built like "Why this rank?" (ADR 0013). It maps tonightModel() onto nodes and does no arithmetic of its own.
// ADR 0016: every wave and quiet row is a button that drills the card into that row's reasons (rowDetail()).
import { h } from './dom.js';
import { tonightModel, dayLabel } from '../engine/tonight.js';
import { rowDetail } from '../engine/tonightwhy.js';
import { longModel } from '../engine/longruns.js';
import { hhmm } from '../engine/time.js';

const clock = (r) => (r.n === 1 ? `${r.approx ? '~' : ''}${hhmm(r.from)}` : `${hhmm(r.from)}–${hhmm(r.to)}`);
const cue = () => h('span', { class: 'whycue tncue', 'data-test': 'tonight-row-cue' }, 'Why?');

/** One wave: a button with its clock, a dot sized by its strongest item (the words carry the content), his record when
 * he has one, and a quiet "Why?" (ADR 0016). */
const waveRow = (e, A) => {
  const title = `${clock(e.row)} ${e.row.title}`;
  return h('li', { class: 'tnrow', 'data-test': 'tonight-row', 'data-dot': e.row.dot },
    h('button', { class: 'tnopen', type: 'button', 'data-test': 'tonight-row-open', 'data-key': e.key,
      'aria-label': `${title}${e.record ? `. ${e.record}` : ''}. Why?`, onclick: () => A.openTonightRow(e.key, title, e.row.kind) },
    h('span', { class: 'tntime' }, clock(e.row)),
    h('i', { class: `tndot ${e.row.dot}`, 'aria-hidden': 'true' }),
    h('span', { class: 'tntitle' }, e.row.title, ' ', cue()),
    e.record ? h('span', { class: 'note tnrec', 'data-test': 'tonight-record' }, e.record) : null));
};

const quietRow = (e, A) => {
  const span = `${hhmm(e.from)}–${hhmm(e.to)}`;
  return h('li', { class: 'tnrow quiet', 'data-test': 'tonight-quiet' },
    h('button', { class: 'tnopen', type: 'button', 'data-test': 'tonight-row-open', 'data-key': e.key,
      'aria-label': `${span} Quiet, nothing scheduled. Why?`, onclick: () => A.openTonightRow(e.key, `${span} Quiet · nothing scheduled`, 'quiet') },
    h('span', { class: 'tntime' }, span),
    h('i', { class: 'tndot none', 'aria-hidden': 'true' }),
    h('span', { class: 'tntitle' }, 'Quiet · nothing scheduled', ' ', cue())));
};

const weekRow = (w, i) => h('li', { class: `tnweek${w.standsOut ? ' out' : ''}`, 'data-test': 'tonight-week-row', 'data-stands-out': String(w.standsOut) },
  h('span', { class: 'tnday' }, i === 0 ? `${w.label}, tonight` : w.label),
  h('span', { class: 'tnwhat' },
    !w.loaded ? 'Not loaded yet' : w.top.length ? w.top.map((r) => r.short).join(' · ') : 'Nothing scheduled',
    w.rain ? ' · Rain' : '',
    w.standsOut ? [' · ', h('b', {}, 'Stands out')] : null));

const fact = (label, value, test) => h('div', { class: 'tnfact' }, h('dt', {}, label), h('dd', { 'data-test': test }, value));

// The model doesn't depend on where the car is, so a GPS fix reuses it: it changes with the minute, the forecast, the log
// and the bundle (review I3: a long log costs tens of ms to summarise). The detail adds its row key.
const baseKey = (S) => [Math.floor(S.now / 60000), S.forecast ? +S.forecast.fetched : 0, S.events.length, S.shifts.length,
  S.data.meta.bundle_version, S.ctx.live ? S.ctx.live.items?.length : 0].join('|');
let memo = { key: null, model: null }, memoRow = { key: null, detail: null };
function model(S) {
  const key = baseKey(S);
  if (memo.key !== key) memo = { key, model: tonightModel({ ctx: S.ctx, now: S.now, forecast: S.forecast, waits: S.waits, shifts: S.shifts }) };
  return memo.model;
}
function detailOf(S) {
  const key = `${baseKey(S)}|${S.tonight.row}`;
  if (memoRow.key !== key) memoRow = { key, detail: rowDetail({ ctx: S.ctx, now: S.now, forecast: S.forecast, waits: S.waits, key: S.tonight.row }) };
  return memoRow.detail;
}

// ADR 0017: Long runs adds the permit, whether there is a real fix (no "Nearest" from O'Connell Bridge; plan review I2)
// and the road distances object, by identity, to the memo key.
let memoLong = { key: null, km: null, model: null };
function longOf(S) {
  const kmById = S.fix ? S.km : null;
  const key = `${baseKey(S)}|${!!S.settings.permit}|${!!kmById}`;
  if (memoLong.key !== key || memoLong.km !== kmById) {
    memoLong = { key, km: kmById, model: longModel({ ctx: S.ctx, now: S.now, permit: !!S.settings.permit, kmById, waits: S.waits }) };
  }
  return memoLong.model;
}

const longEntry = (e) => h('li', { class: 'lrentry', 'data-test': 'long-entry', 'data-key': e.key },
  h('p', { class: 'lrhead' }, h('b', {}, e.name), ` · ${e.when} · Demand likely: `, h('b', {}, e.level)),
  e.places ? h('p', { class: 'lrplaces' }, e.places) : null,
  e.nearest ? h('p', { class: 'note lrnear' }, e.nearest) : null,
  h('p', { class: 'lrtext' }, e.text),
  e.record ? h('p', { class: 'note lrrec', 'data-test': 'long-record' }, e.record) : null);

/** Long runs (ADR 0017): where a long fare is more likely, in the card where the list was. "Back to tonight" is the only
 * button; every way back steps one level. The entries are not buttons and have no Go. */
function longSheet(S, A) {
  const m = longOf(S);
  const body = [
    // the places first; what "long" means and the meter's step come after them, once (ruling: the answer reads first)
    h('p', { class: 'note', 'data-test': 'long-sub' }, m.sub),
    m.stale ? h('p', { class: 'warn', 'data-test': 'long-stale' }, m.stale) : null,
    h('h3', {}, 'Now'),
    m.now.length ? h('ul', { class: 'lrlist', 'data-test': 'long-now' }, m.now.map(longEntry))
      : h('p', { 'data-test': 'long-empty' }, m.empty),
    m.later.length ? [h('h3', {}, 'Later'), h('ul', { class: 'lrlist', 'data-test': 'long-later' }, m.later.map(longEntry))] : null,
    h('h3', {}, 'Why length matters'),
    h('p', { class: 'note', 'data-test': 'long-means' }, m.means),
    h('p', { class: 'note', 'data-test': 'long-tariff' }, m.tariff),
    h('p', { class: 'note', 'data-test': 'long-footer' }, m.footer),
    h('p', { class: 'note', 'data-test': 'long-honest' }, m.honest),
  ];
  return h('div', { class: 'overlay why tonight', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'tonight-title', 'data-test': 'tonight-sheet',
    onclick: (ev) => { if (ev.target === ev.currentTarget) A.closeLong(); } }, // the backdrop steps back one level too
  h('div', { class: 'card', 'data-test': 'long-card' },
    h('h2', { id: 'tonight-title' }, m.title),
    h('div', { class: 'whybody tnbody lrbody', 'data-test': 'long-body' }, body.flat(Infinity)),
    h('button', { class: 'btn big', type: 'button', 'data-test': 'tonight-back', onclick: () => A.closeLong() }, 'Back to tonight')));
}

/** The way into Long runs (ADR 0017): one quiet full-width button under the rows, with rows or without (plan review I8). */
const longButton = (A) => h('button', { class: 'tnopen tnlong', type: 'button', 'data-test': 'tonight-long-open',
  'aria-label': "Long runs: where they're more likely", onclick: () => A.openLong() },
h('span', { class: 'tntitle' }, h('span', { class: 'whycue' }, 'Long runs'), ": where they're more likely"));

// A timetable line "HH:MM label · rank" sits in the list's clock column with the rank under it; a source line is a note.
const TIMED = /^(\d\d:\d\d) (.+?)(?: · (.+))?$/;
const line = (l, note) => {
  const m = TIMED.exec(l);
  if (!m) return h('p', note || l.startsWith('Source:') ? { class: 'note' } : {}, l);
  return h('p', { class: 'tnline' }, h('span', { class: 'tntime' }, m[1]), h('span', {}, m[2], m[3] ? h('span', { class: 'note tnwhere' }, m[3]) : null));
};
const section = (head, test, lines, noteFrom = Infinity) => (lines && lines.length
  ? [h('h3', {}, head), h('div', { class: 'tnsec', 'data-test': test }, lines.map((l, i) => line(l, i >= noteFrom)))] : null);

/** A row's reasons, in the card where the list was (ADR 0016 J1). "Back to tonight" is the only button: every way back
 * steps one level. A row that has gone keeps the last title it had and says so. */
function detailSheet(S, A) {
  const d = detailOf(S);
  if (!d.passed) S.tonight.rowTitle = d.title; // plan review M6: a passed detail shows the last title it had
  const body = d.passed ? [h('p', { 'data-test': 'tonight-detail-passed' }, "This has passed and left tonight's list.")] : [
    d.lead ? h('p', { 'data-test': 'tonight-detail-lead' }, d.lead) : null,
    section('Before and after', 'tonight-detail-bounds', d.bounds ? [d.bounds] : null),
    section('When', 'tonight-detail-when', d.when),
    section('Ranks nearby', 'tonight-detail-ranks', d.ranks),
    section('At that hour', 'tonight-detail-hour', [d.hour]),
    section('Around the same time', 'tonight-detail-around', d.around ? [d.around] : null),
    section('How much Kerb counts it', 'tonight-detail-strength', d.strength, 1),
    d.record ? section('Your waits at this', 'tonight-detail-record', [d.record.text, d.record.note], 1) : null,
  ];
  body.push(h('p', { class: 'note', 'data-test': 'tonight-detail-footer' }, d.footer));
  return h('div', { class: 'overlay why tonight', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'tonight-title', 'data-test': 'tonight-sheet',
    onclick: (ev) => { if (ev.target === ev.currentTarget) A.closeTonightRow(); } }, // the backdrop steps back one level too (J2)
  h('div', { class: 'card', 'data-test': 'tonight-detail' },
    h('h2', { id: 'tonight-title', 'data-test': 'tonight-detail-title' }, d.passed ? S.tonight.rowTitle : d.title),
    h('div', { class: 'whybody tnbody tndetail', 'data-test': 'tonight-detail-body' }, body.flat(Infinity)),
    h('button', { class: 'btn big', type: 'button', 'data-test': 'tonight-back', onclick: () => A.closeTonightRow() }, 'Back to tonight')));
}

/** The sheet: the list, or a row's detail. It survives re-renders on every fix and tick and keeps its scroll (main.js). */
export function tonightSheet(S, A) {
  if (S.tonight && S.tonight.row) return detailSheet(S, A);
  if (S.tonight && S.tonight.long) return longSheet(S, A);
  const m = model(S);
  const body = [
    m.timetable.current ? null : h('p', { class: 'warn', 'data-test': 'tonight-stale' },
      `Timetables out of date (they ran to ${m.timetable.to ? dayLabel(m.timetable.to) : 'an earlier date'}): trains, trams and ferries not shown`),
    m.entries.length ? h('ol', { class: 'tnrows' }, m.entries.map((e) => (e.type === 'quiet' ? quietRow(e, A) : waveRow(e, A))))
      : h('p', {}, 'Nothing scheduled for the rest of the night.'),
    longButton(A), // ADR 0017
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
