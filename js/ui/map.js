// The rank map (ADR 0011, spec docs/superpowers/specs/2026-11-14-kerb-map-design.md; ADR 0003: own canvas, bundled OSM,
// no tiles). Kerb view (120/200/320 m) or Area view (600 m), north up. mapscene.js decides what goes where; this file
// paints. Everything but you is drawn once into a cached base layer, so a GPS fix is a blit plus your car.
import {
  decodeStreets, decodeCtx, centreOf, kerbSpan, AREA_SPAN, RATIO, projector, slotPlan, scaleBarM, ownStreet, placeLabels,
  chevrons, edgeMarker, slotDims, queueHeading,
} from './mapscene.js';
import { DURATION } from './motion.js';

const KERB_W = [7, 7, 7, 7, 7, 5, 3, 5, 3]; // CSS px by road class: motorway … tertiary, residential, service, busway, pedestrian
const AREA_W = [2, 2, 1.75, 1.5, 1.5, 1, 0.7, 1, 0.7];
const FONT = '13px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const BOLD = `700 ${FONT}`;
const ACCURACY_SHOWN_M = 15;
const SLOT_MIN_PX = 6.5; // a slot shorter than this reads as noise under the kerb line

let streetsP = null, ctxP = null, CTX = null;
const own = new Map(); // stand id -> own street name
const bases = new Map(); // key -> base layer, most recent last (a small LRU)
let gen = 0, loops = 0;
let zoom = null; // {t0, id, from, to}: the Kerb/Area zoom in progress (flag a-map)

function tokens() {
  const css = getComputedStyle(document.documentElement), g = (v) => css.getPropertyValue(v).trim();
  return { surface: g('--surface'), road: g('--map-road'), water: g('--map-water'), green: g('--map-green'),
    building: g('--map-building'), line: g('--line'), ink: g('--ink'), inkDim: g('--ink-dim'), accent: g('--accent'),
    accentInk: g('--accent-ink') };
}

const inView = (b, v) => !(b[2] < v[0] || b[0] > v[2] || b[3] < v[1] || b[1] > v[3]);

function rrect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y); c.lineTo(x + w - r, y); c.arcTo(x + w, y, x + w, y + r, r); c.lineTo(x + w, y + h - r);
  c.arcTo(x + w, y + h, x + w - r, y + h, r); c.lineTo(x + r, y + h); c.arcTo(x, y + h, x, y + h - r, r);
  c.lineTo(x, y + r); c.arcTo(x, y, x + r, y, r); c.closePath();
}

function fillAreas(c, feats, view, P, colour) {
  c.fillStyle = colour;
  for (const f of feats) { // even-odd within one feature (its holes), never across features: a pitch inside a park stays green
    if (!inView(f.box, view)) continue;
    c.beginPath();
    for (const ring of f.rings) ring.forEach((p, i) => { const [x, y] = P(p); if (i) c.lineTo(x, y); else c.moveTo(x, y); });
    c.fill('evenodd');
  }
}

function path(c, pts, P) {
  c.beginPath();
  pts.forEach((p, i) => { const [x, y] = P(p); if (i) c.lineTo(x, y); else c.moveTo(x, y); });
}

/** The scene for one stand and view: what both the base layer and the overlay need. */
function sceneFor(stand, view, you, W, H) {
  const span = view === 'area' ? AREA_SPAN : kerbSpan(stand, you);
  const pr = projector(centreOf(stand), span, W, H);
  return { span, view, W, H, P: pr.P, scale: pr.scale, bbox: pr.view };
}

