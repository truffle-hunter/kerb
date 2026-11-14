// DOM helper, formatting and the offline sun-elevation theme rule (spec §9).
import { hhmm } from '../engine/time.js';

/** h('p', {class: 'x', 'data-test': 'y', onclick: fn}, 'text', child…) — text is always set as text, never HTML. */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

const ICONS = {
  log: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/></svg>',
  settings: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>',
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  stats: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 20V11M12 20V5M19 20v-6"/></svg>',
};
export function iconButton(name, label, onclick, test) {
  const b = h('button', { class: 'iconbtn', 'aria-label': label, title: label, onclick, 'data-test': test });
  b.innerHTML = ICONS[name]; // static SVG markup from this file only
  return b;
}

export const fmtKm = (km, approx) => `${approx ? '~' : ''}${km < 10 ? km.toFixed(1) : Math.round(km)} km`;

export function legalLine(st) {
  switch (st.state) {
    case 'open': return st.until ? `Legal till ${hhmm(st.until)}` : 'Open at all times';
    case 'event_active': return `Event stand, till ${hhmm(st.until)}`;
    case 'hours_unknown': return 'Hours not published';
    case 'closed': return st.until ? `Closed, opens ${hhmm(st.until)}` : 'Closed';
    case 'event_inactive': return 'Event stand, no event on';
    case 'event_unknown': return 'Event stand, event status unknown';
    case 'suspended': return 'Suspended';
    case 'unconfirmed': return 'Legal status unconfirmed';
    default: return st.why;
  }
}

export const minutesAgo = (from, to) => Math.max(0, Math.round((to - from) / 60000));

/** Solar elevation in degrees (NOAA low-precision formulas), used to pick the day or night theme offline. */
export function sunElevation(date, lat, lon) {
  const r = Math.PI / 180;
  const d = date.getTime() / 86400000 + 2440587.5 - 2451545.0;
  const g = (357.529 + 0.98560028 * d) % 360;
  const q = (280.459 + 0.98564736 * d) % 360;
  const L = q + 1.915 * Math.sin(g * r) + 0.020 * Math.sin(2 * g * r);
  const e = 23.439 - 0.00000036 * d;
  const ra = Math.atan2(Math.cos(e * r) * Math.sin(L * r), Math.cos(L * r)) / r;
  const dec = Math.asin(Math.sin(e * r) * Math.sin(L * r)) / r;
  const gmst = (18.697374558 + 24.06570982441908 * d) % 24;
  const ha = ((((gmst * 15 + lon - ra) % 360) + 540) % 360) - 180;
  return Math.asin(Math.sin(lat * r) * Math.sin(dec * r) + Math.cos(lat * r) * Math.cos(dec * r) * Math.cos(ha * r)) / r;
}
