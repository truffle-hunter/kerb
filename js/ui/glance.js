// The glance screen (spec §8): one recommendation, two alternatives, the next hour, the logger bar.
import { h, iconButton, fmtKm, legalLine, minutesAgo } from './dom.js';
import { bearingDeg, cardinal } from '../engine/geo.js';
import { navUrl } from '../platform/nav.js';
import { hhmm, dublinParts } from '../engine/time.js';
import { backupDue } from '../engine/export.js';
import { ownHistory, historyLine } from '../engine/history.js';
import { toCheck } from '../engine/stats.js';
import { shiftSummary, onShiftMinutes, fatigueStage } from '../engine/shift.js';
import { dwelling } from '../engine/logger.js';

const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortDate = (d) => `${+d.slice(8, 10)} ${MONTHS[+d.slice(5, 7) - 1]}`;

const hm = (min) => `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`;
const plural = (n, one) => `${n} ${one}${n === 1 ? '' : 's'}`;
const minsOn = (S) => Math.max(0, Math.floor((S.now - Date.parse(S.shift.start)) / 60000));
const stage = (S) => (S.shift ? fatigueStage(onShiftMinutes(S.shifts, S.now.getTime(), S.data.params.shift.fatigue_window_h), S.data.params.shift) : 0);

/** On shift (ADR 0010): a roof-sign block and the time on shift, a 44 px target that opens End shift. The words carry
 * the state; the amber block only echoes the roof sign. Amber text from 10 h on shift in 24 h. */
function shiftChip(S, A) {
  const m = minsOn(S);
  return h('button', { class: `shiftchip${stage(S) >= 2 ? ' warn' : ''}`, 'data-test': 'shift-chip', onclick: A.openShift,
    'aria-label': `On shift ${Math.floor(m / 60)} hours ${m % 60} minutes. End shift` },
  // from 10 h the block gives way to the wider time (and the warn colour), so the icon row stays one line at 360 px
  m < 600 ? h('i', { class: 'roof', 'aria-hidden': 'true' }) : null, hm(m));
}

export function header(S, A, parts) {
  const stale = !S.timetable.current || S.eventsStale;
  return h('header', { class: 'top' },
    // on shift the weekday gives way to the shift chip, so the icon row stays one line on a 360 px phone
    h('span', { class: 'clock', 'data-test': 'clock' }, S.shift ? parts.time : `${parts.time} ${WD[parts.weekday]}`),
    S.shift ? shiftChip(S, A) : null,
    h('span', { class: 'spacer' }),
    iconButton('ranks', 'All ranks', A.openRanks, 'nav-ranks'),
    iconButton('stats', 'Your stats', A.openStats, 'nav-stats'),
    iconButton('log', 'Wait log', A.openLog, 'nav-log'),
    iconButton('settings', 'Settings', A.openSettings, 'nav-settings'),
    h('div', { class: 'row2' }, // second line: offline, how sure, how fresh the data is (keeps the icon row on one line)
      S.online ? null : h('span', { class: 'offline', 'data-test': 'offline' }, 'Offline'),
      // ADR 0008: once the driver has a confirmed wait, the minutes on screen are theirs; demand stays a guess
      h('span', { class: 'marker', 'data-test': 'marker' },
        S.waits.some((w) => w.confirmed !== false) ? 'Demand is a guess · waits are yours' : 'Guess · no driver data yet'),
      h('span', { class: stale ? 'offline' : 'datastate', 'data-test': 'data-state' },
        stale ? 'Data out of date' : `Data ${shortDate(S.data.meta.built_at)}`),
      S.updateReady ? h('button', { class: 'btn primary small', 'data-test': 'update-ready', onclick: () => location.reload() }, 'Update ready: reload') : null));
}

