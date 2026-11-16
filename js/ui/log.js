// The wait log with review (spec §8, §8b): confirm, answer later, fix the stand, or delete. Edits are events; nothing
// is overwritten (ADR 0005). Nothing leaves the phone unless exported (ADR 0004).
import { h, iconButton } from './dom.js';
import { hhmm } from '../engine/time.js';
import { distM } from '../engine/geo.js';
import { computeStats, toCheck } from '../engine/stats.js';
import { fmtMin } from './stats.js';
import { NOT_LISTED } from '../engine/stats.js';

const OUT = { fare: 'fare', left_empty: 'left empty', unknown: 'not answered' };

function nearbyStands(S, id, near) {
  if (id == null) return (near || []).map((n) => S.byId[n]).filter(Boolean); // rank not on the list: the stands near the start
  const here = S.byId[id];
  if (!here || !here.head) return [];
  return S.data.stands.filter((s) => s.head && s.id !== id && distM(here.head, s.head) <= 300)
    .sort((a, b) => distM(here.head, a.head) - distM(here.head, b.head)).slice(0, 6);
}

function row(S, A, w, label) {
  const name = w.stand == null ? NOT_LISTED : S.byId[w.stand] ? S.byId[w.stand].name : w.stand;
  const near = nearbyStands(S, w.stand, w.near);
  // ADR 0017: a rank fare logged by this release can be answered "long run (10 km+)?"; the latest answer wins
  const askable = w.outcome === 'fare' && w.shown && Array.isArray(w.shown.long);
  const answered = askable && typeof w.long === 'boolean';
  return h('div', { class: 'logrow', 'data-test': 'log-row' },
    h('span', {}, hhmm(new Date(w.joined_at))),
    h('span', {}, name, w.confirmed === false ? h('span', { class: 'badge' }, ' auto, unconfirmed') : null,
      w.off_shift ? h('span', { class: 'badge', 'data-test': 'row-off-shift' }, ' off shift') : null), // ADR 0010: kept, not counted
    h('span', {}, `${w.end_uncertain || w.start_uncertain ? 'at least ' : ''}${fmtMin(w.wait_min)}, ${OUT[w.outcome]}`),
    h('span', { class: 'note rowlabel' }, label === 'not enough yet' ? '' : `${label} than usual`.replace('about usual than usual', 'about usual')),
    h('div', { class: 'rowactions' },
      w.confirmed === false ? h('button', { class: 'btn small', 'data-test': 'row-confirm', onclick: () => A.review('confirm', w.joined_at) }, 'Confirm') : null,
      w.outcome === 'unknown' ? h('button', { class: 'btn small', 'data-test': 'row-fare', onclick: () => A.review('edit', w.joined_at, 'outcome', 'fare') }, 'Fare') : null,
      w.outcome === 'unknown' ? h('button', { class: 'btn small', 'data-test': 'row-left', onclick: () => A.review('edit', w.joined_at, 'outcome', 'left_empty') }, 'Left empty') : null,
      // an honest answer too: keeps the outcome unknown (censored) and takes it off the list to check
      w.outcome === 'unknown' && !w.outcome_reviewed ? h('button', { class: 'btn small', 'data-test': 'row-dontknow', onclick: () => A.review('edit', w.joined_at, 'outcome', 'unknown') }, "Don't know") : null,
      askable && !answered ? [h('span', { class: 'note' }, 'Long run (10 km+)?'),
        h('button', { class: 'btn small', 'data-test': 'row-long-yes', onclick: () => A.trip(w.joined_at, true, 'review') }, 'Yes'),
        h('button', { class: 'btn small', 'data-test': 'row-long-no', onclick: () => A.trip(w.joined_at, false, 'review') }, 'No')] : null),
    answered ? h('span', { class: 'note rowlong', 'data-test': 'row-long' }, w.long ? 'Long run' : 'Not a long run') : null,
    // less common fixes stay folded away so the list reads quietly
    h('details', { class: 'rowedit' }, h('summary', {}, 'Edit'),
      h('div', { class: 'rowactions' },
      near.length ? h('select', { class: 'small', 'data-test': 'row-stand', 'aria-label': `Wrong stand for the wait at ${hhmm(new Date(w.joined_at))}?`,
        onchange: (e) => e.target.value && A.review('edit', w.joined_at, 'stand', e.target.value) },
      h('option', { value: '' }, w.stand == null ? 'Choose rank' : 'Wrong stand?'), near.map((s) => h('option', { value: s.id }, s.name))) : null,
      answered ? h('button', { class: 'btn small', 'data-test': 'row-long-flip', onclick: () => A.trip(w.joined_at, !w.long, 'review') },
        w.long ? 'Not a long run' : 'A long run') : null,
      h('button', { class: 'btn small', 'data-test': 'row-delete', onclick: () => A.review('void', w.joined_at) }, 'Not a rank wait'))));
}