/** Everything except you, into the 2D context `c` (CSS px). Returns what it drew, for the data attributes. */
function drawBase(c, stand, sc, lines, T) {
  const { P, W, H, scale, span } = sc;
  const view = sc.bbox, kerb = sc.view === 'kerb';
  c.fillStyle = T.surface;
  c.fillRect(0, 0, W, H);
  c.lineCap = 'round';
  c.lineJoin = 'round';
  if (CTX) {
    fillAreas(c, CTX.water, view, P, T.water);
    fillAreas(c, CTX.green, view, P, T.green);
    if (kerb) fillAreas(c, CTX.buildings, view, P, T.building);
    c.strokeStyle = T.line; c.lineWidth = 1.5; c.setLineDash([6, 4]);
    for (const r of CTX.rail) if (inView(r.box, view)) { path(c, r.pts, P); c.stroke(); }
    c.setLineDash([]);
  }
  const visible = lines.filter((l) => inView(l.box, view));
  const widths = kerb ? KERB_W : AREA_W;
  c.strokeStyle = T.road; // solid, so streets read the same on every ground (ADR 0009)
  for (const l of visible) { c.lineWidth = widths[l.cls] || 1; path(c, l.pts, P); c.stroke(); }
  if (kerb) { // one-way chevrons cut into the wider roads, only where taxis are bound by the one-way
    c.strokeStyle = T.surface; c.lineWidth = 1.5;
    for (const l of visible) {
      if (!l.oneway || (widths[l.cls] || 0) < 5) continue;
      const px = l.pts.map(P);
      for (const ch of chevrons(l.oneway === 1 ? px : px.reverse(), 48)) {
        c.save(); c.translate(ch.x, ch.y); c.rotate(ch.angle);
        c.beginPath(); c.moveTo(-1.5, -2.5); c.lineTo(1.5, 0); c.lineTo(-1.5, 2.5); c.stroke();
        c.restore();
      }
    }
  }
  const line = stand.line && stand.line.length > 1 ? stand.line : [stand.head, stand.head];
  const bandW = Math.max(8, 2 * (stand.uncertainty_m || 0) * scale);
  const lp = line.map(P);
  const pad = bandW / 2;
  const band = [Math.min(...lp.map((p) => p[0])) - pad, Math.min(...lp.map((p) => p[1])) - pad,
    Math.max(...lp.map((p) => p[0])) + pad, Math.max(...lp.map((p) => p[1])) + pad];
  const kerbLine = { pts: lp, pad: 8 }; // the kerb line, its slots and the head dot (r 7)
  c.font = FONT;
  const name = own.has(stand.id) ? own.get(stand.id) : own.set(stand.id, ownStreet(lines, stand)).get(stand.id);
  const m = scaleBarM(span), len = m * scale;
  const reserved = [[W - 72, 0, W, 56], [6, 6, 44, 30], [6, H - 32, 60 + len, H]]; // the Area button, N ↑, the scale bar
  const labels = placeLabels(visible, P, W, H, { own: name, band, kerb: kerbLine, reserved, max: kerb ? 6 : 4, majorOnly: !kerb,
    measure: (t) => { c.font = t === name ? BOLD : FONT; return c.measureText(t).width; } });
  c.textAlign = 'center'; c.textBaseline = 'middle'; c.lineWidth = 3; c.strokeStyle = T.surface;
  for (const l of labels) {
    c.save(); c.translate(l.x, l.y); c.rotate(l.angle);
    c.font = l.own ? BOLD : FONT; c.fillStyle = l.own ? T.ink : T.inkDim;
    c.strokeText(l.text, 0, 0); c.fillText(l.text, 0, 0);
    c.restore();
  }
  c.strokeStyle = T.accent; c.globalAlpha = 0.22; c.lineWidth = bandW; // the uncertainty band, at its true width
  path(c, line, P); c.stroke();
  c.globalAlpha = 1;
  const planned = kerb ? slotPlan(stand) : null;
  const dims = planned ? slotDims(planned, scale) : null;
  const plan = dims && dims.h >= SLOT_MIN_PX ? planned : null; // too small to read (the 320 m step): the line instead
  if (plan) { // ADR 0012 §3: the slots are the kerb (no line through them) and the filled head slot is the head (no dot)
    const { w, h } = dims;
    plan.slots.forEach((s, i) => {
      const [x, y] = P(s.c);
      c.save(); c.translate(x, y); c.rotate((s.angle * Math.PI) / 180); // the slot's front points to the head
      rrect(c, -w / 2, -h / 2, w, h, Math.min(2, w / 3));
      if (i === plan.headIdx) {
        c.fillStyle = T.accent; c.fill();
        if (plan.chevron) {
          c.strokeStyle = T.accentInk; c.lineWidth = 1.5;
          const a = Math.min(w * 0.3, h * 0.2);
          c.beginPath(); c.moveTo(-a, a * 0.6); c.lineTo(0, -a * 0.6); c.lineTo(a, a * 0.6); c.stroke();
        }
      } else { // the outline inside the slot, so the gap between slots stays clear
        c.fillStyle = T.surface; c.fill();
        rrect(c, -w / 2 + 0.75, -h / 2 + 0.75, w - 1.5, h - 1.5, Math.max(0, Math.min(2, w / 3) - 0.75));
        c.strokeStyle = T.accent; c.lineWidth = 1.5; c.stroke();
      }
      c.restore();
    });
  } else {
    c.lineWidth = kerb ? 2 : 4;
    path(c, line, P); c.stroke();
    const [hx, hy] = P(stand.head); // the head: an ink dot in a ring of ground
    c.fillStyle = T.surface; c.beginPath(); c.arc(hx, hy, 7, 0, 2 * Math.PI); c.fill();
    c.fillStyle = T.ink; c.beginPath(); c.arc(hx, hy, 5, 0, 2 * Math.PI); c.fill();
  }
  c.font = FONT; c.fillStyle = T.inkDim; c.textAlign = 'left'; c.textBaseline = 'alphabetic'; // north and the scale
  c.fillText('N ↑', 12, 22);
  const y0 = H - 14;
  c.strokeStyle = T.inkDim; c.lineWidth = 2; c.lineCap = 'butt';
  c.beginPath(); c.moveTo(12, y0 - 5); c.lineTo(12, y0); c.lineTo(12 + len, y0); c.lineTo(12 + len, y0 - 5); c.stroke();
  c.fillText(`${m} m`, 18 + len, y0);
  return { slots: plan ? plan.slots.length : 0, labels: labels.map((l) => l.text) };
}

