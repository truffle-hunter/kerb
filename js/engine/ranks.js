// Ranks browser (ADR 0008): every stand, nearest first, with a forgiving filter on name, street and place.
import { distM } from './geo.js';

/** Lower case, no accents, apostrophes or full stops: "St. Stephen's" and "st stephens" compare equal. */
export const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/['’.]/g, '').replace(/[^a-z0-9#]+/g, ' ').trim();

/** Every word of the query appears in the stand's name, street or locality (an empty query matches all).
 * Non-council ranks keep a research note in `street`, so only their name and locality are searched. */
export const streetOf = (stand) => (stand.kind === 'noncouncil' ? '' : stand.street || '');
export function matches(stand, query) {
  const hay = norm(`${stand.name} ${streetOf(stand)} ${stand.locality || ''}`);
  return norm(query).split(' ').filter(Boolean).every((w) => hay.includes(w));
}

/**
 * Rows {stand, km, approx}, nearest first: road distance where the routing worker has one (recommendable stands),
 * otherwise straight line × 1.3 marked approximate, and stands not on the map last.
 */
export function sortStands(stands, kmById, from) {
  return stands.map((s) => {
    const road = kmById && kmById[s.id];
    if (road) return { stand: s, km: road.km, approx: !!road.approx };
    if (s.head && from) return { stand: s, km: (distM(from, s.head) * 1.3) / 1000, approx: true };
    return { stand: s, km: null, approx: false };
  }).sort((a, b) => (a.km === null) - (b.km === null) || (a.km ?? 0) - (b.km ?? 0) || a.stand.name.localeCompare(b.stand.name));
}