function recBlock(S, A, from) {
  const top = S.recs[0];
  if (!top) {
    return h('section', { class: 'rec' },
      h('p', { class: 'lead' }, 'No legal stand found'),
      h('button', { class: 'name', 'data-test': 'rec-name' }, 'Nothing open nearby'),
      h('p', { class: 'big', 'data-test': 'rec-reason' }, 'No stand within reach is legally usable right now.'));
  }
  const s = top.stand;
  const dir = s.head ? cardinal(bearingDeg(from, s.head)) : '';
  const rep = S.lastReport && S.lastReport.stand === s.id && minutesAgo(S.lastReport.t, S.now) <= S.data.params.logger.report_fresh_min
    ? `You saw ${S.lastReport.cabsAhead} cabs ahead · ${minutesAgo(S.lastReport.t, S.now)} min ago` : null;
  return h('section', { class: 'rec' },
    h('p', { class: 'lead' }, 'Head to'),
    h('button', { class: 'name', 'data-test': 'rec-name', 'data-stand': s.id, onclick: () => A.detail(s.id) }, s.name),
    kerbstones(top.demand.level),
    h('div', { class: 'demandrow' }, // Go sits high up so the pinned timer bar can never cover it (review fix)
      h('p', { class: 'big demand', 'data-test': 'rec-demand' }, // "likely: high" stays together: the level word never stands alone
        'Demand ', h('span', { class: 'nowrap' }, 'likely: ', h('b', {}, top.demand.level))),
      h('p', { class: 'big', 'data-test': 'rec-km' }, `${fmtKm(top.km, top.approx)} ${dir}`.trim()),
      h('a', { class: 'go', 'data-test': 'btn-go', href: navUrl(S.settings.nav, s.head, s.name), target: '_blank', rel: 'noopener' }, 'Go')),
    h('p', { class: 'big dim', 'data-test': 'rec-legal' }, legalLine(top.status)),
    h('p', { class: 'big dim', 'data-test': 'rec-reason' }, top.demand.reason),
    caution(S, s.id),
    hist(S, s.id, 'big hist', 'rec-history'),
    rep ? h('p', { class: 'report', 'data-test': 'rec-report' }, rep) : null);
}

/** Demand as three kerbstones (ADR 0009): filled ones are solid, so the level reads by count and shape, never colour
 * alone; the word stays beside it (ADR 0002). */
const STONES = { low: 1, medium: 2, high: 3 };
function kerbstones(level) {
  return h('div', { class: 'stripe', 'data-test': 'glance-stripe', 'data-level': level, role: 'img', 'aria-label': `Demand likely ${level}` },
    [0, 1, 2].map((i) => h('i', { class: i < STONES[level] ? 'on' : null })));
}

/** The driver's own past waits at a stand (ADR 0008), or nothing under 3 confirmed waits. */
function hist(S, id, cls, test) {
  const line = historyLine(ownHistory(S.waits, id, S.now));
  return line ? h('p', { class: cls, 'data-test': test }, line) : null;
}

const CAUTION_ORDER = ['relocation_note', 'works_note', 'capacity_note', 'access_note'];
function caution(S, id) {
  const r = (S.data.rules || []).filter((x) => x.stands.includes(id) && x.kind !== 'suspension')
    .sort((a, b) => CAUTION_ORDER.indexOf(a.kind) - CAUTION_ORDER.indexOf(b.kind))[0];
  return r ? h('p', { class: 'big caution', 'data-test': 'rec-caution' }, r.short) : null;
}

function restBlock(S, A) {
  const next = S.next;
  return h('section', { class: 'rest' },
    S.loc === 'ok' ? null : h('p', { class: 'warn', 'data-test': 'location-label' },
      S.loc === 'off' ? "Location off, so distances are from O'Connell Bridge" : "Finding your location; distances are from O'Connell Bridge for now"),
    S.storageOk ? null : h('p', { class: 'warn', 'data-test': 'storage-warning' }, "Logs can't be saved on this browser: waits you log are lost when Kerb closes."),
    S.recs.slice(1).map((r) => h('button', { class: 'alt', 'data-test': 'alt', 'data-stand': r.stand.id, onclick: () => A.detail(r.stand.id) },
      h('span', {}, r.stand.name), h('span', { class: 'km' }, fmtKm(r.km, r.approx)), h('span', { class: 'lvl' }, r.demand.level),
      hist(S, r.stand.id, 'althist', 'alt-history'))),
    h('p', { class: 'next', 'data-test': 'next-hour' }, !S.timetable.current
      ? `Timetables out of date (they ran to ${shortDate(S.timetable.to)}): trains, trams and ferries not shown`
      : next ? ['Next hour: ', h('b', {}, next.label)] : 'Nothing scheduled in the next hour'));
}

