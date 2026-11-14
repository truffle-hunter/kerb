// The wait log with review (spec §8, §8b): confirm, answer later, fix the stand, or delete. Edits are events; nothing
// is overwritten (ADR 0005). Nothing leaves the phone unless exported (ADR 0004).
import { h, iconButton } from './dom.js';
import { hhmm } from '../engine/time.js';
import { distM } from '../engine/geo.js';
import { computeStats } from '../engine/stats.js';
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
  return h('div', { class: 'logrow', 'data-test': 'log-row' },
    h('span', {}, hhmm(new Date(w.joined_at))),
    h('span', {}, name, w.confirmed === false ? h('span', { class: 'badge' }, ' auto, unconfirmed') : null),
    h('span', {}, `${w.end_uncertain || w.start_uncertain ? 'at least ' : ''}${fmtMin(w.wait_min)}, ${OUT[w.outcome]}`),
    h('span', { class: 'note rowlabel' }, label === 'not enough yet' ? '' : `${label} than usual`.replace('about usual than usual', 'about usual')),
    h('div', { class: 'rowactions' },
      w.confirmed === false ? h('button', { class: 'btn small', 'data-test': 'row-confirm', onclick: () => A.review('confirm', w.joined_at) }, 'Confirm') : null,
      w.outcome === 'unknown' ? h('button', { class: 'btn small', 'data-test': 'row-fare', onclick: () => A.review('edit', w.joined_at, 'outcome', 'fare') }, 'Fare') : null,
      w.outcome === 'unknown' ? h('button', { class: 'btn small', 'data-test': 'row-left', onclick: () => A.review('edit', w.joined_at, 'outcome', 'left_empty') }, 'Left empty') : null),
    // less common fixes stay folded away so the list reads quietly
    h('details', { class: 'rowedit' }, h('summary', {}, 'Edit'),
      h('div', { class: 'rowactions' },
      near.length ? h('select', { class: 'small', 'data-test': 'row-stand', 'aria-label': `Wrong stand for the wait at ${hhmm(new Date(w.joined_at))}?`,
        onchange: (e) => e.target.value && A.review('edit', w.joined_at, 'stand', e.target.value) },
      h('option', { value: '' }, w.stand == null ? 'Choose rank' : 'Wrong stand?'), near.map((s) => h('option', { value: s.id }, s.name))) : null,
      h('button', { class: 'btn small', 'data-test': 'row-delete', onclick: () => A.review('void', w.joined_at) }, 'Not a rank wait'))));
}

function lastExportLine(S) {
  if (!S.lastExport) return 'Not exported yet. Export for scoring once a week and send the file.';
  const days = Math.floor((S.now - Date.parse(S.lastExport)) / 86400000);
  return `Last export for scoring: ${days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`}.`;
}

export function log(S, A, parts) {
  const waits = [...S.waits].reverse();
  const st = computeStats(S.waits, S.now, { params: S.data.params, byId: S.byId });
  return [
    h('header', { class: 'top' }, iconButton('back', 'Back', A.back, 'nav-back'), h('span', { class: 'clock' }, parts.time)),
    h('main', { class: 'sheet', 'data-test': 'log' },
      h('h2', {}, 'Your waits'),
      S.storageOk ? null : h('p', { class: 'warn', 'data-test': 'storage-warning' }, "Logs can't be saved on this browser: export before closing Kerb."),
      waits.length ? h('div', {}, waits.map((w) => row(S, A, w, st.label(w.joined_at))))
        : h('p', {}, 'No waits logged yet. Leave Kerb on screen at a rank: in Auto it logs the wait by itself after 2 minutes; in Manual, tap "Start rank timer".'),
      h('div', { class: 'actions' },
        h('button', { class: 'btn', 'data-test': 'btn-export-json', onclick: A.exportJSON, disabled: !waits.length }, 'Export for scoring (JSON)'),
        h('button', { class: 'btn', 'data-test': 'btn-export-csv', onclick: A.exportCSV, disabled: !waits.length }, 'Export spreadsheet (CSV)')),
      h('p', { class: 'note', 'data-test': 'last-export' }, lastExportLine(S)),
      h('p', { class: 'note' }, 'Uploads: off. Your log stays on this phone until you export it.')),
  ];
}
