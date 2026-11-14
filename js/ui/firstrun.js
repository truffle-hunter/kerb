// First-run notice (spec §1): says plainly what Kerb does and does not tell you.
import { h } from './dom.js';

export function firstrun(A) {
  return h('div', { class: 'overlay', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'fr-title', 'data-test': 'firstrun' },
    h('div', { class: 'card' },
      h('h2', { id: 'fr-title' }, 'Kerb'),
      h('p', {}, "Kerb shows the taxi stands you can legally use near you, how far they are by road, where demand is likely and why, and what's coming in the next hour."),
      h('p', {}, "It doesn't yet tell you how long you'll wait. Nobody has measured waits at Dublin ranks, so any number of minutes would be made up. Log your waits with one tap when you stop, and that can change."),
      h('p', {}, 'Your log stays on this phone. Add Kerb to your home screen so the phone keeps it.'),
      h('button', { class: 'btn primary', 'data-test': 'firstrun-ok', onclick: A.firstRunOk }, 'Got it')));
}