function standName(S, id) { if (id == null) return "rank not on Kerb's list"; const s = S.byId[id]; return s ? s.name : id; }

export function loggerBar(S, A) {
  const L = S.logger;
  if (S.shift && S.shiftView === 'end') return endShiftBar(S, A); // from the chip, over any bar
  if (!S.shift && L.mode === 'idle') return offShiftBar(S, A);
  if (L.mode === 'prompt') {
    return h('footer', { class: 'bar', 'data-test': 'join-bar' },
      h('p', { class: 'q' }, `Joined ${standName(S, L.stand)}?`),
      h('button', { class: 'btn primary', 'data-test': 'btn-join', onclick: () => A.join() }, 'Yes'),
      h('button', { class: 'btn tall', 'data-test': 'btn-dismiss', onclick: A.dismiss }, 'Not now'),
      L.candidates.length > 1 ? quiet(h('button', { class: 'btn quiet', 'data-test': 'btn-switch', onclick: A.switchStand }, 'Other stand')) : null);
  }
  if (L.mode === 'waiting' && S.picker) return pickerBar(S, A);
  if (L.mode === 'waiting') {
    const mins = minutesAgo(L.joinedAt, S.now);
    const src = S.openSource;
    const name = standName(S, L.stand);
    const lead = src === 'start' ? (L.stand == null ? `Timing: ${name}` : `Timing ${name}`) : src === 'auto' ? `Logging wait at ${name}` : `Waiting at ${name}`;
    const canSwitch = (L.stand && L.candidates.length > 1) || (S.data.chains || []).some((c) => [c.main, ...c.overflow].includes(L.stand));
    return h('footer', { class: 'bar', 'data-test': 'wait-bar' },
      h('p', { class: 'q', 'data-test': 'wait-timer' }, `${lead}, `, h('b', { class: 'nowrap' }, `${mins} min`)),
      h('span', { class: 'stepper', 'data-test': 'cabs-stepper' },
        h('button', { class: 'btn', 'aria-label': 'One fewer cab ahead', onclick: () => A.report(-1) }, '−'),
        h('output', { 'aria-label': 'Cabs ahead of you' }, S.cabsAhead == null ? '?' : String(S.cabsAhead)),
        h('button', { class: 'btn', 'aria-label': 'One more cab ahead', onclick: () => A.report(1) }, '+'),
        h('span', { class: 'note' }, 'cabs ahead')),
      h('button', { class: 'btn primary', 'data-test': 'btn-fare', onclick: A.fareIn }, 'Fare'),
      h('button', { class: 'btn tall', 'data-test': 'btn-left', onclick: A.left }, 'Left empty'),
      quiet( // "Choose rank" takes the "Other stand" slot: a wait with no rank has nothing to switch from
        L.stand == null ? h('button', { class: 'btn quiet', 'data-test': 'btn-choose', onclick: A.openPicker }, 'Choose rank')
          : canSwitch ? h('button', { class: 'btn quiet', 'data-test': 'btn-switch', onclick: A.switchStand }, 'Other stand') : null,
        h('button', { class: 'btn quiet', 'data-test': 'btn-discard', onclick: A.discard }, 'Not a rank wait')));
  }
  if (L.mode === 'outcome') {
    const mins = L.departAt && L.joinedAt ? Math.round((L.departAt - L.joinedAt) / 60000) : null;
    return h('footer', { class: 'bar', 'data-test': 'outcome-bar' },
      h('p', { class: 'q' }, `Left ${standName(S, L.stand)}${L.departAt ? ` at ${hhmm(L.departAt)}` : ''}${mins != null ? ` after ${mins} min` : ''}. Fare?`),
      h('button', { class: 'btn primary', 'data-test': 'btn-fare', onclick: A.fare }, 'Fare'),
      h('button', { class: 'btn tall', 'data-test': 'btn-left', onclick: A.left }, 'Left empty'),
      quiet(h('button', { class: 'btn quiet', 'data-test': 'btn-still', onclick: A.still }, 'Still waiting'),
        h('button', { class: 'btn quiet', 'data-test': 'btn-discard', onclick: A.discard }, 'Not a rank wait')));
  }
  return idleBar(S, A);
}

