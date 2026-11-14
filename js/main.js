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
import { initial as loggerInitial, step as loggerStep, deriveWaits, detectStand, autoStartFor } from './engine/logger.js';
import { toJSON, toCSV } from './engine/export.js';
import { parseBackup, mergeEvents, closeDanglingWaits } from './engine/backup.js';
import { sunElevation } from './ui/dom.js';
import { glance } from './ui/glance.js';
import { detail } from './ui/detail.js';
import { log } from './ui/log.js';
import { settings } from './ui/settings.js';
import { firstrun } from './ui/firstrun.js';
import { stats as statsView } from './ui/stats.js';
import { phoneCheck, gatherProbe } from './ui/phonecheck.js';
import { ranks } from './ui/ranks.js';
import { checkRows, reportText } from './engine/phonecheck.js';
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
  fixLog: [], offlineBootAt: null, lastBackup: null, persisted: null, check: null, restoreMsg: null, rankQuery: '', detailFrom: 'glance', logFilter: null, scroll: {}, renderedView: null, // Phone check, backup (ADR 0008)
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
  S.fixLog.push({ accuracy: f.accuracy, speed: f.speed }); // Phone check: accuracy and speed only, in memory
  if (S.fixLog.length > 60) S.fixLog.shift();
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
    const a = autoStartFor(S.logger, loggerCtx());
    seenChanged = !S.detected || d.stand !== S.detected.stand || d.detect !== S.detected.detect
      || JSON.stringify(a) !== JSON.stringify(S.autoStart);
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
  detail(id, from = 'glance') { S.view = 'detail'; S.detailId = id; S.detailFrom = from; S.scroll[`detail:${id}`] = 0; render(); },
  back() { S.view = S.view === 'detail' && S.detailFrom === 'ranks' ? 'ranks' : 'glance'; render(); }, // detail returns where it came from
  openRanks() { S.view = 'ranks'; render(); },
  openLog() { S.view = 'log'; S.logFilter = null; render(); },
  openCheckLog() { S.view = 'log'; S.logFilter = 'check'; render(); }, // the review chip: only waits to check
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
  async openCheck() {
    S.view = 'check'; S.check = null; render();
    const probe = await gatherProbe(S, clockNow().toISOString());
    if (S.view !== 'check') return;
    const rows = checkRows(probe);
    S.check = { rows, text: reportText(rows, probe), copied: false };
    render();
  },
  async copyReport() {
    if (!S.check) return;
    try { await navigator.clipboard.writeText(S.check.text); S.check.copied = true; render(); } catch (e) {
      const t = document.querySelector('[data-test=check-report]'); // no clipboard access: select it for a long-press copy
      if (t) { t.focus(); t.select(); }
    }
  },
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
    const how = await exportFile(`kerb-waits-${dublinParts(at()).date}.json`, toJSON({ events: S.events, waits: S.waits, meta, device: S.device }), 'application/json');
    if (how !== 'cancelled') { S.lastBackup = at().toISOString(); store.setSetting('lastBackup', S.lastBackup); render(); }
  },
  async restore(file) { // ADR 0008: add the backup's events this phone doesn't have; the same file twice changes nothing
    if (!file) return;
    if (S.logger.mode !== 'idle') { S.restoreMsg = 'Finish the current wait first, then restore.'; render(); return; }
    let b;
    try { b = parseBackup(await file.text()); } catch (e) {
      S.restoreMsg = "This isn't a Kerb backup file. Nothing was changed."; render(); return;
    }
    const wasEmpty = S.events.length === 0, before = S.waits.length;
    const m = mergeEvents(S.events, b.events, { localDevice: S.device, fileDevice: b.device });
    // a wait left open in the backup (taken mid-wait) is closed at its last sighting, not resumed weeks later
    m.events = closeDanglingWaits(m.events);
    if (!m.added) { S.restoreMsg = 'Nothing new: everything in this backup is already on this phone.'; render(); return; }
    try { await store.replaceAll(m.events); } catch (e) {
      S.restoreMsg = "Couldn't save the restored log on this phone. Nothing was changed."; render(); return;
    }
    S.events = m.events;
    S.waits = deriveWaits(S.events);
    if (m.device && m.device !== S.device) { S.device = m.device; store.setSetting('device', S.device); }
    if (wasEmpty && b.exportedAt) { S.lastBackup = b.exportedAt; store.setSetting('lastBackup', S.lastBackup); } // it is in that file
    const added = S.waits.length - before, already = Math.max(0, deriveWaits(b.events).length - added);
    S.restoreMsg = `Restored ${added} wait${added === 1 ? '' : 's'}${already ? ` (${already} ${already === 1 ? 'was' : 'were'} already here)` : ''}.`;
    render();
  },
  async exportCSV() { await exportFile(`kerb-waits-${dublinParts(at()).date}.csv`, toCSV(S.waits), 'text/csv'); },
  firstRunOk() { S.firstRun = false; store.setSetting('seenFirstRun', true); render(); },
};

const viewKey = () => (S.view === 'detail' ? `detail:${S.detailId}` : S.view);

function render() {
  // Typing in the ranks filter: don't rebuild the screen under the keyboard (iOS drops it); the list filters in place.
  if (S.view === 'ranks' && S.renderedView === 'ranks' && document.activeElement
      && document.activeElement.dataset && document.activeElement.dataset.test === 'ranks-filter') return;
  stats.renders++;
  const root = document.getElementById('app');
  const before = root.querySelector(':scope > main'); // keep each screen's scroll position across re-renders (review fix)
  if (before && S.renderedView) S.scroll[S.renderedView] = before.scrollTop;
  const focused = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.test : null;
  const parts = { ...dublinParts(S.now), time: hhmm(S.now) };
  if (S.view === 'glance' && S.data) { // which rank the idle bar names, and whether Auto will start by itself
    S.detected = detectStand(S.fix, clockNow(), loggerCtx());
    S.autoStart = autoStartFor(S.logger, loggerCtx());
  }
  const view = S.view === 'detail' ? detail(S, A, S.detailId, parts) : S.view === 'log' ? log(S, A, parts)
    : S.view === 'stats' ? statsView(S, A, parts)
    : S.view === 'check' ? phoneCheck(S, A, parts)
    : S.view === 'ranks' ? ranks(S, A, parts)
    : S.view === 'settings' ? settings(S, A, parts) : glance(S, A, parts);
  root.replaceChildren(...view, ...(S.firstRun ? [firstrun(A)] : []));
  S.renderedView = viewKey();
  const after = root.querySelector(':scope > main');
  if (after && S.scroll[S.renderedView]) after.scrollTop = S.scroll[S.renderedView];
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
  S.lastBackup = saved.lastBackup || saved.lastExport || null; // lastExport: the name before ADR 0008
  // Phone check: remember that Kerb has started with no signal (the offline test a driver does in aeroplane mode)
  S.offlineBootAt = navigator.onLine ? saved.offlineBootAt || null : clockNow().toISOString();
  if (!navigator.onLine) store.setSetting('offlineBootAt', S.offlineBootAt);
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
  // ADR 0008: whether the phone promises to keep Kerb's storage decides how soon the backup reminder comes
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().then((v) => { S.persisted = v; render(); }).catch(() => {});
  }
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
