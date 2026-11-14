// Detail map (spec §8, ADR 0003): nearby streets from the bundled OSM data, the stand's kerb line, its
// uncertainty band and head, and the driver if in view. North up, 300 m either side of the stand. No tiles.
import { midpoint } from '../engine/geo.js';

const KY = 110574;
const HALF_M = 300;
const WIDTH = [4, 4, 3.5, 3, 3, 2, 1.4, 1.4, 1.4]; // by road class (motorway … pedestrian), in canvas px at 640 wide
let linesP = null;

function decode(json) {
  return json.lines.map((enc) => {
    const pts = [];
    let x = enc[1], y = enc[2];
    pts.push([x / 1e5, y / 1e5]);
    for (let i = 3; i < enc.length; i += 2) { x += enc[i]; y += enc[i + 1]; pts.push([x / 1e5, y / 1e5]); }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [a, b] of pts) { minX = Math.min(minX, a); maxX = Math.max(maxX, a); minY = Math.min(minY, b); maxY = Math.max(maxY, b); }
    return { cls: enc[0], pts, box: [minX, minY, maxX, maxY] };
  });
}

export function drawMap(canvas, { lines, stand, you }) {
  const css = getComputedStyle(document.documentElement);
  const col = (v) => css.getPropertyValue(v).trim();
  const W = canvas.width, H = canvas.height, ctx = canvas.getContext('2d');
  const c = stand.line ? midpoint(stand.line) : stand.head;
  const kx = 111320 * Math.cos((c[1] * Math.PI) / 180);
  const scale = W / (2 * HALF_M);
  const P = ([lon, lat]) => [W / 2 + (lon - c[0]) * kx * scale, H / 2 - (lat - c[1]) * KY * scale];
  const dLon = (W / 2 / scale) / kx, dLat = (H / 2 / scale) / KY;
  const view = [c[0] - dLon, c[1] - dLat, c[0] + dLon, c[1] + dLat];
  ctx.fillStyle = col('--surface');
  ctx.fillRect(0, 0, W, H);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = col('--map-road'); // solid, so streets read the same on every ground (ADR 0009)
  for (const l of lines) {
    const b = l.box;
    if (b[2] < view[0] || b[0] > view[2] || b[3] < view[1] || b[1] > view[3]) continue;
    ctx.lineWidth = WIDTH[l.cls] || 1.4;
    ctx.beginPath();
    l.pts.forEach((p, i) => { const [x, y] = P(p); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
    ctx.stroke();
  }
  const line = stand.line && stand.line.length > 1 ? stand.line : [stand.head, stand.head];
  const path = () => { ctx.beginPath(); line.forEach((p, i) => { const [x, y] = P(p); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }); };
  if (stand.uncertainty_m) {
    ctx.strokeStyle = col('--accent');
    ctx.globalAlpha = 0.22;
    ctx.lineWidth = Math.max(8, 2 * stand.uncertainty_m * scale);
    path(); ctx.stroke();
    ctx.globalAlpha = 1;
  }
  ctx.strokeStyle = col('--accent');
  ctx.lineWidth = 8;
  path(); ctx.stroke();
  const [hx, hy] = P(stand.head);
  ctx.fillStyle = col('--surface'); // the head: an ink dot in a ring of ground, so it sits clear of the kerb line
  ctx.beginPath(); ctx.arc(hx, hy, 11, 0, 2 * Math.PI); ctx.fill();
  ctx.fillStyle = col('--ink');
  ctx.beginPath(); ctx.arc(hx, hy, 8, 0, 2 * Math.PI); ctx.fill();
  if (you) {
    const [yx, yy] = P(you);
    if (yx > 0 && yx < W && yy > 0 && yy < H) {
      ctx.strokeStyle = col('--ink'); ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(yx, yy, 11, 0, 2 * Math.PI); ctx.stroke();
    }
  }
  ctx.fillStyle = col('--ink-dim');
  ctx.font = '26px system-ui, sans-serif'; // about 14 CSS px on a 360 px phone
  ctx.textAlign = 'right';
  ctx.fillText('© OpenStreetMap contributors', W - 16, H - 16);
  ctx.textAlign = 'left';
  ctx.fillText('N ↑  ·  head of stand ●', 16, 36);
}

/** Draw the map on the detail screen's canvas, loading streets.json once. */
export async function drawDetailMap(root, S) {
  const canvas = root.querySelector('canvas[data-test=map]');
  if (!canvas) return;
  linesP = linesP || fetch(new URL('../../data/streets.json', import.meta.url)).then((r) => r.json()).then(decode);
  const lines = await linesP;
  if (!canvas.isConnected) return;
  drawMap(canvas, { lines, stand: S.byId[canvas.dataset.stand], you: S.fix ? [S.fix.lon, S.fix.lat] : null });
  canvas.dataset.drawn = '1';
}