/** The taxi badge (ADR 0012): an upright front-view taxi in a disc. It is symmetric and never turns, so it claims no
 * direction; it shows where you are when Kerb doesn't know which way you face. */
function badge(c, x, y, r, T) {
  const k = r / 13;
  c.save(); c.translate(x, y); c.scale(k, k);
  c.beginPath(); c.arc(0, 0, 13, 0, 2 * Math.PI);
  c.strokeStyle = T.surface; c.lineWidth = 4 / k; c.stroke(); // a 2 px ground outline
  c.fillStyle = T.ink; c.fill();
  c.fillStyle = T.surface;
  rrect(c, -5, -6, 10, 5, 1.5); c.fill(); // cabin
  rrect(c, -7, -1.5, 14, 7, 2); c.fill(); // body
  c.fillStyle = T.ink;
  c.beginPath(); c.arc(-4.5, 2, 1.3, 0, 2 * Math.PI); c.arc(4.5, 2, 1.3, 0, 2 * Math.PI); c.fill(); // headlights
  c.fillStyle = T.accent; c.fillRect(-3, -9.5, 6, 3); // the roof sign
  c.restore();
}

/** You: your car turned to your heading; the taxi badge when there is no heading; the badge at the edge, with a pointer,
 * when you are off the map. Nothing without a fix. */
