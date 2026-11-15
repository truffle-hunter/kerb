// The rank map's scene (ADR 0011, spec docs/superpowers/specs/2026-11-14-kerb-map-design.md): what to draw and where,
// as pure functions; map.js only paints. Points are [lon, lat]; pixels are CSS px.
import { distM, nearestOnLine, midpoint, bearingDeg, headFirst, queueBearing } from '../engine/geo.js';

const KY = 110574;
const kx = (lat) => 111320 * Math.cos((lat * Math.PI) / 180);
export const RATIO = 1.618;
export const SPANS = [120, 200, 320]; // Kerb view, metres across
export const AREA_SPAN = 600;
const MARGIN = 0.45; // content within 90% of the frame
const YOU_NEAR_M = 130;
const SLOT_L = 4.4, SLOT_W = 1.9;

function boxOf(pts) {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const [x, y] of pts) { if (x < a) a = x; if (x > c) c = x; if (y < b) b = y; if (y > d) d = y; }
  return [a, b, c, d];
}

function deltas(enc, from) {
  const pts = [];
  let x = enc[from], y = enc[from + 1];
  pts.push([x / 1e5, y / 1e5]);
  for (let i = from + 2; i < enc.length; i += 2) { x += enc[i]; y += enc[i + 1]; pts.push([x / 1e5, y / 1e5]); }
  return pts;
}

/** streets.json v2: {names, lines: [[cls, oneway, nameIdx, x, y, dx, dy, …]]} at 1e-5 degrees. */
export function decodeStreets(json) {
  return json.lines.map((e) => {
    const pts = deltas(e, 3);
    return { cls: e[0], oneway: e[1], name: e[2] >= 0 ? json.names[e[2]] : null, pts, box: boxOf(pts) };
  });
}

/** mapctx.json: areas as lists of rings, rail as lines, all delta-encoded like streets. */
export function decodeCtx(json) {
  const area = (f) => { const rings = f.map((r) => deltas(r, 0)); return { rings, box: boxOf(rings.flat()) }; }; // every ring
  const line = (e) => { const pts = deltas(e, 0); return { pts, box: boxOf(pts) }; };
  return { water: (json.water || []).map(area), green: (json.green || []).map(area),
    buildings: (json.buildings || []).map(area), rail: (json.rail || []).map(line) };
}

/** Where the map is centred: halfway along the kerb line (or the head). */
export const centreOf = (s) => (s.line && s.line.length > 1 ? midpoint(s.line) : s.head);

/** Kerb view width: the smallest step that holds the line, its uncertainty band and, within 130 m of the kerb, you. */
export function kerbSpan(s, you) {
  const c = centreOf(s), k = kx(c[1]), band = s.uncertainty_m || 0;
  let dx = 0, dy = 0;
  const take = (p, pad) => { dx = Math.max(dx, Math.abs(p[0] - c[0]) * k + pad); dy = Math.max(dy, Math.abs(p[1] - c[1]) * KY + pad); };
  for (const p of s.line && s.line.length ? s.line : [s.head]) take(p, band);
  if (you && nearestOnLine(you, s.line && s.line.length ? s.line : [s.head]).distM <= YOU_NEAR_M) take(you, 0);
  return SPANS.find((w) => dx <= MARGIN * w && dy <= (MARGIN * w) / RATIO) || SPANS[SPANS.length - 1];
}

/** Lon/lat to pixels for a view `span` metres across, centred on `centre`, on a W x H canvas. */
export function projector(centre, span, W, H) {
  const k = kx(centre[1]), scale = W / span;
  const P = ([lon, lat]) => [W / 2 + (lon - centre[0]) * k * scale, H / 2 - (lat - centre[1]) * KY * scale];
  const dLon = W / 2 / scale / k, dLat = H / 2 / scale / KY;
  return { P, scale, view: [centre[0] - dLon, centre[1] - dLat, centre[0] + dLon, centre[1] + dLat] };
}

const COMPASS = { north: 0, northeast: 45, east: 90, southeast: 135, south: 180, southwest: 225, west: 270, northwest: 315 };
const plainFacing = (s) => { const f = (s.facing_law || '').toLowerCase().replace(/[-\s]/g, ''); return f in COMPASS ? f : null; };
const facingWord = (f) => f.replace(/^(north|south)(east|west)$/, '$1-$2');