function pickerBar(S, A) {
  return h('footer', { class: 'bar picking', 'data-test': 'picker' },
    h('p', { class: 'q' }, 'Which rank are you at?'),
    h('div', { class: 'picker' }, S.nearby.length ? S.nearby.map((s) => h('button', { class: 'btn', 'data-test': 'pick', onclick: () => A.chooseRank(s.id) }, s.name))
      : h('p', { class: 'note' }, 'No rank on Kerb\'s list within 1 km.')),
    quiet(h('button', { class: 'btn quiet', onclick: A.closePicker }, 'Cancel')));
}

/** The rarer bar actions, as quiet text buttons on one row beneath the main ones (ADR 0009). */
const quiet = (...buttons) => h('div', { class: 'quietrow' }, buttons);

const seg = (label, on, onclick, test) => h('button', { class: `seg${on ? ' on' : ''}`, role: 'radio', 'aria-checked': on ? 'true' : 'false', 'data-test': test, onclick }, label);

/** Idle bar (ADR 0006): the big Auto / Manual rank-timer switch, which rank Kerb sees, and Start. */
function idleBar(S, A) {
  const auto = S.settings.autoLog !== false;
  const d = S.detected;
  const seen = d && d.detect === 'zone' ? `You're at ${standName(S, d.stand)}`
    : d && d.detect === 'nearest' ? `Nearest rank: ${standName(S, d.stand)}` : null;
  // In Auto, promise a start by itself only when the logger's own gating says so (S.autoStart, from autoStartFor):
  // it names the stand the stop is timed against. Otherwise name what Start would use and ask for the tap.
  const a = S.autoStart;
  const status = !auto ? seen || 'No rank spotted here'
    : a && a.will ? `You're at ${standName(S, a.stand)} · starts after 2 min`
      : seen ? `${seen} · tap Start now` : 'Starts by itself after 2 min at a rank';
  return h('footer', { class: `bar idle${auto ? '' : ' manual'}` },
    h('div', { class: `modeswitch${auto ? '' : ' is-manual'}`, role: 'radiogroup', 'aria-label': 'Rank timer', 'data-test': 'mode-switch' },
      seg('Auto', auto, () => A.setMode(true), 'mode-auto'),
      seg('Manual', !auto, () => A.setMode(false), 'mode-manual')),
    h('p', { class: 'q timerstatus', 'data-test': 'timer-status' }, status),
    h('button', { class: auto ? 'btn' : 'btn primary big', 'data-test': 'btn-start', onclick: A.start }, auto ? 'Start now' : 'Start rank timer'),
    reminders(S, A));
}

/** End shift (ADR 0010), opened from the chip: parked, two taps; "Keep going" closes it. */
function endShiftBar(S, A) {
  return h('footer', { class: 'bar idle shiftbar', 'data-test': 'shift-bar' },
    h('p', { class: 'q timerstatus', 'data-test': 'shift-status' }, `On shift since ${hhmm(new Date(S.shift.start))} · ${hm(minsOn(S))}`),
    h('button', { class: 'btn', 'data-test': 'btn-shift-end', onclick: A.endShift }, 'End shift'),
    quiet(h('button', { class: 'btn quiet', 'data-test': 'btn-shift-keep', onclick: A.keepGoing }, 'Keep going')));
}