function drawYou(c, sc, fix, heading, T) {
  if (!fix) return { you: 'none', xy: null };
  const [x, y] = sc.P([fix.lon, fix.lat]);
  const edge = edgeMarker(sc.W, sc.H, [x, y], 16, [[sc.W - 84, 0, sc.W, 68], [0, 0, 56, 42], // the Area button, north,
    [0, sc.H - 40, 12 + scaleBarM(sc.span) * sc.scale + 52, sc.H]]); // and the scale bar
  c.lineJoin = 'round';
  if (edge) {
    c.save(); c.translate(edge.x, edge.y); c.rotate(edge.angle); // only the pointer turns
    c.beginPath(); c.moveTo(17, 0); c.lineTo(10, -4.5); c.lineTo(10, 4.5); c.closePath();
    c.strokeStyle = T.surface; c.lineWidth = 2; c.stroke(); c.fillStyle = T.ink; c.fill();
    c.restore();
    badge(c, edge.x, edge.y, 11, T);
    return { you: 'edge', xy: [edge.x, edge.y] };
  }
  if (fix.accuracy > ACCURACY_SHOWN_M) {
    c.fillStyle = T.ink; c.globalAlpha = 0.12;
    c.beginPath(); c.arc(x, y, fix.accuracy * sc.scale, 0, 2 * Math.PI); c.fill();
    c.globalAlpha = 1;
  }
  if (heading == null) { badge(c, x, y, 13, T); return { you: 'badge', xy: [x, y] }; }
  c.save(); c.translate(x, y); c.rotate((heading * Math.PI) / 180); // your car: front up, then turned to your heading
  rrect(c, -8, -15, 16, 30, 5);
  c.strokeStyle = T.surface; c.lineWidth = 4; c.stroke(); // a 2 px ground outline outside the body
  c.fillStyle = T.ink; c.fill();
  const quad = (q) => { c.beginPath(); q.forEach(([a, b], i) => (i ? c.lineTo(a, b) : c.moveTo(a, b))); c.closePath(); c.fill(); };
  c.fillStyle = T.surface;
  quad([[-6.3, -8.7], [6.3, -8.7], [5.2, -4.6], [-5.2, -4.6]]); // windscreen, at the front
  quad([[-5.2, 8.1], [5.2, 8.1], [6.3, 11], [-6.3, 11]]); // rear window
  c.fillStyle = T.accent; c.fillRect(-5, -1.5, 10, 4); // the roof sign: your one amber (ADR 0009)
  c.restore();
  return { you: 'car', xy: [x, y] };
}

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// cubic-bezier(0.2, 0, 0, 1), the --ease-in token
function ease(x) {
  const bx = (t) => 3 * (1 - t) * (1 - t) * t * 0.2 + t * t * t, by = (t) => 3 * (1 - t) * t * t + t * t * t;
  let lo = 0, hi = 1;
  for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (bx(m) < x) lo = m; else hi = m; }
  return by((lo + hi) / 2);
}

function baseFor(stand, sc, lines, T, dpr) {
  const key = [stand.id, sc.span, sc.W.toFixed(1), dpr, !!CTX, T.surface, T.ink, T.accent].join('|');
  let b = bases.get(key);
  if (b) { bases.delete(key); bases.set(key, b); return b; }
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(sc.W * dpr); canvas.height = Math.round(sc.H * dpr);
  const c = canvas.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  const t0 = performance.now();
  const drew = drawBase(c, stand, sc, lines, T);
  b = { canvas, span: sc.span, ms: performance.now() - t0, ...drew };
  bases.set(key, b);
  while (bases.size > 8) bases.delete(bases.keys().next().value);
  return b;
}

function blit(c, b, k, alpha) {
  const w = c.canvas.width, h = c.canvas.height;
  c.save(); c.globalAlpha = alpha; c.setTransform(k, 0, 0, k, (w * (1 - k)) / 2, (h * (1 - k)) / 2);
  c.drawImage(b.canvas, 0, 0, w, h);
  c.restore();
}

