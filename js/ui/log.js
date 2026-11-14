// The wait log (spec §8): what this phone has recorded, and export. Nothing leaves the phone otherwise (ADR 0004).
import { h, iconButton } from './dom.js';
import { hhmm } from '../engine/time.js';

const OUT = { fare: 'fare', left_empty: 'left empty', unknown: 'not answered' };

export function log(S, A, parts) {
  const waits = [...S.waits].reverse();
  return [
    h('header', { class: 'top' }, iconButton('back', 'Back', A.back, 'nav-back'), h('span', { class: 'clock' }, parts.time)),
    h('main', { class: 'sheet', 'data-test': 'log' },
      h('h2', {}, 'Your waits'),
      S.storageOk ? null : h('p', { class: 'warn', 'data-test': 'storage-warning' }, "Logs can't be saved on this browser: export before closing Kerb."),
      waits.length ? h('div', {}, waits.map((w) => h('div', { class: 'logrow', 'data-test': 'log-row' },
        h('span', {}, hhmm(new Date(w.joined_at))),
        h('span', {}, S.byId[w.stand] ? S.byId[w.stand].name : w.stand),
        h('span', {}, `${w.wait_min.toFixed(0)} min, ${OUT[w.outcome]}`))))
        : h('p', {}, 'No waits logged yet. When you stop at a rank, tap "Joined" and then "Fare" or "Left empty".'),
      h('div', { class: 'actions' },
        h('button', { class: 'btn', 'data-test': 'btn-export-json', onclick: A.exportJSON, disabled: !waits.length }, 'Export for scoring (JSON)'),
        h('button', { class: 'btn', 'data-test': 'btn-export-csv', onclick: A.exportCSV, disabled: !waits.length }, 'Export spreadsheet (CSV)')),
      h('p', { class: 'note' }, 'Uploads: off. Your log stays on this phone until you export it.')),
  ];
}
