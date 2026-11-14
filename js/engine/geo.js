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