/** Draw the map on the detail screen's canvas: data loaded once, base layer cached, the zoom continued across renders. */
export async function drawDetailMap(root, S) {
  const canvas = root.querySelector('canvas[data-test=map]');
  if (!canvas) return;
  const my = ++gen;
  streetsP = streetsP || fetch(new URL('../../data/streets.json', import.meta.url)).then((r) => r.json()).then(decodeStreets);
  ctxP = ctxP || fetch(new URL('../../data/mapctx.json', import.meta.url)).then((r) => r.json()).then(decodeCtx)
    .then((c) => { CTX = c; return c; }, () => null);
  const lines = await streetsP;
  if (!canvas.isConnected || my !== gen) return;
  paint(canvas, S, lines, my);
  if (!CTX) ctxP.then((c) => { if (c && canvas.isConnected && my === gen) paint(canvas, S, lines, my); });
}

function paint(canvas, S, lines, my) {
  const stand = S.byId[canvas.dataset.stand];
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const W = canvas.clientWidth || 328, H = W / RATIO;
  if (canvas.width !== Math.round(W * dpr)) canvas.width = Math.round(W * dpr);
  if (canvas.height !== Math.round(H * dpr)) canvas.height = Math.round(H * dpr);
  const T = tokens();
  const you = S.fix ? [S.fix.lon, S.fix.lat] : null;
  const view = S.mapView === 'area' ? 'area' : 'kerb';
  const sc = sceneFor(stand, view, you, W, H);
  const b = baseFor(stand, sc, lines, T, dpr);
  const c = canvas.getContext('2d');
  const d = canvas.dataset;
  Object.assign(d, { view, span: String(sc.span), slots: String(b.slots), labels: b.labels.join('|'), ctx: CTX ? '1' : '0',
    drawMs: b.ms.toFixed(1) });
  const finish = () => {
    c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1;
    c.drawImage(b.canvas, 0, 0);
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const gps = S.heading ? S.heading.heading : null;
    const queued = gps == null && S.logger && S.logger.mode === 'waiting' && S.logger.stand === stand.id && !S.logger.departAt
      ? queueHeading(stand) : null; // queued here: you face the way cabs face at this rank (ADR 0012)
    const y = drawYou(c, sc, S.fix, gps != null ? gps : queued, T);
    d.you = y.you;
    if (y.you === 'car') d.headingSrc = gps != null ? 'gps' : 'rank'; else delete d.headingSrc;
    if (y.xy) d.youXy = `${y.xy[0].toFixed(1)},${y.xy[1].toFixed(1)}`; else delete d.youXy;
    delete d.zooming;
    d.drawn = '1';
  };
  const t0 = S.motion && S.motion['a-map'];
  if (t0 === undefined || reduced()) { zoom = null; finish(); return; }
  if (!zoom || zoom.t0 !== t0 || zoom.id !== stand.id) {
    const from = zoom && zoom.id === stand.id ? zoom.to : null;
    const other = sceneFor(stand, view === 'area' ? 'kerb' : 'area', you, W, H);
    zoom = { t0, id: stand.id, from: from && from.span !== b.span ? from : baseFor(stand, other, lines, T, dpr), to: b };
  }
  zoom.to = b;
  const z = zoom, loop = ++loops;
  z.loop = loop; // one frame loop per zoom: a repaint (a fix, the context arriving) takes over from the last one
  d.zooming = '1';
  const frame = () => {
    if (!canvas.isConnected || my !== gen || zoom !== z || z.loop !== loop) return;
    const x = Math.min(1, (performance.now() - z.t0) / DURATION['a-map']);
    if (x >= 1) { finish(); return; }
    const e = ease(x), span = z.from.span * (z.to.span / z.from.span) ** e; // geometric: the zoom feels even
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = T.surface; c.fillRect(0, 0, canvas.width, canvas.height);
    blit(c, z.from, z.from.span / span, 1);
    blit(c, z.to, z.to.span / span, Math.max(0, Math.min(1, (e - 0.5) * 2))); // cross-fade in the second half
    requestAnimationFrame(frame);
  };
  frame();
}
