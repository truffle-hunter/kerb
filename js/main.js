// Kerb: boot, state, recompute and render (spec §5, §8, §10). One render per state change; no animation loops.
import { now as clockNow, advance as clockAdvance, dev } from './platform/clock.js';
import { watch } from './platform/location.js';
import * as store from './platform/store.js';
import { setShift } from './platform/wake.js';
import { exportFile } from './platform/share.js';
import { dublinParts, hhmm, daysBetween } from './engine/time.js';
import { status, isUsable } from './engine/legal.js';
import { distM } from './engine/geo.js';
import { recommend, score } from './engine/demand.js';
import { upcoming, nextImportant, triggersAround, timetableStatus } from './engine/triggers.js';
import { initial as loggerInitial, step as loggerStep, deriveWaits, detectStand } from './engine/logger.js';
import { toJSON, toCSV } from './engine/export.js';
import { sunElevation } from './ui/dom.js';
import { glance } from './ui/glance.js';
import { detail } from './ui/detail.js';
import { log } from './ui/log.js';
import { settings } from './ui/settings.js';
import { firstrun } from './ui/firstrun.js';
import { stats as statsView } from './ui/stats.js';
import { drawDetailMap } from './ui/map.js';
import { fetchWeather } from './platform/weather.js';
import { liveItems } from './platform/relay.js';

const OCB = [-6.2592, 53.3472]; // O'Connell Bridge: the reference point when location is off
const MODEL = 'kerb-demand-1';
const FILES = ['stands', 'chains', 'rules', 'triggers', 'events', 'catchments', 'params', 'meta'];
const MOVE_M = 25;
const stats = { renders: 0, recomputes: 0, ticks: 0 };
const WEATHER_EVERY_MS = 30 * 60000;
const RELAY_EVERY_MS = 2 * 60000; // only when the driver has set a relay URL
// Dev mode runs on a fixed fake clock, so it only asks Met Éireann when the test or demo opts in (?weather=1).
const weatherOn = !dev || new URLSearchParams(location.search).get('weather') === '1';

const S = {
  ready: false, data: null, byId: {}, ctx: null, now: clockNow(), fix: null, loc: 'pending', km: null, kmRequested: null,
  recs: [], next: null, logger: loggerInitial(), events: [], waits: [], usableIds: new Set(),
  settings: { nav: 'google', permit: false, theme: 'auto', shift: false, relay: '', autoLog: true },
  view: 'glance', detailId: null, weather: null, live: null, storageOk: true, firstRun: false, lastTop: null, changed: false,
  online: navigator.onLine, picker: false, openSource: null, timetable: { current: true, to: null }, eventsStale: false, updateReady: false, nearby: [], cabsAhead: null, lastReport: null, ocb: OCB, device: null,
};
let worker = null, workerReady = false, workerFailed = false, loc = null, weatherAt = -Infinity, relayAt = -Infinity;
const hooks = { afterRender: [] };

const from = () => (S.fix ? [S.fix.lon, S.fix.lat] : OCB);

function fallbackKm(p) {
  const km = {};
  for (const s of S.data.stands) if (s.recommendable) km[s.id] = { km: (distM(p, s.head) * 1.3) / 1000, approx: true };
  return km;
}

function applyTheme() {
  const t = S.settings.theme === 'auto' ? (sunElevation(S.now, 53.35, -6.26) < 3 ? 'dark' : 'light') : S.settings.theme;
  if (document.documentElement.dataset.theme !== t) {
    document.documentElement.dataset.theme = t;
    document.querySelector('meta[name=theme-color]').setAttribute('content', t === 'dark' ? '#101A26' : '#F4F6F8');
  }
}

function recompute() {
  stats.recomputes++;
  S.now = clockNow();
  S.ctx = { ...S.data, weather: S.weather, live: S.live };
  const recs = recommend(S.data.stands, S.now, S.ctx, S.km || fallbackKm(from()), { permit: S.settings.permit, n: S.data.params.rank.n });
  const top = recs[0] ? recs[0].stand.id : null;
  S.changed = S.lastTop !== null && top !== S.lastTop;
  S.lastTop = top;
  S.recs = recs;
  S.next = nextImportant(upcoming(S.now, S.ctx, 60), S.ctx, from());
  S.timetable = timetableStatus(S.now, S.ctx);
  S.eventsStale = daysBetween(S.data.meta.events.updated, dublinParts(S.now).date) > S.data.params.legal.events_stale_days;
  S.usableIds = new Set(S.data.stands.filter((s) => s.line && isUsable(status(s, S.now, S.ctx))).map((s) => s.id));
  applyTheme();
}

