// First-run notice (spec §1): says plainly what Kerb does and does not tell you.
import { h } from './dom.js';

export function firstrun(A) {
  return h('div', { class: 'overlay', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'fr-title', 'data-test': 'firstrun' },
    h('div', { class: 'card' },
      h('h2', { id: 'fr-title' }, 'Kerb'),
      h('p', {}, "Kerb shows the taxi stands you can legally use near you, how far they are by road, where demand is likely and why, and what's coming in the next hour."),
      h('p', {}, "It doesn't predict how long you'll wait: nobody has measured waits at Dublin ranks, so any forecast would be made up. Once you've logged 3 waits at a rank, Kerb shows your own past waits there."),
      h('p', {}, "While Kerb is on screen it logs a wait by itself after 2 minutes at a rank, and notices when you move up and when you leave. Tap \"Not a rank wait\" if it got it wrong. Prefer to time it yourself? Switch the rank timer to Manual and tap Start: Kerb works out which rank you're at. Kerb only sees ranks while it's on screen."),
      h('p', {}, 'Your log stays on this phone. Add Kerb to your home screen so the phone keeps it, and back it up from the Log now and then: the backup is a file you keep.'),
      h('button', { class: 'btn primary', 'data-test': 'firstrun-ok', onclick: A.firstRunOk }, 'Got it')));
}