/** Does the law's plain facing agree with the line run from tail to head? null when there is no plain facing or line. */
export function facingAgrees(s) {
  const f = plainFacing(s);
  if (!f || !s.line || s.line.length < 2) return null;
  const b = queueBearing(headFirst(s.line, s.head));
  return Math.abs(((b - COMPASS[f] + 540) % 360) - 180) <= 90;
}

/** One cab slot per legal space, true scale, from the head end; only where the placement and the law support it. */
export function slotPlan(s) {
  if (!['A', 'B'].includes(s.tier) || !(s.capacity >= 1) || !s.line || s.line.length < 2) return null;
  if (!/parallel/i.test((s.law && s.law.position) || '')) return null;
  const hf = headFirst(s.line, s.head);
  const segs = [];
  let L = 0;
  for (let i = 1; i < hf.length; i++) { const d = distM(hf[i - 1], hf[i]); segs.push([L, d, hf[i - 1], hf[i]]); L += d; }
  if (!L) return null;
  const pitch = L / s.capacity, len = Math.min(SLOT_L, 0.92 * pitch);
  const at = (m) => {
    const [s0, d, a, b] = segs.find(([s0, d]) => m <= s0 + d) || segs[segs.length - 1];
    const t = d ? (m - s0) / d : 0;
    return { c: [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])], angle: bearingDeg(b, a) }; // pointing to the head
  };
  const slots = Array.from({ length: s.capacity }, (_, i) => ({ ...at((i + 0.5) * pitch), len_m: len, w_m: SLOT_W }));
  return { slots, headIdx: 0, chevron: facingAgrees(s) !== false };
}

export const scaleBarM = (span) => (span >= 600 ? 100 : span >= 320 ? 50 : 20);

/** The stand's own street: the nearest named OSM street to the kerb line's midpoint, within 30 m. */
export function ownStreet(lines, s) {
  const c = centreOf(s), dLon = 30 / kx(c[1]), dLat = 30 / KY;
  let best = null, bd = 30;
  for (const l of lines) {
    if (!l.name || l.box[0] > c[0] + dLon || l.box[2] < c[0] - dLon || l.box[1] > c[1] + dLat || l.box[3] < c[1] - dLat) continue;
    const d = nearestOnLine(c, l.pts).distM;
    if (d <= bd) { bd = d; best = l.name; }
  }
  return best;
}

function clip(a, b, x0, y0, x1, y1) { // Liang–Barsky
  let t0 = 0, t1 = 1;
  const dx = b[0] - a[0], dy = b[1] - a[1];
  for (const [p, q] of [[-dx, a[0] - x0], [dx, x1 - a[0]], [-dy, a[1] - y0], [dy, y1 - a[1]]]) {
    if (p === 0) { if (q < 0) return null; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return null; if (r > t0) t0 = r; } else { if (r < t0) return null; if (r < t1) t1 = r; }
  }
  return [[a[0] + t0 * dx, a[1] + t0 * dy], [a[0] + t1 * dx, a[1] + t1 * dy]];
}

const LABEL_H = 16, PAD = 8, INSET = 4, STRAIGHT_PX = 4, BESIDE = 13; // BESIDE: half a label plus half a 7 px road, and a gap

/** One street is often several OSM ways: join pixel polylines that share an end (the same node), either way round. */
function joinParts(parts) {
  const same = (p, q) => Math.abs(p[0] - q[0]) < 0.01 && Math.abs(p[1] - q[1]) < 0.01;
  const left = parts.filter((p) => p.length > 1).map((p) => [...p]), out = [];
  while (left.length) {
    let cur = left.shift(), grew = true;
    while (grew) {
      grew = false;
      for (let i = 0; i < left.length; i++) {
        const p = left[i];
        if (same(p[0], cur[cur.length - 1])) cur = cur.concat(p.slice(1));
        else if (same(p[p.length - 1], cur[cur.length - 1])) cur = cur.concat([...p].reverse().slice(1));
        else if (same(p[p.length - 1], cur[0])) cur = p.slice(0, -1).concat(cur);
        else if (same(p[0], cur[0])) cur = [...p].reverse().slice(0, -1).concat(cur);
        else continue;
        left.splice(i, 1); grew = true; break;
      }
    }
    out.push(cur);
  }
  return out;
}