/** Off shift (ADR 0010): nothing is logged. One tap starts the shift; stopped at a rank, the line offers it there (and
 * the wait still counts from the start of the stop). A shift that ended in the last 12 hours shows its summary, with
 * "Still on shift" while the end is under 3 hours old. */
function offShiftBar(S, A) {
  const P = S.data.params.shift;
  const last = S.shifts[S.shifts.length - 1];
  const ended = last && last.end && S.now - Date.parse(last.end_written || last.end) <= P.summary_show_h * 3600000;
  const d = dwelling(S.logger);
  const atRank = d && d.seconds >= S.data.params.logger.prompt_s && S.byId[d.stand];
  let line = atRank ? `At ${S.byId[d.stand].name}. Start shift?` : "Off shift · waits aren't logged";
  if (ended && !atRank) {
    const m = shiftSummary(last, S.waits, S.now.getTime()), end = new Date(last.end);
    // each part stays whole ("1 h 15" never splits across lines); the parts wrap between them
    line = [`Shift ended ${WD[dublinParts(end).weekday]} ${hhmm(end)}`, `${hm(m.on_min)} on shift`, `${hm(m.rank_min)} at ranks`,
      plural(m.waits, 'wait'), plural(m.fares, 'fare')].flatMap((t, i) => [i ? ' · ' : null, h('span', { class: 'nowrap' }, t)]);
  }
  const canResume = ended && S.now - Date.parse(last.end) <= P.resume_max_min * 60000;
  return h('footer', { class: 'bar idle shiftbar', 'data-test': ended ? 'ended-bar' : 'offshift-bar' },
    h('p', { class: 'q timerstatus', 'data-test': 'shift-status' }, line),
    h('button', { class: 'btn primary big', 'data-test': 'btn-shift-start', onclick: () => A.startShift(atRank ? 'rank_prompt' : 'tap') }, 'Start shift'),
    canResume ? quiet(h('button', { class: 'btn quiet', 'data-test': 'btn-shift-resume', onclick: A.resumeShift }, 'Still on shift')) : null,
    reminders(S, A));
}

const FATIGUE = (P) => [null, `${P.fatigue_h[0]} h on shift in 24 h`, `${P.fatigue_h[1]} h on shift. NTA limit: ${P.fatigue_h[2]} h with passengers`,
  `${P.fatigue_h[2]} h on shift in 24 h`];

/** Quiet reminders on the idle bar (ADR 0008): back up the log (only on this phone), and waits to check; on shift, the
 * time on shift from 9 hours in 24 (ADR 0010; never a block). */
function reminders(S, A) {
  const ended = S.shifts.filter((x) => x.end); // ADR 0010: "after each shift" means the real end, where there are shifts
  const b = backupDue(S.waits, S.lastBackup, S.now, { persisted: S.persisted, startHour: S.data.params.demand.service_day_start_hour, events: S.events,
    ...(S.shifts.length ? { onShift: !!S.shift, shiftEnd: ended.length ? ended[ended.length - 1].end : null } : {}) });
  const items = [];
  if (b.due) items.push(h('button', { class: 'nudge', 'data-test': 'backup-nudge', onclick: A.openLog },
    `${b.count} wait${b.count === 1 ? '' : 's'} not backed up`));
  // automatic waits stay out of scoring and your history until confirmed; unanswered ones have no outcome
  const n = toCheck(S.waits, S.now).length;
  if (n) items.push(h('button', { class: 'nudge', 'data-test': 'check-nudge', onclick: A.openCheckLog }, `${n} wait${n === 1 ? '' : 's'} to check`));
  const f = stage(S);
  if (f) items.push(h('button', { class: 'nudge', 'data-test': 'fatigue-nudge', onclick: A.openStats }, FATIGUE(S.data.params.shift)[f]));
  return items.length ? h('div', { class: 'reminders' }, items) : null;
}
export function glance(S, A, parts) {
  const from = S.fix ? [S.fix.lon, S.fix.lat] : S.ocb;
  return [header(S, A, parts), h('main', { class: 'glance' }, recBlock(S, A, from), restBlock(S, A)), loggerBar(S, A)];
}
