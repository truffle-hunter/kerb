// Runs routing off the main thread (spec §7.2). Messages: {type:'load', url} then {type:'distances', from, stands}.
import { loadGraph, snap, dijkstra, standKm } from './engine/route.js';

let graph = null;
self.onmessage = async (ev) => {
  const msg = ev.data;
  if (msg.type === 'load') {
    graph = loadGraph(await (await fetch(msg.url)).json());
    self.postMessage({ type: 'loaded' });
  } else if (msg.type === 'distances' && graph) {
    const s = snap(graph, msg.from);
    const dist = dijkstra(graph, s.node);
    const kmById = {};
    for (const st of msg.stands) kmById[st.id] = standKm(graph, dist, st, msg.from, s);
    self.postMessage({ type: 'distances', from: msg.from, kmById });
  }
};
