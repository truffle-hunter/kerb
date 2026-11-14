// The app's clock. In dev mode (?dev=1) `?now=<ISO>` fixes the start and advance(ms) moves it (tests, demos).
const q = new URLSearchParams(location.search);
export const dev = q.get('dev') === '1';
const start = dev && q.get('now') ? Date.parse(q.get('now')) : null;
const t0 = performance.now();
let offset = 0;

export function now() {
  return new Date((start !== null ? start + (performance.now() - t0) : Date.now()) + offset);
}
export function advance(ms) { offset += ms; }
