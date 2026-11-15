// Rank detail (spec §8): status now, the law's words, how sure the placement is, overflow, disagreements, map.
import { h, iconButton, legalLine, fmtKm } from './dom.js';
import { status } from '../engine/legal.js';
import { navUrl } from '../platform/nav.js';
import { ownHistory, historyLine, fewLine } from '../engine/history.js';
import { caption, ariaLabel } from './mapscene.js';

const MONTHS = 'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ');
const LICENCE = { 'CC-BY-SA-4.0': 'CC BY-SA 4.0', 'etalab-2.0': 'Licence Ouverte 2.0' };

/** The street photo (ADR 0012): reviewed, bundled, credited; or one line saying there is none. A photo that can't load
 * (offline and never cached) becomes that line. */
const failed = new Set(); // photos that couldn't load (offline, never cached): shown as the no-photo line until back online
if (typeof addEventListener === 'function') addEventListener('online', () => failed.clear());

function photo(S, s, id) {
  const none = () => h('p', { class: 'note', 'data-test': 'detail-nophoto' }, 'No open street photo of this kerb yet.');
  const e = S.photos && S.photos[id];
  if (!e || failed.has(e.f)) return none(); // a failed photo stays gone across renders: no jump on every GPS fix
  const when = `${MONTHS[Number(e.date.slice(5, 7)) - 1]} ${e.date.slice(0, 4)}`;
  const loose = s.uncertainty_m == null || s.uncertainty_m > 10; // a sign in view may be a neighbouring rank's
  const line = e.verdict === 'A'
    ? `Street photo · ${when} · from ${e.dist_m} m. ${loose ? 'Shows a rank sign or markings nearby.' : "Shows the rank's sign or markings."} Checked by an AI, not a person; the street may have changed.`
    : `Street photo · ${when} · from ${e.dist_m} m. Shows this street; no rank sign in view. Checked by an AI, not a person.`;
  const link = (href, text) => h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, text);
  return h('figure', { class: 'photo', 'data-test': 'detail-photo' },
    h('img', { src: `photos/${e.f}`, width: 720, height: 445, loading: 'lazy', alt: `Street photo of ${s.street || s.name} near the rank`,
      onerror: (ev) => { failed.add(e.f); const f = ev.target.closest('figure'); if (f) f.replaceWith(none()); } }),
    h('figcaption', {},
      h('p', { class: 'note', 'data-test': 'photo-line' }, line),
      h('p', { class: 'note', 'data-test': 'photo-credit' }, 'Photo: ', link(e.src, e.by), ', ', link(e.lic_url, LICENCE[e.lic] || e.lic),
        `, via Panoramax${e.ign ? ' (IGN)' : ''}. ${e.kind === 'crop' ? 'Cropped from a 360° photo.' : 'Resized.'}`)));
}

const TIER = { A: 'placed from an exact open-data anchor', B: 'placed from an approximate anchor', C: 'approximate: the anchor is not in open data' };

/** The driver's own past waits here (ADR 0008): the summary from 3 confirmed waits, the waits themselves below. */
function ownLine(S, id) {
  const hh = ownHistory(S.waits, id, S.now);
  const line = historyLine(hh) || fewLine(hh);
  return line ? h('p', { class: 'hist', 'data-test': 'detail-history' }, line) : null;
}