function lastBackupLine(S) {
  if (!S.lastBackup) return 'Not backed up yet. Your log is only on this phone until you back it up.';
  const days = Math.floor((S.now - Date.parse(S.lastBackup)) / 86400000);
  return `Last backup: ${days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`}.`;
}

export function log(S, A, parts) {
  const checking = S.logFilter === 'check';
  const waits = [...(checking ? toCheck(S.waits, S.now) : S.waits)].reverse();
  const st = computeStats(S.waits, S.now, { params: S.data.params, byId: S.byId });
  return [
    h('header', { class: 'top' }, iconButton('back', 'Back', A.back, 'nav-back'), h('span', { class: 'clock' }, parts.time)),
    h('main', { class: 'sheet', 'data-test': 'log' },
      h('h2', {}, checking ? 'Waits to check' : 'Your waits'),
      checking ? h('p', {}, 'Confirm the waits Kerb logged by itself, and say Fare or Left empty where you didn\'t answer. Confirmed waits count in your history and for scoring.') : null,
      checking ? h('button', { class: 'btn small', 'data-test': 'log-show-all', onclick: A.openLog }, 'Show all waits') : null,
      S.storageOk ? null : h('p', { class: 'warn', 'data-test': 'storage-warning' }, "Logs can't be saved on this browser: back up before closing Kerb."),
      S.storageOk && S.persisted === false ? h('p', { class: 'warn', 'data-test': 'storage-evictable' },
        "This phone may clear Kerb's data if space runs low. Back up after each shift.") : null,
      waits.length ? h('div', {}, waits.map((w) => row(S, A, w, st.label(w.joined_at))))
        : checking ? h('p', {}, 'Nothing left to check.')
        : h('p', {}, 'No waits logged yet. Leave Kerb on screen at a rank: in Auto it logs the wait by itself after 2 minutes; in Manual, tap "Start rank timer".'),
      h('div', { class: 'actions' },
        h('button', { class: 'btn', 'data-test': 'btn-export-json', onclick: A.exportJSON, disabled: !S.waits.length }, 'Back up log'),
        h('button', { class: 'btn', 'data-test': 'btn-export-csv', onclick: A.exportCSV, disabled: !S.waits.length }, 'Export spreadsheet (CSV)')),
      // the backup file is also the file for scoring (ADR 0008); restoring adds what this phone doesn't have yet
      h('label', { class: 'btn filebtn' }, 'Restore from backup',
        h('input', { type: 'file', accept: '.json,application/json', 'data-test': 'restore-file',
          onchange: (e) => { const f = e.target.files[0]; e.target.value = ''; A.restore(f); } })),
      S.restoreMsg ? h('p', { role: 'status', 'data-test': 'restore-result' }, S.restoreMsg) : null,
      h('p', { class: 'note', 'data-test': 'last-export' }, lastBackupLine(S)),
      h('p', { class: 'note' }, 'Nothing is uploaded. A backup is a file you keep, for example in Files or iCloud Drive.')),
  ];
}
