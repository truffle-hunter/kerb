// Phone check (decision 2026-11-14): is this phone ready for a shift? Each row says OK / Check / Fix / To do / Info /
// Not supported in words (colour is only a second cue). Copy report gives plain text with no coordinates; nothing
// is sent from here. The facts come from gatherProbe(); the grading is engine/phonecheck.js.
import { h, iconButton } from './dom.js';
import { fixSummary } from '../engine/phonecheck.js';
import * as store from '../platform/store.js';
import { shiftSupported } from '../platform/wake.js';

const KEY_FILES = ['./', 'app.css', 'js/main.js', ...['stands', 'chains', 'rules', 'graph', 'streets', 'triggers',
  'events', 'catchments', 'params', 'meta'].map((f) => `data/${f}.json`)];
const STATE_WORD = { pass: 'OK', warn: 'Check', fail: 'Fix', todo: 'To do', info: 'Info', unsupported: 'Not supported' };

const quiet = (p) => p.catch(() => null);

async function cached() {
  if (typeof caches === 'undefined') return null;
  const key = (await caches.keys()).find((k) => k.startsWith('kerb-'));
  if (!key) return { have: 0, want: KEY_FILES.length };
  const c = await caches.open(key);
  const hits = await Promise.all(KEY_FILES.map((f) => c.match(new URL(f, document.baseURI).href, { ignoreSearch: true })));
  return { have: hits.filter(Boolean).length, want: KEY_FILES.length };
}

async function storageWorks(nowIso) {
  if (!store.available()) return 'memory';
  await store.setSetting('phoneCheckAt', nowIso);
  return (await store.settings()).phoneCheckAt === nowIso ? 'ok' : 'fail';
}

/** What this phone and browser report right now. Location is summarised (accuracy, speed), never stored. */
export async function gatherProbe(S, nowIso) {
  const perm = navigator.permissions ? quiet(navigator.permissions.query({ name: 'geolocation' }).then((s) => s.state)) : null;
  const battery = navigator.getBattery ? quiet(navigator.getBattery().then((b) => ({ level: Math.round(b.level * 100), charging: b.charging }))) : null;
  const persisted = navigator.storage && navigator.storage.persisted ? quiet(navigator.storage.persisted()) : null;
  return {
    now: nowIso, ua: navigator.userAgent,
    standalone: matchMedia('(display-mode: standalone)').matches || navigator.standalone === true,
    swControl: 'serviceWorker' in navigator ? !!navigator.serviceWorker.controller : null,
    cached: await quiet(cached()),
    offlineBootAt: S.offlineBootAt,
    storage: await quiet(storageWorks(nowIso)) || 'fail',
    persisted: await persisted,
    wakeLock: shiftSupported(),
    permission: await perm,
    fixes: fixSummary(S.fixLog), creepAccM: S.data.params.logger.creep_max_accuracy_m,
    battery: await battery,
    data: { bundle: S.data.meta.bundle_version, built: S.data.meta.built_at, timetableTo: S.timetable.to,
      timetableCurrent: S.timetable.current, eventsUpdated: S.data.meta.events.updated, eventsStale: S.eventsStale },
  };
}

export function phoneCheck(S, A, parts) {
  const c = S.check;
  return [
    h('header', { class: 'top' }, iconButton('back', 'Back to settings', A.openSettings, 'nav-back'), h('span', { class: 'clock' }, parts.time)),
    h('main', { class: 'sheet', 'data-test': 'phone-check' },
      h('h2', {}, 'Phone check'),
      h('p', {}, 'Is this phone ready for a shift? Open Kerb from the home screen, stand outside for a minute, then check. Nothing is sent: copy the report and send it yourself.'),
      !c ? h('p', { class: 'note' }, 'Checking…') : [
        h('div', { class: 'checklist' }, c.rows.map((r) => h('div', { class: `checkrow s-${r.state}`, 'data-test': 'check-row', 'data-key': r.key, 'data-state': r.state },
          h('span', { class: 'checkstate' }, STATE_WORD[r.state]),
          h('span', { class: 'checklabel' }, r.label),
          h('span', { class: 'note' }, r.detail)))),
        h('div', { class: 'rowactions' },
          h('button', { class: 'btn primary', 'data-test': 'check-copy', onclick: A.copyReport }, c.copied ? 'Copied' : 'Copy report'),
          h('button', { class: 'btn', 'data-test': 'check-again', onclick: A.openCheck }, 'Check again')),
        h('label', {}, 'Report (no locations in it)',
          h('textarea', { class: 'report', 'data-test': 'check-report', readonly: true, rows: 8 }, c.text)),
      ]),
  ];
}