function snapshot(id) {
  const order = S.recs.map((r) => r.stand.id);
  const r = S.recs.find((x) => x.stand.id === id);
  const P = S.data.params.demand;
  const d = r ? r.demand : score(S.byId[id], S.now, S.ctx, triggersAround(S.now, S.ctx, P.kernel_end_min, P.kernel_lead_min));
  return { demand_score: d.score, demand_level: d.level, reason: d.reason, rank_order: order };
}

function loggerCtx() {
  return { stands: S.data.stands, usableIds: S.usableIds, chains: S.data.chains, params: S.data.params, shown: snapshot,
    auto: S.settings.autoLog !== false, // ADR 0005: automatic joins unless switched off in Settings
    versions: { model: MODEL, params: S.data.params.version, bundle: S.data.meta.bundle_version }, device: S.device };
}

function feedLogger(input) {
  const before = S.logger;
  const r = loggerStep(S.logger, input, loggerCtx());
  S.logger = r.state;
  if (before.mode !== r.state.mode) S.barChangedAt = performance.now();
  for (const ev of r.events) {
    S.events.push(ev);
    store.append(ev).catch(() => { S.storageOk = false; render(); }); // e.g. quota or eviction: say so, never lose silently
    if (ev.type === 'join') { S.cabsAhead = null; S.openSource = ev.source; }
    if (ev.type === 'report') S.lastReport = { stand: ev.stand, cabsAhead: ev.cabsAhead, people: ev.people, t: new Date(ev.t) };
  }
  if (r.events.length) S.waits = deriveWaits(S.events);
  return r.events.length > 0 || before.mode !== r.state.mode || before.stand !== r.state.stand;
}

function restoreLogger(events) {
  let open = null;
  for (const e of events) {
    if (open && e.type !== 'outcome' && e.type !== 'cancel' && e.type !== 'void') open.lastSeen = new Date(e.t); // last evidence of this wait
    // an automatic join is backdated; Kerb had seen the car until at least the moment it detected the wait
    if (e.type === 'join') open = { stand: e.stand, joinedAt: new Date(e.t), joinT: e.t, departAt: null, lastSeen: new Date(e.detected_at || e.t), source: e.source };
    else if (e.type === 'switch_stand' && open) open.stand = e.stand;
    else if (e.type === 'depart' && open) open.departAt = new Date(e.t);
    else if (e.type === 'resume' && open) open.departAt = null; // "Still waiting" undid the departure
    else if (e.type === 'outcome' || e.type === 'cancel' || (e.type === 'void' && open && e.wait === open.joinT)) open = null;
  }
  if (open) {
    const { source, ...rest } = open;
    // tapped waits decide their anchor again from the next good fix (waits without a kerb line depend on it)
    S.logger = { ...loggerInitial(), mode: open.departAt ? 'outcome' : 'waiting', ...rest, seenAt: rest.lastSeen,
      asserted: source !== 'auto', anchorPt: undefined };
    S.openSource = source;
  } else {
    // "Not a rank wait" tapped shortly before Kerb was closed: keep that stand quiet until the car has moved away
    const last = events[events.length - 1];
    if (last && last.type === 'void' && last.source === 'bar' && last.stand && clockNow() - Date.parse(last.t) < 30 * 60000) {
      S.logger = { ...loggerInitial(), suppressedIds: [last.stand] };
    }
  }
}

function requestKm() {
  if (!workerReady) return;
  S.kmRequested = from();
  worker.postMessage({ type: 'distances', from: S.kmRequested,
    stands: S.data.stands.filter((s) => s.recommendable).map((s) => ({ id: s.id, line: s.line, head: s.head })) });
}

function startWorker() {
  try {
    worker = new Worker(new URL('./route.worker.js', import.meta.url), { type: 'module' });
  } catch (e) {
    workerFailed = true; // straight-line distances (marked ~) remain
    return;
  }
  worker.onerror = () => { workerFailed = true; };
  worker.onmessage = (e) => {
    if (e.data.type === 'loaded') { workerReady = true; requestKm(); }
    if (e.data.type === 'distances') { S.km = e.data.kmById; recompute(); render(); }
  };
  worker.postMessage({ type: 'load', url: new URL('../data/graph.json', import.meta.url).href });
}