/** Split a pixel polyline into runs that stay within STRAIGHT_PX of their chord; each run is [start, end]. */
function straightRuns(pl) {
  const out = [];
  let i = 0;
  while (i < pl.length - 1) {
    let j = i + 1;
    while (j + 1 < pl.length && withinChord(pl, i, j + 1)) j++;
    out.push([pl[i], pl[j]]);
    i = j;
  }
  return out;
}

function withinChord(pl, i, j) {
  const [ax, ay] = pl[i], [bx, by] = pl[j], dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy);
  if (!L) return false;
  for (let k = i + 1; k < j; k++) if (Math.abs(dy * (pl[k][0] - ax) - dx * (pl[k][1] - ay)) / L > STRAIGHT_PX) return false;
  return true;
}
const hits = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

/** Points every `step` px along a pixel polyline (a single point stays itself). */
function samples(pts, step) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
    for (let k = 1; k <= n; k++) out.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n]);
  }
  return out;
}

/** Does a label centred at (x, y), turned by `angle`, come within its half-sizes (hu along, hv across) of a kerb point? */
function onKerb(pts, x, y, angle, hu, hv) {
  const c = Math.cos(angle), s = Math.sin(angle);
  return pts.some(([px, py]) => { const dx = px - x, dy = py - y; return Math.abs(dx * c + dy * s) <= hu && Math.abs(-dx * s + dy * c) <= hv; });
}

/** Street names on their longest straight in-view runs, upright, clear of each other. The own street comes first and
 * may sit on the translucent band (the stand is on that street, so the band often covers it) or beside its road, but
 * never on the kerb line (`kerb`: {pts in px, pad}, tested against the label's turned outline); every other name stays
 * clear of the band. Then major streets, then longer runs. */
export function placeLabels(lines, P, W, H, { own, band, kerb, reserved = [], measure, max, majorOnly }) {
  const kerbPts = kerb ? samples(kerb.pts, 3) : null;
  const byName = new Map(); // name -> {cls, polylines in px}
  for (const l of lines) {
    if (!l.name || (majorOnly && l.cls > 4 && l.name !== own)) continue;
    if (!byName.has(l.name)) byName.set(l.name, { cls: l.cls, parts: [] });
    const r = byName.get(l.name);
    r.cls = Math.min(r.cls, l.cls);
    r.parts.push(l.pts.map(P));
  }
  const runs = new Map();
  for (const [name, r] of byName) {
    const segs = [];
    for (const pl of joinParts(r.parts)) {
      for (const [a, b] of straightRuns(pl)) {
        const seg = clip(a, b, INSET, INSET, W - INSET, H - INSET);
        if (seg) segs.push({ seg, len: Math.hypot(seg[1][0] - seg[0][0], seg[1][1] - seg[0][1]) });
      }
    }
    if (segs.length) runs.set(name, { cls: r.cls, segs });
  }
  const order = [...runs.entries()].map(([name, r]) => ({ name, ...r, best: Math.max(...r.segs.map((x) => x.len)) }))
    .sort((a, b) => (b.name === own) - (a.name === own) || a.cls - b.cls || b.best - a.best);
  const placed = [], boxes = [...reserved]; // reserved: what sits over or on the map (the Area button, north, the scale)
  for (const r of order) {
    if (placed.length >= max) break;
    const tw = measure(r.name);
    const offsets = r.name === own ? [0, BESIDE, -BESIDE] : [0]; // the own street may sit beside its road, parallel
    const fit = () => {
      for (const off of offsets) {
        for (const { seg, len } of [...r.segs].sort((a, b) => b.len - a.len)) {
          if (len < tw + 2 * PAD) break;
          let angle = Math.atan2(seg[1][1] - seg[0][1], seg[1][0] - seg[0][0]);
          if (angle > Math.PI / 2) angle -= Math.PI; else if (angle < -Math.PI / 2) angle += Math.PI;
          const c = Math.abs(Math.cos(angle)), s = Math.abs(Math.sin(angle));
          const bw = (tw + 6) * c + LABEL_H * s, bh = (tw + 6) * s + LABEL_H * c;
          const nx = -Math.sin(angle) * off, ny = Math.cos(angle) * off;
          const lo = tw / 2 + PAD, hi = len - tw / 2 - PAD;
          for (let k = 0; Math.ceil(k / 2) * 24 <= len / 2 - lo; k++) { // from the middle of the run outwards, every 24 px
            const m = len / 2 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 24;
            if (m < lo || m > hi) continue;
            const t = m / len;
            const x = seg[0][0] + t * (seg[1][0] - seg[0][0]) + nx, y = seg[0][1] + t * (seg[1][1] - seg[0][1]) + ny;
            const bx = [x - bw / 2, y - bh / 2, x + bw / 2, y + bh / 2];
            if (bx[0] < INSET || bx[1] < INSET || bx[2] > W - INSET || bx[3] > H - INSET) continue;
            if (boxes.some((b) => hits(bx, b))) continue;
            if (r.name === own ? kerbPts && onKerb(kerbPts, x, y, angle, (tw + 6) / 2 + kerb.pad, LABEL_H / 2 + kerb.pad)
              : band && hits(bx, band)) continue;
            return { label: { text: r.name, x, y, angle, own: r.name === own }, bx };
          }
        }
      }
      return null;
    };
    const got = fit();
    if (got) { placed.push(got.label); boxes.push(got.bx); }
  }
  return placed;
}

