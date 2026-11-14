// Taxi-aware road distance on the bundled OSM drive graph (spec §7.2, ADR 0003).
import { distM, midpoint } from './geo.js';

const CELL = 0.0025; // degrees (~280 m N-S, ~165 m E-W at Dublin)
const SNAP_MAX_M = 300;
const DETOUR = 1.3;
const key = (lon, lat) => `${Math.floor(lon / CELL)},${Math.floor(lat / CELL)}`;

/** Build a compressed adjacency graph from graph.json {nodes:[lonE5,latE5…], edges:[from,to,len,flags…]}. */
export function loadGraph(json) {
  const n = json.nodes.length / 2, m = json.edges.length / 4;
  const lon = new Float64Array(n), lat = new Float64Array(n);
  for (let i = 0; i < n; i++) { lon[i] = json.nodes[2 * i] / 1e5; lat[i] = json.nodes[2 * i + 1] / 1e5; }
  const start = new Int32Array(n + 1);
  for (let e = 0; e < m; e++) start[json.edges[4 * e] + 1]++;
  for (let i = 0; i < n; i++) start[i + 1] += start[i];
  const to = new Int32Array(m), len = new Float32Array(m), fill = start.slice(0, n);
  for (let e = 0; e < m; e++) {
    const f = json.edges[4 * e], slot = fill[f]++;
    to[slot] = json.edges[4 * e + 1];
    len[slot] = json.edges[4 * e + 2];
  }
  const grid = new Map();
  for (let i = 0; i < n; i++) {
    const k = key(lon[i], lat[i]);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  }
  return { n, lon, lat, start, to, len, grid };
}

/** Nearest graph node within ~2 cells: {node, distM}; node = -1 when none.
 *  With `dist`, only nodes reachable in that shortest-path tree count (skips car-park and service-road islands). */
export function snap(g, p, dist = null) {
  const cx = Math.floor(p[0] / CELL), cy = Math.floor(p[1] / CELL);
  let best = -1, bd = Infinity;
  for (let dx = -2; dx <= 2; dx++) {
    for (let dy = -2; dy <= 2; dy++) {
      for (const i of g.grid.get(`${cx + dx},${cy + dy}`) || []) {
        if (dist && !Number.isFinite(dist[i])) continue;
        const d = distM(p, [g.lon[i], g.lat[i]]);
        if (d < bd) { bd = d; best = i; }
      }
    }
  }
  return { node: best, distM: bd };
}

/** Single-source shortest paths in metres (binary heap). Infinity where unreachable. */
export function dijkstra(g, src) {
  const dist = new Float64Array(g.n).fill(Infinity);
  if (src < 0) return dist;
  const heapN = [], heapD = [];
  const push = (v, d) => {
    let i = heapN.length; heapN.push(v); heapD.push(d);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heapD[p] <= d) break;
      heapN[i] = heapN[p]; heapD[i] = heapD[p]; i = p;
    }
    heapN[i] = v; heapD[i] = d;
  };
  const pop = () => {
    const v = heapN[0], d = heapD[0], lv = heapN.pop(), ld = heapD.pop();
    if (heapN.length) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= heapN.length) break;
        if (c + 1 < heapN.length && heapD[c + 1] < heapD[c]) c++;
        if (heapD[c] >= ld) break;
        heapN[i] = heapN[c]; heapD[i] = heapD[c]; i = c;
      }
      heapN[i] = lv; heapD[i] = ld;
    }
    return [v, d];
  };
  dist[src] = 0;
  push(src, 0);
  while (heapN.length) {
    const [u, d] = pop();
    if (d > dist[u]) continue;
    for (let e = g.start[u]; e < g.start[u + 1]; e++) {
      const v = g.to[e], nd = d + g.len[e];
      if (nd < dist[v]) { dist[v] = nd; push(v, nd); }
    }
  }
  return dist;
}

/** Road km from `from` to the middle of a stand's kerb line; straight line x 1.3 (approx) when off-graph. */
export function standKm(g, dist, stand, from, startSnap = snap(g, from)) {
  const target = stand.line ? midpoint(stand.line) : stand.head;
  const t = snap(g, target, dist);
  const ok = startSnap.node >= 0 && startSnap.distM <= SNAP_MAX_M && t.node >= 0 && t.distM <= SNAP_MAX_M
    && Number.isFinite(dist[t.node]);
  if (!ok) return { km: (distM(from, stand.head || target) * DETOUR) / 1000, approx: true };
  return { km: (dist[t.node] + startSnap.distM + t.distM) / 1000, approx: false };
}