function onFix(f) {
  const wasOk = S.loc === 'ok';
  S.fix = f;
  S.loc = 'ok';
  const loggerChanged = feedLogger({ type: 'fix', fix: f });
  const p = [f.lon, f.lat];
  if (loc) loc.setHigh(S.logger.mode === 'waiting' || S.data.stands.some((s) => s.head && distM(p, s.head) <= 500));
  const moved = !S.kmRequested || distM(S.kmRequested, p) >= MOVE_M;
  if (moved) requestKm();
  // the idle bar names the rank Kerb sees: re-render when that changes, not only every 25 m (review fix)
  let seenChanged = false;
  if (S.view === 'glance' && S.logger.mode === 'idle') {
    const d = detectStand(f, clockNow(), loggerCtx());
    seenChanged = !S.detected || d.stand !== S.detected.stand || d.detect !== S.detected.detect;
  }
  if (moved || !wasOk) { recompute(); render(); } else if (loggerChanged || seenChanged) render();
}

function onLocError() {
  if (S.loc === 'ok') return; // keep the last good fix
  S.loc = 'off';
  recompute();
  render();
}

async function refreshWeather() {
  if (!weatherOn || !navigator.onLine) return;
  weatherAt = performance.now();
  const w = await fetchWeather((u) => fetch(u, { cache: 'no-store' }), clockNow());
  if (w) { S.weather = w; recompute(); render(); }
}

async function refreshRelay() {
  if (!S.settings.relay || !navigator.onLine) { S.live = null; return; }
  relayAt = performance.now();
  S.live = await liveItems((u) => fetch(u, { cache: 'no-store' }), S.settings.relay, clockNow());
  recompute();
  render();
}

function onResume() {
  if (document.visibilityState !== 'visible') return;
  onTick(); // back from the nav app: re-evaluate legality and demand now, not at the next minute
  if ('serviceWorker' in navigator) navigator.serviceWorker.getRegistration().then((r) => r && r.update()).catch(() => {});
}

function startTicking() {
  const sec = clockNow().getSeconds(), ms = clockNow().getMilliseconds();
  setTimeout(() => { onTick(); setInterval(onTick, 60000); }, (60 - sec) * 1000 - ms); // on the minute
}

function onTick() {
  stats.ticks++;
  S.now = clockNow();
  if (performance.now() - weatherAt >= WEATHER_EVERY_MS) refreshWeather();
  if (S.settings.relay && performance.now() - relayAt >= RELAY_EVERY_MS) refreshRelay();
  feedLogger({ type: 'tick', t: S.now });
  for (const f of hooks.tick || []) f();
  recompute();
  render();
}

const at = () => clockNow();
const A = {
  detail(id) { S.view = 'detail'; S.detailId = id; render(); },
  back() { S.view = 'glance'; render(); },
  openLog() { S.view = 'log'; render(); },
  openSettings() { S.view = 'settings'; render(); },
  join(id) { feedLogger({ type: 'tap_join', stand: id, t: at() }); S.picker = false; render(); },
  start() { feedLogger({ type: 'tap_start', t: at() }); S.picker = false; render(); }, // ADR 0006: rank detected, no list
  still() { feedLogger({ type: 'tap_still', t: at() }); render(); },
  setMode(auto) { A.setSetting('autoLog', auto); },
  chooseRank(id) { feedLogger({ type: 'tap_switch', stand: id, t: at() }); S.picker = false; render(); },
  switchStand() { feedLogger({ type: 'tap_switch', t: at() }); render(); },
  dismiss() { feedLogger({ type: 'dismiss', t: at() }); render(); },
  discard() { // the one bar action that loses data: ignore it just after the bar changed (a double tap on Start lands here)
    if (performance.now() - (S.barChangedAt || 0) < 600) return;
    feedLogger({ type: 'tap_discard', t: at() }); render();
  },
  openStats() { S.view = 'stats'; render(); },
  review(type, wait, field, value) { // Log review: confirm / edit / void a finished wait (append-only, ADR 0005)
    const ev = { type, t: at().toISOString(), wait, source: 'review', ...(field ? { field, value } : {}) };
    S.events.push(ev);
    store.append(ev).catch(() => { S.storageOk = false; render(); });
    S.waits = deriveWaits(S.events);
    render();
  },
  fareIn() { feedLogger({ type: 'tap_fare_in', t: at() }); render(); },
  fare() { feedLogger({ type: 'tap_fare', t: at() }); render(); },
  left() { feedLogger({ type: 'tap_left', t: at() }); render(); },
  report(delta) {
    S.cabsAhead = Math.max(0, (S.cabsAhead ?? (delta > 0 ? 0 : 1)) + delta);
    feedLogger({ type: 'report', cabsAhead: S.cabsAhead, t: at() });
    render();
  },
  openPicker() {
    const p = from();
    S.nearby = S.data.stands.filter((s) => S.usableIds.has(s.id) && s.head && distM(p, s.head) <= 1000)
      .sort((a, b) => distM(p, a.head) - distM(p, b.head)).slice(0, 6);
    S.picker = true;
    render();
  },
  closePicker() { S.picker = false; render(); },
  setSetting(k, v) {
    S.settings[k] = v;
    store.setSetting(k, v);
    if (k === 'shift') setShift(v);
    if (k === 'relay') refreshRelay();
    for (const f of hooks.setting || []) f(k, v);
    recompute();
    render();
  },
  async exportJSON() {
    const meta = { model: MODEL, params_version: S.data.params.version, bundle_version: S.data.meta.bundle_version, exported_at: at().toISOString() };
    await exportFile(`kerb-waits-${dublinParts(at()).date}.json`, toJSON({ events: S.events, waits: S.waits, meta, device: S.device }), 'application/json');
  },
  async exportCSV() { await exportFile(`kerb-waits-${dublinParts(at()).date}.csv`, toCSV(S.waits), 'text/csv'); },
  firstRunOk() { S.firstRun = false; store.setSetting('seenFirstRun', true); render(); },
};