/** Chevrons every `every` px along a pixel polyline, pointing the way of travel (the order of the points). */
export function chevrons(px, every = 48) {
  const out = [];
  let next = every / 2, walked = 0;
  for (let i = 1; i < px.length; i++) {
    const [ax, ay] = px[i - 1], [bx, by] = px[i], d = Math.hypot(bx - ax, by - ay);
    const angle = Math.atan2(by - ay, bx - ax);
    while (d && next <= walked + d) {
      const t = (next - walked) / d;
      out.push({ x: ax + t * (bx - ax), y: ay + t * (by - ay), angle });
      next += every;
    }
    walked += d;
  }
  return out;
}

/** Where to point at you from the edge when you are off the map (or hidden under `avoid`, the Area button): on the ray
 * from the centre, `inset` px inside the edge, slid along the edge out of `avoid`. null when you are in plain view. */
export function edgeMarker(W, H, you, inset = 10, avoid = null) {
  const [x, y] = you;
  const under = avoid && x >= avoid[0] && x <= avoid[2] && y >= avoid[1] && y <= avoid[3];
  if (x >= 0 && x <= W && y >= 0 && y <= H && !under) return null;
  const cx = W / 2, cy = H / 2, dx = x - cx, dy = y - cy;
  const t = Math.min(dx ? (dx > 0 ? W / 2 - inset : -(W / 2 - inset)) / dx : Infinity,
    dy ? (dy > 0 ? H / 2 - inset : -(H / 2 - inset)) / dy : Infinity);
  let mx = cx + Math.min(t, 1) * dx, my = cy + Math.min(t, 1) * dy;
  if (avoid && mx >= avoid[0] - 4 && mx <= avoid[2] + 4 && my >= avoid[1] - 4 && my <= avoid[3] + 4) {
    // slide out of the button the short way: left along the top, or down along the right side
    if (avoid[0] - 4 - inset >= 0 && (mx - (avoid[0] - 8)) <= (avoid[3] + 8 - my)) mx = avoid[0] - 8; else my = avoid[3] + 8;
  }
  return { x: mx, y: my, angle: Math.atan2(y - my, x - mx) };
}

const spaces = (n) => (n >= 1 ? `${n} ${n === 1 ? 'space' : 'spaces'}` : null);

/** The line under the map: the legend, in words (spec §4). */
export function caption(s) {
  const f = plainFacing(s), agree = facingAgrees(s);
  const facing = f && agree !== null ? `faces ${facingWord(f)}${agree ? '' : ', law unclear'}` : null;
  const where = s.tier ? `±${Math.round(s.uncertainty_m || 0)} m, not checked at the kerb` : 'Approximate position, not checked at the kerb';
  return [spaces(s.capacity), facing, where].filter(Boolean).join(' · ');
}

/** The canvas's text alternative. */
export function ariaLabel(s) {
  const f = plainFacing(s), agree = facingAgrees(s);
  const name = /\brank$/i.test(s.name) ? s.name : `${s.name} rank`;
  const parts = [spaces(s.capacity),
    f && agree !== null ? `cabs face ${facingWord(f)}${agree ? '' : ' (the law is unclear)'}` : null,
    s.tier ? `placed within ${Math.round(s.uncertainty_m || 0)} m` : 'approximate position', 'not checked at the kerb'];
  return `Map of ${name}: ${parts.filter(Boolean).join(', ')}.`;
}
