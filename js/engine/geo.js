// Small geometry helpers on [lon, lat] points (local equirectangular; fine at city scale).
const KY = 110574;
const kx = (lat) => 111320 * Math.cos((lat * Math.PI) / 180);

export function distM(a, b) {
  const dx = (a[0] - b[0]) * kx((a[1] + b[1]) / 2), dy = (a[1] - b[1]) * KY;
  return Math.hypot(dx, dy);
}

/** Nearest point on a polyline: {distM, point}. */
export function nearestOnLine(p, line) {
  if (line.length === 1) return { distM: distM(p, line[0]), point: line[0] };
  const k = kx(p[1]);
  let best = { distM: Infinity, point: line[0] };
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i];
    const ax = (a[0] - p[0]) * k, ay = (a[1] - p[1]) * KY, bx = (b[0] - p[0]) * k, by = (b[1] - p[1]) * KY;
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    const t = L2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2)) : 0;
    const x = ax + t * dx, y = ay + t * dy, d = Math.hypot(x, y);
    if (d < best.distM) best = { distM: d, point: [p[0] + x / k, p[1] + y / KY] };
  }
  return best;
}

/** Point halfway along a polyline. */
export function midpoint(line) {
  if (line.length === 1) return line[0];
  let total = 0;
  for (let i = 1; i < line.length; i++) total += distM(line[i - 1], line[i]);
  let half = total / 2;
  for (let i = 1; i < line.length; i++) {
    const s = distM(line[i - 1], line[i]);
    if (half <= s) {
      const t = s ? half / s : 0;
      return [line[i - 1][0] + t * (line[i][0] - line[i - 1][0]), line[i - 1][1] + t * (line[i][1] - line[i - 1][1])];
    }
    half -= s;
  }
  return line[line.length - 1];
}

export function bearingDeg(a, b) {
  const dx = (b[0] - a[0]) * kx((a[1] + b[1]) / 2), dy = (b[1] - a[1]) * KY;
  return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
}

const POINTS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
export const cardinal = (deg) => POINTS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

// ---- Queue geometry (ADR 0005): a rank queue lies along the kerb line, head first, and may extend behind the tail.

/** The kerb line ordered from the head of the stand (first cab) to the tail. */
export function headFirst(line, head) {
  if (line.length < 2 || distM(head, line[0]) <= distM(head, line[line.length - 1])) return line;
  return [...line].reverse();
}

/** Position of p along a head-first line: s = metres from the head (negative past the head, > L behind the tail),
 *  lateral = distance from the line, with the end segments extended so a queue behind the tail still projects. */
export function alongLine(p, line) {
  if (line.length < 2) return { s: 0, lateral: distM(p, line[0]), L: 0 };
  const k = kx(p[1]);
  const xy = line.map((q) => [(q[0] - p[0]) * k, (q[1] - p[1]) * KY]);
  let best = null, cum = 0;
  const lens = [];
  for (let i = 1; i < xy.length; i++) lens.push(Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]));
  const L = lens.reduce((a, b) => a + b, 0);
  for (let i = 1; i < xy.length; i++) {
    const [ax, ay] = xy[i - 1], [bx, by] = xy[i], len = lens[i - 1];
    const dx = bx - ax, dy = by - ay;
    let t = len ? -(ax * dx + ay * dy) / (len * len) : 0;
    if (i > 1) t = Math.max(t, 0);
    if (i < xy.length - 1) t = Math.min(t, 1);
    const lat = Math.hypot(ax + t * dx, ay + t * dy);
    if (!best || lat < best.lateral) best = { s: cum + t * len, lateral: lat, L };
    cum += len;
  }
  return best;
}

/** Is p in the stand's queue zone? Within zone_lateral_m + min(uncertainty, 15) of the line, from zone_head_margin_m
 *  past the head to zone_tail_factor x the stand's length (at least 20 m) behind the tail. */
export function queueZone(p, stand, P) {
  const a = alongLine(p, headFirst(stand.line, stand.head));
  const lateralMax = P.zone_lateral_m + Math.min(stand.uncertainty_m || 0, 15);
  const tail = a.L + P.zone_tail_factor * Math.max(a.L, 20);
  return { ...a, in: a.lateral <= lateralMax && a.s >= -P.zone_head_margin_m && a.s <= tail };
}

/** Direction cabs move in the queue: from the tail towards the head, in degrees. */
export const queueBearing = (lineHF) => (lineHF.length < 2 ? null : bearingDeg(lineHF[lineHF.length - 1], lineHF[0]));