function render() {
  stats.renders++;
  const root = document.getElementById('app');
  const focused = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.test : null;
  const parts = { ...dublinParts(S.now), time: hhmm(S.now) };
  if (S.view === 'glance' && S.data) S.detected = detectStand(S.fix, clockNow(), loggerCtx()); // which rank the idle bar names
  const view = S.view === 'detail' ? detail(S, A, S.detailId, parts) : S.view === 'log' ? log(S, A, parts)
    : S.view === 'stats' ? statsView(S, A, parts)
    : S.view === 'settings' ? settings(S, A, parts) : glance(S, A, parts);
  root.replaceChildren(...view, ...(S.firstRun ? [firstrun(A)] : []));
  S.changed = false;
  if (focused) { const el = root.querySelector(`[data-test="${focused}"]`); if (el) el.focus(); }
  if (S.view === 'detail') drawDetailMap(root, S).catch(() => {}); // map is an aid; the sheet works without it
  for (const f of hooks.afterRender) f(S, root);
}

async function boot() {
  const loaded = await Promise.all(FILES.map(async (f) => {
    const r = await fetch(`data/${f}.json`);
    if (!r.ok) throw new Error(`data/${f}.json: HTTP ${r.status}`);
    return r.json();
  }));
  const d = Object.fromEntries(FILES.map((f, i) => [f, loaded[i]]));
  S.data = { stands: d.stands.stands, chains: d.chains.chains, rules: d.rules.rules, triggers: d.triggers, events: d.events,
    catchments: d.catchments, params: d.params, meta: d.meta };
  S.byId = Object.fromEntries(S.data.stands.map((s) => [s.id, s]));
  S.storageOk = await store.open();
  const saved = await store.settings();
  for (const k of Object.keys(S.settings)) if (saved[k] !== undefined) S.settings[k] = saved[k];
  S.firstRun = !saved.seenFirstRun;
  S.device = saved.device || (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));
  if (!saved.device) store.setSetting('device', S.device);
  S.events = await store.all();
  S.waits = deriveWaits(S.events);
  restoreLogger(S.events);
  for (const f of hooks.boot || []) await f(S);
  startWorker();
  loc = watch(onFix, onLocError);
  startTicking();
  document.addEventListener('visibilitychange', onResume);
  addEventListener('pageshow', (e) => { if (e.persisted) onResume(); });
  addEventListener('online', () => { S.online = true; render(); });
  addEventListener('offline', () => { S.online = false; render(); });
  if (S.settings.shift) setShift(true);
  recompute();
  render();
  S.ready = true;
  refreshWeather();
  refreshRelay();
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  if ('serviceWorker' in navigator) {
    let seen = !!navigator.serviceWorker.controller; // the first install's claim is not an update
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (seen) { S.updateReady = true; render(); }
      seen = true;
    });
    navigator.serviceWorker.register('sw.js').catch(() => {}); // offline after first load
  }
}

export const kerb = { S, A, hooks, recompute, render, stats, now: clockNow };
window.__kerb = {
  get ready() { return S.ready; },
  get settled() { return S.ready && (S.km !== null || workerFailed); }, // road distances in (or unavailable)
  stats,
  ...(dev ? {
    S, advance(ms) { clockAdvance(ms); onTick(); },
    detail(id) { A.detail(id); },
    fix(p) { onFix({ lon: p.lon, lat: p.lat, speed: p.speed ?? null, accuracy: p.accuracy ?? 10, t: clockNow() }); },
  } : {}),
};

boot().catch((e) => {
  document.getElementById('app').textContent = `Kerb couldn't start: ${e.message}. Reload when you have signal.`;
  throw e;
});
