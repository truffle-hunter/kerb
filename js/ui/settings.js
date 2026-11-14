// Settings (spec §8) and attribution.
import { h, iconButton } from './dom.js';
import { wakeSupported } from '../platform/wake.js';

const opt = (value, label, current) => h('option', { value, selected: value === current }, label);

export function settings(S, A, parts) {
  const st = S.settings;
  return [
    h('header', { class: 'top' }, iconButton('back', 'Back', A.back, 'nav-back'), h('span', { class: 'clock' }, parts.time)),
    h('main', { class: 'sheet', 'data-test': 'settings' },
      h('h2', {}, 'Settings'),
      h('label', {}, 'Navigation app for Go',
        h('select', { 'data-test': 'set-nav', onchange: (e) => A.setSetting('nav', e.target.value) },
          opt('google', 'Google Maps', st.nav), opt('apple', 'Apple Maps', st.nav), opt('waze', 'Waze', st.nav), opt('geo', "Phone's default map app", st.nav))),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', 'data-test': 'set-permit', checked: st.permit, onchange: (e) => A.setSetting('permit', e.target.checked) }),
        'I hold a daa permit (show Dublin Airport ranks)'),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', 'data-test': 'set-autolog', checked: st.autoLog !== false, onchange: (e) => A.setSetting('autoLog', e.target.checked) }),
        'Log rank waits automatically (after 2 minutes at a rank, while Kerb is on screen; same as the Auto / Manual switch)'),
      h('label', {}, 'Theme',
        h('select', { 'data-test': 'set-theme', onchange: (e) => A.setSetting('theme', e.target.value) },
          opt('auto', 'Automatic (dark after sunset)', st.theme), opt('dark', 'Night', st.theme), opt('light', 'Day / low sun', st.theme))),
      h('label', { class: 'check' }, h('input', { type: 'checkbox', 'data-test': 'set-awake', checked: st.keepAwake, disabled: !wakeSupported(), onchange: (e) => A.setSetting('keepAwake', e.target.checked) }),
        wakeSupported() ? 'Keep the screen on while on shift' : "Keeping the screen on isn't supported on this browser"),
      h('label', {}, 'Live trains and trams relay (optional, empty = off)',
        h('input', { type: 'url', 'data-test': 'set-relay', value: st.relay || '', placeholder: 'https://…', onchange: (e) => A.setSetting('relay', e.target.value.trim()) })),
      h('h3', {}, 'Phone check'),
      h('p', {}, 'Check this phone is ready for a shift: installed, works with no signal, location sharp enough to tell ranks apart.'),
      h('button', { class: 'btn', 'data-test': 'set-phonecheck', onclick: A.openCheck }, 'Check this phone'),
      h('p', { class: 'note', 'data-test': 'device-code' },
        `Device code: ${String(S.device || '').slice(0, 8)}. It labels your backups.`),
      h('h3', {}, 'About the estimates'),
      h('p', {}, "Kerb shows where demand is likely, never how long you'll wait: no one has measured waits at Dublin ranks yet. Every weight is a guess until drivers log real waits."),
      h('h3', {}, 'Data'),
      h('ul', {},
        h('li', {}, 'Stands: Dublin City Council Taxi Bye-Laws 2015 (all four schedules); S.I. 546/2002 for the counties (status unconfirmed).'),
        h('li', {}, 'Map and road network: © OpenStreetMap contributors, ODbL. The derived road graph is available on request.'),
        h('li', {}, 'Timetables: Transport for Ireland GTFS (CC BY 4.0). Ferries: Dublin Port slot times 2026.'),
        h('li', {}, 'Rain: Met Éireann forecast (CC BY 4.0).'),
        h('li', {}, 'Pubs and nightclubs: Tailte Éireann valuation list (CC BY). Hotel rooms: Fáilte Ireland register (CC BY).'),
        h('li', {}, `Data bundle ${S.data.meta.bundle_version}, built ${S.data.meta.built_at}; events list updated ${S.data.meta.events.updated}.`))),
  ];
}
