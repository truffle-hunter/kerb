// "Why this rank?" (ADR 0013, spec docs/superpowers/specs/2026-11-15-kerb-why-design.md §2-3): a bottom sheet with every
// reason Kerb picked a stand. It maps explain() onto nodes and does no arithmetic of its own.
import { h, legalLine } from './dom.js';
import { explain } from '../engine/explain.js';
import { ownHistory, historyLine } from '../engine/history.js';

const WORDS = ['none', 'one', 'two', 'three', 'four', 'five', 'six'];

const honest = () => h('p', { class: 'note', 'data-test': 'why-honest' },
  "Every weight here is a guess until real waits are logged. Kerb never predicts how long you'll wait.");

function reasons(S, e, switchBtn) {
  const hist = historyLine(ownHistory(S.waits, e.stand.id, S.now)); // ADR 0008: the driver's own, never in the guess
  return [
    h('p', { 'data-test': 'why-verdict' }, e.verdict), switchBtn,
    h('h3', {}, `Demand likely: ${e.level}`),
    h('p', { class: 'note' }, 'What the guess is made of'),
    h('ul', { class: 'whyrows' }, e.rows.map((r) => h('li', { class: 'whyrow', 'data-test': 'why-row', 'data-key': r.key },
      h('span', { class: 'whylabel' }, r.label),
      h('span', { class: 'whypct', 'data-test': 'why-pct' }, `${r.share}%`),
      h('span', { class: 'bandbar', 'aria-hidden': 'true' }, h('i', { style: `width: ${r.share}%` })),
      r.note ? h('span', { class: 'note' }, r.note) : null))),
    h('h3', {}, 'Getting there'),
    h('p', { 'data-test': 'why-distance' }, e.distance.text),
    e.arrival ? h('p', { class: 'note', 'data-test': 'why-arrival' }, e.arrival.text) : null, // ADR 0014
    h('h3', {}, 'Legal'),
    h('p', { 'data-test': 'why-legal' }, legalLine(e.legal.status)),
    e.legal.lines.map((t) => h('p', { class: 'note' }, t)),
    e.versus.length ? [h('h3', {}, 'Against the others'), e.versus.map((v) => h('p', { 'data-test': 'why-vs' }, v.text))] : null,
    hist ? [h('h3', {}, 'Your waits here'), h('p', { 'data-test': 'why-history' }, hist),
      h('p', { class: 'note' }, 'Shown for you; not part of the demand guess.')] : null,
    honest(),
  ];
}

/** The sheet for S.why.id. It stays on that stand when the recommendation changes, and offers the new top instead. */
export function why(S, A, from) {
  const s = S.byId[S.why.id];
  const e = explain(S.recs, s.id, S.ctx, { permit: S.settings.permit, from, nowTop: S.nowTop });
  const top = S.recs[0];
  const switchBtn = top && top.stand.id !== s.id
    ? h('button', { class: 'btn quiet', type: 'button', 'data-test': 'why-switch', onclick: () => A.openWhy(top.stand.id) }, `Why ${top.stand.name}?`)
    : null;
  const n = S.data.params.rank.n;
  const body = e ? reasons(S, e, switchBtn)
    : [h('p', { 'data-test': 'why-verdict' }, `${s.name} is no longer one of the top ${WORDS[n] || n}.`), switchBtn, honest()];
  return h('div', { class: 'overlay why', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'why-title', 'data-test': 'why-sheet',
    onclick: (ev) => { if (ev.target === ev.currentTarget) A.closeWhy(); } }, // a tap on the backdrop, never inside the card
  h('div', { class: 'card' },
    h('h2', { id: 'why-title' }, `Why ${s.name}`),
    h('div', { class: 'whybody', 'data-test': 'why-body' }, body.flat(Infinity)), // h() flattens one level only
    h('button', { class: 'btn big', type: 'button', 'data-test': 'why-close', onclick: () => A.closeWhy() }, 'Close')));
}
