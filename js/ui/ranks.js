// Ranks (ADR 0008): look up any stand, not only the three recommended. Nearest first, with its legal status now and
// the driver's own history there. Filtering hides rows in place, so the keyboard stays up while typing.
import { h, iconButton, fmtKm, legalLine } from './dom.js';
import { status } from '../engine/legal.js';
import { matches, sortStands, norm, streetOf } from '../engine/ranks.js';
import { ownHistory, historyLine } from '../engine/history.js';

function applyFilter(list, query) {
  for (const row of list.children) row.hidden = !matches({ name: row.dataset.name, street: row.dataset.street, locality: row.dataset.locality }, query);
}

export function ranks(S, A, parts) {
  const from = S.fix ? [S.fix.lon, S.fix.lat] : S.ocb;
  const rows = sortStands(S.data.stands, S.km, from);
  const list = h('div', { class: 'ranklist', role: 'list' }, rows.map(({ stand: s, km, approx }) => {
    const mine = historyLine(ownHistory(S.waits, s.id, S.now));
    return h('button', { class: 'rankrow', role: 'listitem', 'data-test': 'rank-row', 'data-stand': s.id,
      'data-name': s.name, 'data-street': streetOf(s), 'data-locality': s.locality || '', onclick: () => A.detail(s.id, 'ranks') },
    h('span', { class: 'rankname' }, s.name, s.locality ? h('span', { class: 'note' }, ` ${s.locality}`) : null),
    h('span', { class: 'km' }, km === null ? 'not on the map' : fmtKm(km, approx)),
    // the street, when the name doesn't say it (so a filter on "amiens" shows why Connolly Station matched)
    streetOf(s) && !norm(s.name).includes(norm(streetOf(s))) ? h('span', { class: 'note rankstreet' }, streetOf(s)) : null,
    // capacity tells apart stands that share a street name (three on Amiens Street)
    h('span', { class: 'note ranklegal' }, `${legalLine(status(s, S.now, S.ctx))}${s.capacity ? ` · ${s.capacity} cabs` : ''}`
      + (s.access === 'daa_permit' && !S.settings.permit ? ' · daa permit needed' : '')),
    mine ? h('span', { class: 'note rankhist' }, mine) : null);
  }));
  applyFilter(list, S.rankQuery || '');
  return [
    h('header', { class: 'top' }, iconButton('back', 'Back', A.back, 'nav-back'), h('span', { class: 'clock' }, parts.time)),
    h('main', { class: 'sheet', 'data-test': 'ranks' },
      h('h2', {}, 'All ranks'),
      h('label', {}, 'Find a rank',
        h('input', { type: 'search', 'data-test': 'ranks-filter', value: S.rankQuery || '', placeholder: 'Street or rank name',
          autocomplete: 'off', oninput: (e) => { S.rankQuery = e.target.value; applyFilter(list, S.rankQuery); } })),
      h('p', { class: 'note' }, `${rows.length} stands, nearest first. Road distances where Kerb has a route; ~ is approximate.`),
      list),
  ];
}
