// The glance screen (spec §8): one recommendation, two alternatives, the next hour, the logger bar.
import { h, iconButton, fmtKm, legalLine, minutesAgo } from './dom.js';
import { bearingDeg, cardinal } from '../engine/geo.js';
import { navUrl } from '../platform/nav.js';

const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortDate = (d) => `${+d.slice(8, 10)} ${MONTHS[+d.slice(5, 7) - 1]}`;

export function header(S, A, parts) {
  const stale = !S.timetable.current || S.eventsStale;
  return h('header', { class: 'top' },
    h('span', { class: 'clock', 'data-test': 'clock' }, `${parts.time} ${WD[parts.weekday]}`),
    S.online ? null : h('span', { class: 'offline', 'data-test': 'offline' }, 'Offline'),
    h('span', { class: stale ? 'offline' : 'datastate', 'data-test': 'data-state' },
      stale ? 'Data out of date' : `Data ${shortDate(S.data.meta.built_at)}`),
    S.updateReady ? h('button', { class: 'btn primary small', 'data-test': 'update-ready', onclick: () => location.reload() }, 'Update ready: reload') : null,
    h('span', { class: 'spacer' }),
    iconButton('log', 'Wait log', A.openLog, 'nav-log'),
    iconButton('settings', 'Settings', A.openSettings, 'nav-settings'),
    h('span', { class: 'marker', 'data-test': 'marker' }, 'Guess · no driver data yet'));
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
    h('button', { class: `name${S.changed ? ' changed' : ''}`, 'data-test': 'rec-name', 'data-stand': s.id, onclick: () => A.detail(s.id) }, s.name),
    h('div', { class: 'stripe', 'data-level': top.demand.level, role: 'img', 'aria-label': `Demand likely ${top.demand.level}` }, h('i')),
    h('p', { class: 'big demand', 'data-test': 'rec-demand' }, `Demand likely: ${top.demand.level}`),
    h('p', { class: 'big', 'data-test': 'rec-km' }, `${fmtKm(top.km, top.approx)} ${dir}`.trim()),
    h('p', { class: 'big', 'data-test': 'rec-legal' }, legalLine(top.status)),
    h('p', { class: 'big', 'data-test': 'rec-reason' }, top.demand.reason),
    caution(S, s.id),
    rep ? h('p', { class: 'report', 'data-test': 'rec-report' }, rep) : null,
    h('div', { class: 'actions' },
      h('a', { class: 'go', 'data-test': 'btn-go', href: navUrl(S.settings.nav, s.head, s.name), target: '_blank', rel: 'noopener' }, 'Go')));
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
      h('span', {}, r.stand.name), h('span', { class: 'km' }, fmtKm(r.km, r.approx)), h('span', { class: 'lvl' }, r.demand.level))),
    h('p', { class: 'next', 'data-test': 'next-hour' }, !S.timetable.current
      ? `Timetables out of date (they ran to ${shortDate(S.timetable.to)}): trains, trams and ferries not shown`
      : next ? ['Next hour: ', h('b', {}, next.label)] : 'Nothing scheduled in the next hour'));
}

function standName(S, id) { const s = S.byId[id]; return s ? s.name : id; }

export function loggerBar(S, A) {
  const L = S.logger;
  if (L.mode === 'prompt') {
    return h('footer', { class: 'bar', 'data-test': 'join-bar' },
      h('p', { class: 'q' }, `Joined ${standName(S, L.stand)}?`),
      h('button', { class: 'btn primary', 'data-test': 'btn-join', onclick: () => A.join() }, 'Yes'),
      L.candidates.length > 1 ? h('button', { class: 'btn', 'data-test': 'btn-switch', onclick: A.switchStand }, 'Other stand') : null,
      h('button', { class: 'btn', 'data-test': 'btn-dismiss', onclick: A.dismiss }, 'Not now'));
  }
  if (L.mode === 'waiting') {
    const mins = minutesAgo(L.joinedAt, S.now);
    return h('footer', { class: 'bar', 'data-test': 'wait-bar' },
      h('p', { class: 'q', 'data-test': 'wait-timer' }, `Waiting at ${standName(S, L.stand)}, ${mins} min`),
      h('span', { class: 'stepper', 'data-test': 'cabs-stepper' },
        h('button', { class: 'btn', 'aria-label': 'One fewer cab ahead', onclick: () => A.report(-1) }, '−'),
        h('output', { 'aria-label': 'Cabs ahead of you' }, S.cabsAhead == null ? '?' : String(S.cabsAhead)),
        h('button', { class: 'btn', 'aria-label': 'One more cab ahead', onclick: () => A.report(1) }, '+'),
        h('span', { class: 'note' }, 'cabs ahead')),
      h('button', { class: 'btn primary', 'data-test': 'btn-fare', onclick: A.fareIn }, 'Fare'),
      h('button', { class: 'btn', 'data-test': 'btn-left', onclick: A.left }, 'Left empty'),
      (S.byId[L.stand] && L.candidates.length) || (S.data.chains || []).some((c) => [c.main, ...c.overflow].includes(L.stand))
        ? h('button', { class: 'btn', 'data-test': 'btn-switch', onclick: A.switchStand }, 'Other stand') : null);
  }
  if (L.mode === 'outcome') {
    return h('footer', { class: 'bar', 'data-test': 'outcome-bar' },
      h('p', { class: 'q' }, `You left ${standName(S, L.stand)}. Fare or left empty?`),
      h('button', { class: 'btn primary', 'data-test': 'btn-fare', onclick: A.fare }, 'Fare'),
      h('button', { class: 'btn', 'data-test': 'btn-left', onclick: A.left }, 'Left empty'));
  }
  if (S.picker) {
    return h('footer', { class: 'bar', 'data-test': 'picker' },
      h('p', { class: 'q' }, 'Which stand are you at?'),
      h('div', { class: 'picker' }, S.nearby.length ? S.nearby.map((s) => h('button', { class: 'btn', 'data-test': 'pick', onclick: () => A.join(s.id) }, s.name))
        : h('p', { class: 'note' }, 'No open stand within 1 km.')),
      h('button', { class: 'btn', onclick: A.closePicker }, 'Cancel'));
  }
  return h('footer', { class: 'bar' },
    h('button', { class: 'btn', 'data-test': 'btn-manual', onclick: A.openPicker }, 'At a rank? Log your wait'));
}

export function glance(S, A, parts) {
  const from = S.fix ? [S.fix.lon, S.fix.lat] : S.ocb;
  return [header(S, A, parts), h('main', { class: 'glance' }, recBlock(S, A, from), restBlock(S, A)), loggerBar(S, A)];
}