export function detail(S, A, id, parts) {
  const s = S.byId[id];
  const st = status(s, S.now, S.ctx);
  const km = S.km && S.km[id];
  const chain = (S.data.chains || []).find((c) => c.main === id || c.overflow.includes(id));
  const rules = (S.data.rules || []).filter((r) => r.stands.includes(id));
  const placement = s.tier
    ? `${TIER[s.tier] || 'not placed'} (tier ${s.tier}), ±${Math.round(s.uncertainty_m || 0)} m.`
    : s.kind === 'noncouncil' ? `Position from ${s.confidence || 'unverified'} source; owner: ${s.owner || 'unknown'}.` : 'Not placed on the map yet.';
  return [
    h('header', { class: 'top' }, iconButton('back', 'Back', A.back, 'nav-back'),
      h('span', { class: 'clock' }, `${parts.time}`)),
    h('main', { class: 'sheet', 'data-test': 'detail' },
      h('h2', {}, s.name),
      h('p', { 'data-test': 'detail-status' }, legalLine(st) === st.why ? `${st.why}.` : `${legalLine(st)}. ${st.why}.`),
      km ? h('p', {}, `${fmtKm(km.km, km.approx)} by road from you.`) : null,
      ownLine(S, id),
      s.access === 'daa_permit' ? h('p', { class: S.settings.permit ? '' : 'warn', 'data-test': 'detail-permit' }, S.settings.permit
        ? 'Airport rank: you hold a daa permit (Settings).' : 'Airport rank: only for drivers with a daa permit. Turn it on in Settings if you hold one.') : null,
      s.head ? h('div', { class: 'mapwrap' }, // ADR 0011: Kerb view by default; Area (600 m) by the toggle or a tap on the map
        h('canvas', { class: 'mapbox', 'data-test': 'map', 'data-stand': id, width: 640, height: 396, role: 'img', 'aria-label': ariaLabel(s),
          onclick: A.toggleMapView }),
        h('button', { class: 'maptoggle', type: 'button', 'data-test': 'map-toggle', 'aria-pressed': S.mapView === 'area' ? 'true' : 'false',
          onclick: A.toggleMapView }, 'Area')) : null,
      s.head ? h('p', { class: 'mapcaption', 'data-test': 'map-caption' }, caption(s)) : null,
      s.head ? h('a', { class: 'go', href: navUrl(S.settings.nav, s.head, s.name), target: '_blank', rel: 'noopener', 'data-test': 'detail-go' }, 'Navigate') : null,
      s.head ? photo(S, s, id) : null, // ADR 0012: under the map, after Navigate so Navigate stays in reach
      h('h3', {}, 'Where it is'),
      h('p', {}, placement),
      s.tier_reason ? h('p', { class: 'note' }, `How it was placed: ${s.tier_reason}`) : null,
      h('p', { class: 'warn' }, 'Not checked at the kerb.'),
      s.law ? [h('h3', {}, 'What the law says'),
        h('p', { class: 'law' }, s.law.limits),
        s.law.position ? h('p', { class: 'law' }, s.law.position) : null,
        h('p', {}, [s.capacity ? `${s.capacity} cabs. ` : '', s.law.hours_text || s.law.occasion_text || 'At all times.']),
        h('p', { class: 'note' }, s.law.instrument)] : null,
      s.facing_street && s.facing_street !== s.facing_law
        ? h('p', { class: 'warn' }, `Street imagery shows cabs facing ${s.facing_street}; the law says ${s.facing_law}.`) : null,
      chain ? [h('h3', {}, 'Overflow'), h('ul', {}, [chain.main, ...chain.overflow].map((cid) => {
        const cs = S.byId[cid];
        return h('li', {}, `${cid === chain.main ? 'Main' : 'Overflow'}: ${cs ? cs.name : cid} (${cs ? legalLine(status(cs, S.now, S.ctx)) : 'unknown'})`);
      }))] : null,
      rules.length || (s.notes || []).length ? [h('h3', {}, 'Known changes and notes'),
        h('ul', {}, [...rules.map((r) => h('li', {}, r.note)), ...(s.notes || []).map((n) => h('li', {}, n))])] : null,
      (s.disagreements || []).length ? [h('h3', {}, `Disagreements on record (${s.disagreements.length})`),
        h('ul', {}, s.disagreements.map((d) => h('li', {}, `${d.category.replace(/_/g, ' ')}: ${d.summary} (${d.status})`)))] : null,
      s.source ? h('p', { class: 'note' }, `Source: ${s.source}`) : null,
      h('p', { class: 'note' }, 'Map data © OpenStreetMap contributors (ODbL).')),
  ];
}
