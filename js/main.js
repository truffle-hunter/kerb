// Kerb: boot, state, recompute and render (spec §5, §8, §10). One render per state change; no animation loops.
import { now as clockNow, advance as clockAdvance, dev } from './platform/clock.js';
import { watch } from './platform/location.js';
import * as store from './platform/store.js';
import { setKeepAwake, awakeHeld } from './platform/wake.js';
import { exportFile } from './platform/share.js';
import { dublinParts, hhmm, daysBetween } from './engine/time.js';
import { status, isUsable } from './engine/legal.js';
import { distM } from './engine/geo.js';
import { recommend, score, nextPickMemo, twins } from './engine/demand.js';
import { upcoming, nextImportant, triggersAround, timetableStatus } from './engine/triggers.js';
import { initial as loggerInitial, step as loggerStep, deriveWaits, detectStand, autoStartFor } from './engine/logger.js';
import { deriveShifts, currentShift, activityOf, lastActivity, shiftDue, tagWaits, onShiftMinutes } from './engine/shift.js';
import { toJSON, toCSV } from './engine/export.js';
import { parseBackup, mergeEvents, closeDanglingWaits, closeDanglingShifts, hasOwnLog, mergeOpens } from './engine/backup.js';
import { tonightCard, stillToCome, endShiftLine, waveKeysAt } from './engine/tonight.js';
import { sunElevation } from './ui/dom.js';
import { glance } from './ui/glance.js';
import { detail } from './ui/detail.js';
import { why } from './ui/why.js';
import { tonightSheet } from './ui/tonight.js';
import { log } from './ui/log.js';
import { settings } from './ui/settings.js';
import { firstrun } from './ui/firstrun.js';
import { stats as statsView } from './ui/stats.js';
import { phoneCheck, gatherProbe } from './ui/phonecheck.js';
import { ranks } from './ui/ranks.js';
import { checkRows, reportText } from './engine/phonecheck.js';
import { drawDetailMap } from './ui/map.js';
import { nextHeading } from './engine/heading.js';
import { motionFlags, renderState, continueFlags, motionStyle } from './ui/motion.js';
import { fetchWeather, packForecast, unpackForecast } from './platform/weather.js';
import { liveItems } from './platform/relay.js';

const OCB = [-6.2592, 53.3472]; // O'Connell Bridge: the reference point when location is off
const MODEL = 'kerb-demand-2'; // ADR 0014: timed pulses and legality judged for the driver's arrival
const FILES = ['stands', 'chains', 'rules', 'triggers', 'events', 'catchments', 'params', 'meta'];
const MOVE_M = 25;
const stats = { renders: 0, recomputes: 0, ticks: 0 };
const WEATHER_EVERY_MS = 30 * 60000;
const RELAY_EVERY_MS = 2 * 60000; // only when the driver has set a relay URL
// Dev mode runs on a fixed fake clock, so it only asks Met Éireann when the test or demo opts in (?weather=1).
const weatherOn = !dev || new URLSearchParams(location.search).get('weather') === '1';

const S = {
  ready: false, data: null, byId: {}, ctx: null, now: clockNow(), fix: null, loc: 'pending', km: null, kmRequested: null,
  recs: [], nowTop: null, pick: null, next: null, logger: loggerInitial(), events: [], waits: [], usableIds: new Set(),
  settings: { nav: 'google', permit: false, theme: 'auto', keepAwake: false, relay: '', autoLog: true },
  view: 'glance', detailId: null, weather: null, live: null, storageOk: true, firstRun: false, lastTop: null, changed: false,
  online: navigator.onLine, picker: false, openSource: null, timetable: { current: true, to: null }, eventsStale: false, updateReady: false, nearby: [], cabsAhead: null, lastReport: null, ocb: OCB, device: null,
  fixLog: [], offlineBootAt: null, lastBackup: null, persisted: null, check: null, restoreMsg: null, rankQuery: '', detailFrom: 'glance', logFilter: null, scroll: {}, renderedView: null, lastRender: null, motion: {}, // Phone check, backup (ADR 0008)
  shifts: [], shift: null, shiftAnchor: null, shiftSeenAt: null, shiftView: null, shiftDue: null, // ADR 0010
  heading: null, mapView: 'kerb', // the rank map (ADR 0011): your heading, in memory only; Kerb or Area for the session
  why: null, renderedWhy: null, // "Why this rank?" (ADR 0013): {id} of the stand the open sheet explains
  tonight: null, renderedTonight: false, forecast: null, planOpens: [], tonightCard: null, toCome: null, // "Tonight" (ADR 0015)
};
let worker = null, workerReady = false, workerFailed = false, loc = null, weatherAt = -Infinity, relayAt = -Infinity;
// A sheet's Close goes Back through history, which lands later: a sheet opened in between waits for it, or that late
// Back would close the new one (plan review C2). Cleared by the popstate, or after a second if none comes.
let backPending = false, reopen = null, backTimer = null;
function sheetBack() {
  backPending = true;
  clearTimeout(backTimer);
  backTimer = setTimeout(() => { if (backPending) settleBack(); }, 1000);
  history.back();
}
function settleBack() {
  backPending = false;
  clearTimeout(backTimer);
  const f = reopen;
  reopen = null;
  if (f) f();
}
const hooks = { afterRender: [] };

const from = () => (S.fix ? [S.fix.lon, S.fix.lat] : OCB);
const focusTest = (t) => { const el = document.querySelector(`[data-test="${t}"]`); if (el) el.focus(); return !!el; };

/** Closes "Why this rank?" (ADR 0013) and gives focus back to the line that opened it. */
function shutWhy() {
  S.why = null;
  render();
  if (!focusTest('why-open')) focusTest('rec-name');
}

/** Closes "Tonight" (ADR 0015) and gives focus back to what opened it: the off-shift card or the next-hour line. */
function shutTonight() {
  const opener = S.tonight ? S.tonight.from : null;
  S.tonight = null;
  render();
  if (!(opener && focusTest(opener))) focusTest('rec-name');
}

/** Steps a Tonight row's detail back to the list (ADR 0016) and gives focus back to that row, or to Close if it's gone. */
function shutTonightRow() {
  const key = S.tonight && S.tonight.row;
  if (!key) return;
  S.tonight = { ...S.tonight, row: null, rowTitle: null };
  render();
  const el = document.querySelector(`[data-test="tonight-row-open"][data-key="${CSS.escape(key)}"]`);
  if (el) el.focus(); else focusTest('tonight-close');
}

function fallbackKm(p) {
  const km = {};
  for (const s of S.data.stands) if (s.recommendable) km[s.id] = { km: (distM(p, s.head) * 1.3) / 1000, approx: true };
  return km;
}

function applyTheme() {
  const t = S.settings.theme === 'auto' ? (sunElevation(S.now, 53.35, -6.26) < 3 ? 'dark' : 'light') : S.settings.theme;
  if (document.documentElement.dataset.theme !== t) {
    document.documentElement.dataset.theme = t;
    document.querySelector('meta[name=theme-color]').setAttribute('content', t === 'dark' ? '#12100E' : '#F5F3F0');
  }
}

function recompute() {
  stats.recomputes++;
  S.now = clockNow();
  S.ctx = { ...S.data, weather: S.weather, live: S.live };
  const km = S.km || fallbackKm(from());
  const recs = recommend(S.data.stands, S.now, S.ctx, km, { permit: S.settings.permit, n: S.data.params.rank.n });
  // ADR 0014: the pick Kerb would have made judging at now (for the Why sheet and the log), and the pick memo (the
  // logger's mode decides what counts: nothing while a wait is open, but an unanswered "Fare?" still records)
  S.nowTop = recs[0] && recs[0].byArrival
    ? recommend(S.data.stands, S.now, S.ctx, km, { permit: S.settings.permit, n: 1, arrival: false })[0] || null : recs[0] || null;
  S.pick = nextPickMemo(S.pick, recs[0] ? { id: recs[0].stand.id, km: recs[0].km } : null,
    S.now, from(), S.nowTop ? S.nowTop.stand.id : null, { mode: S.logger.mode });
  const top = recs[0] ? recs[0].stand.id : null;
  S.changed = S.lastTop !== null && top !== S.lastTop;
  S.lastTop = top;
  S.recs = recs;
  S.next = nextImportant(upcoming(S.now, S.ctx, 60), S.ctx, from());
  S.timetable = timetableStatus(S.now, S.ctx);
  S.eventsStale = daysBetween(S.data.meta.events.updated, dublinParts(S.now).date) > S.data.params.legal.events_stale_days;
  S.usableIds = new Set(S.data.stands.filter((s) => s.line && isUsable(status(s, S.now, S.ctx))).map((s) => s.id));
  // ADR 0015: off shift, the line into "Tonight"; on shift, what is still to come for End shift (never from the first
  // fatigue mark). A model that can't be built costs these two lines, never the glance (plan review C3).
  S.tonightCard = null;
  S.toCome = null;
  try {
    if (!S.shift) S.tonightCard = tonightCard(S.ctx, S.now, S.forecast); // rows and rain only: cheap on every tick (review I3)
    else if (endShiftLine(S.ctx, S.now, S.data.params, onShiftMinutes(S.shifts, S.now.getTime(), S.data.params.shift.fatigue_window_h))) {
      S.toCome = stillToCome(S.ctx, S.now, S.data.params);
    }
  } catch (e) {
    setTimeout(() => { throw e; });
  }
  applyTheme();
}

function snapshot(id, t = S.now) {
  const order = S.recs.map((r) => r.stand.id);
  const r = S.recs.find((x) => x.stand.id === id);
  const P = S.data.params.demand;
  const d = r ? r.demand : score(S.byId[id], S.now, S.ctx, triggersAround(S.now, S.ctx, P.kernel_end_min, P.kernel_lead_min));
  // ADR 0014: the pick last shown at the stop he drove away from, the pick Kerb would have made at now, and the speed
  // guess in force, so realised speed and the effect can be measured from the log (twins count as the same place)
  const m = S.pick && S.pick.memo;
  const differs = !!m && !!m.nowId && m.nowId !== m.id && !(S.byId[m.id] && S.byId[m.nowId] && twins(S.byId[m.id], S.byId[m.nowId]));
  return { demand_score: d.score, demand_level: d.level, reason: d.reason, rank_order: order,
    pick_id: m ? m.id : null, pick_km: m ? m.km : null, pick_t: m ? m.t.toISOString() : null, now_pick_id: m ? m.nowId : null,
    now_pick_differs: differs, drive_kmh: S.data.params.rank.drive_kmh,
    waves: S.byId[id] ? waveKeysAt(S.byId[id], new Date(t), S.ctx) : [] }; // ADR 0015: the waves this wait began inside
}

function loggerCtx() {
  return { stands: S.data.stands, usableIds: S.usableIds, chains: S.data.chains, params: S.data.params, shown: snapshot,
    auto: S.settings.autoLog !== false, // ADR 0005: automatic joins unless switched off in Settings
    onShift: !!S.shift, // ADR 0010: off shift nothing is logged
    versions: { model: MODEL, params: S.data.params.version, bundle: S.data.meta.bundle_version }, device: S.device };
}

function feedLogger(input) {
  const before = S.logger;
  const r = loggerStep(S.logger, input, loggerCtx());
  S.logger = r.state;
  if (before.mode !== r.state.mode) { S.barChangedAt = performance.now(); S.shiftView = null; } // a stray End shift never hides Fare?
  for (const ev of r.events) {
    record(ev);
    if (ev.type === 'join') { S.cabsAhead = null; S.openSource = ev.source; }
    if (ev.type === 'report') S.lastReport = { stand: ev.stand, cabsAhead: ev.cabsAhead, people: ev.people, t: new Date(ev.t) };
  }
  if (r.events.length) refreshLog();
  return r.events.length > 0 || before.mode !== r.state.mode || before.stand !== r.state.stand;
}

function record(ev) {
  S.events.push(ev);
  store.append(ev).catch(() => { S.storageOk = false; render(); }); // e.g. quota or eviction: say so, never lose silently
}

/** Waits and shifts from the event log (ADR 0010): each wait tagged with its shift, or legacy, or off shift. */
function refreshLog() {
  S.shifts = deriveShifts(S.events);
  S.shift = currentShift(S.shifts);
  S.waits = tagWaits(deriveWaits(S.events), S.shifts);
}

// ---- Shifts (ADR 0010): one tap starts one; it ends by itself after the idle gap, backdated to the last sign of work.
const shiftP = () => S.data.params.shift;
let seenWritten = 0;
function beat(force = false) { // a sign of work: kept as a heartbeat (no coordinates), written at most once a minute
  S.shiftSeenAt = S.now.toISOString();
  if (force || performance.now() - seenWritten >= 60000) { seenWritten = performance.now(); store.setSetting('shiftSeenAt', S.shiftSeenAt); }
}
const applyAwake = () => setKeepAwake(!!(S.settings.keepAwake && S.shift));
function endShiftAt(t, source, uncertain) {
  feedLogger({ type: 'shift_end', t: new Date(t), uncertain }); // an open wait closes first: no shift event splits a wait
  record({ type: 'shift_end', t: new Date(t).toISOString(), detected_at: S.now.toISOString(), source, ...(uncertain ? { uncertain: true } : {}) });
  refreshLog();
  S.shiftView = null;
  S.shiftAnchor = null;
  applyAwake();
}
/** Ends the shift if it has gone idle (or hit the cap); runs at boot, on every tick and on resume. */
function checkShiftDue() {
  if (!S.shift) return false;
  const due = shiftDue(S.shift, lastActivity(S.events, S.shift, S.shiftSeenAt), S.now.getTime(), shiftP());
  S.shiftDue = null;
  if (!due) return false;
  // a wait still open after a gap (the screen locked in a long airport queue): Kerb couldn't see, so the next fix decides,
  // still in the queue = working, gone = the shift ended at the last sign of work (review fix). The cap is never deferred.
  if (due.source === 'idle' && S.logger.mode === 'waiting') { S.shiftDue = due; return false; }
  endShiftAt(due.t, due.source, true);
  return true;
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
  S.heading = nextHeading(S.heading, f); // the map's car (ADR 0011)
  S.fixLog.push({ accuracy: f.accuracy, speed: f.speed }); // Phone check: accuracy and speed only, in memory
  if (S.fixLog.length > 60) S.fixLog.shift();
  S.loc = 'ok';
  const pending = S.shift ? S.shiftDue : null; // an idle end held back while a wait was open (checkShiftDue)
  const loggerChanged = feedLogger({ type: 'fix', fix: f });
  if (S.shift && pending) {
    S.shiftDue = null;
    if (S.logger.mode === 'waiting') beat(); // still in the queue after the gap: working
    else { endShiftAt(pending.t, pending.source, true); recompute(); render(); return; } // left during the gap
  } else if (S.shift) { // a move of 150 m or an open wait is a sign of work; a still car never is (ADR 0010)
    const a = activityOf({ anchor: S.shiftAnchor, fix: f, mode: S.logger.mode, locOk: true }, shiftP());
    S.shiftAnchor = a.anchor;
    if (a.active) beat();
  }
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
  else if (S.view === 'detail') drawDetailMap(document.getElementById('app'), S).catch(() => {}); // your car follows every fix: a blit, no render (ADR 0011)
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
  if (!w) return;
  S.weather = w;
  if (w.steps && w.steps.length) { // ADR 0015: every step, kept on the phone so Tonight shows rain offline too
    S.forecast = { steps: w.steps, issued: w.issued, fetched: w.fetched };
    store.setSetting('forecast', packForecast(S.forecast));
  }
  recompute();
  render();
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
  // ADR 0010: judge the gap before counting this minute (a phone back from hours hidden must not look busy), then
  // count it if Kerb can't see location (it can't tell) or a wait is open
  if (!checkShiftDue() && S.shift && !S.shiftDue && document.visibilityState === 'visible'
      && (S.loc !== 'ok' || S.logger.mode === 'waiting' || S.logger.mode === 'outcome')) beat();
  for (const f of hooks.tick || []) f();
  recompute();
  render();
}

const at = () => clockNow();
const A = {
  detail(id, from = 'glance') { S.view = 'detail'; S.detailId = id; S.detailFrom = from; S.scroll[`detail:${id}`] = 0; render(); },
  back() { S.view = S.view === 'detail' && S.detailFrom === 'ranks' ? 'ranks' : 'glance'; render(); }, // detail returns where it came from
  toggleMapView() { S.mapView = S.mapView === 'area' ? 'kerb' : 'area'; render(); }, // the rank map, for the session (ADR 0011)
  openRanks() { S.view = 'ranks'; render(); },
  openLog() { S.view = 'log'; S.logFilter = null; render(); },
  openCheckLog() { S.view = 'log'; S.logFilter = 'check'; render(); }, // the review chip: only waits to check
  openSettings() { S.view = 'settings'; render(); },
  join(id) { feedLogger({ type: 'tap_join', stand: id, t: at() }); S.picker = false; render(); },
  startShift(source = 'tap') { // ADR 0010: the roof sign goes on
    if (S.shift) return;
    S.now = at();
    record({ type: 'shift_start', t: S.now.toISOString(), source });
    refreshLog();
    S.shiftAnchor = S.fix ? [S.fix.lon, S.fix.lat] : null; // moves are measured from where the shift started
    beat(true);
    S.shiftView = null;
    applyAwake();
    recompute();
    render();
  },
  openShift() { S.shiftView = 'end'; render(); },
  keepGoing() { S.shiftView = null; render(); },
  endShift() { if (!S.shift) return; S.now = at(); endShiftAt(S.now.getTime(), 'tap', false); recompute(); render(); },
  resumeShift() { // "Still on shift": undo an end within resume_max_min of when it happened
    const last = S.shifts[S.shifts.length - 1];
    if (S.shift || !last || !last.end || at() - Date.parse(last.end) > shiftP().resume_max_min * 60000) return;
    S.now = at();
    record({ type: 'shift_resume', t: S.now.toISOString(), end: last.end });
    refreshLog();
    S.shiftAnchor = S.fix ? [S.fix.lon, S.fix.lat] : null;
    beat(true);
    applyAwake();
    recompute();
    render();
  },
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
    record({ type, t: at().toISOString(), wait, source: 'review', ...(field ? { field, value } : {}) });
    refreshLog();
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
    if (k === 'keepAwake') applyAwake();
    if (k === 'relay') refreshRelay();
    for (const f of hooks.setting || []) f(k, v);
    recompute();
    render();
  },
  async exportJSON() {
    const meta = { model: MODEL, params_version: S.data.params.version, bundle_version: S.data.meta.bundle_version, exported_at: at().toISOString() };
    const how = await exportFile(`kerb-waits-${dublinParts(at()).date}.json`,
      toJSON({ events: S.events, waits: S.waits, meta, device: S.device, shifts: S.shifts, planOpens: S.planOpens }), 'application/json');
    if (how !== 'cancelled') { S.lastBackup = at().toISOString(); store.setSetting('lastBackup', S.lastBackup); render(); }
  },
  async restore(file) { // ADR 0008: add the backup's events this phone doesn't have; the same file twice changes nothing
    if (!file) return;
    if (S.logger.mode !== 'idle') { S.restoreMsg = 'Finish the current wait first, then restore.'; render(); return; }
    let b;
    try { b = parseBackup(await file.text()); } catch (e) {
      S.restoreMsg = "This isn't a Kerb backup file. Nothing was changed."; render(); return;
    }
    const opens = mergeOpens(S.planOpens, b.planOpens); // ADR 0015: before "Nothing new", so a backup's openings still come in
    if (opens.length !== S.planOpens.length) { S.planOpens = opens; store.setSetting('planOpens', S.planOpens); }
    const wasEmpty = !hasOwnLog(S.events), before = S.waits.length; // shift events alone aren't a log (ADR 0010)
    const m = mergeEvents(S.events, b.events, { localDevice: S.device, fileDevice: b.device });
    // a wait left open in the backup (taken mid-wait) is closed at its last sighting, not resumed weeks later
    m.events = closeDanglingShifts(closeDanglingWaits(m.events)); // and a shift left open before a later start ends (ADR 0010)
    if (!m.added) { S.restoreMsg = 'Nothing new: everything in this backup is already on this phone.'; render(); return; }
    try { await store.replaceAll(m.events); } catch (e) {
      S.restoreMsg = "Couldn't save the restored log on this phone. Nothing was changed."; render(); return;
    }
    S.events = m.events;
    refreshLog();
    checkShiftDue();
    if (m.device && m.device !== S.device) { S.device = m.device; store.setSetting('device', S.device); }
    if (wasEmpty && b.exportedAt) { S.lastBackup = b.exportedAt; store.setSetting('lastBackup', S.lastBackup); } // it is in that file
    const added = S.waits.length - before, already = Math.max(0, deriveWaits(b.events).length - added);
    S.restoreMsg = `Restored ${added} wait${added === 1 ? '' : 's'}${already ? ` (${already} ${already === 1 ? 'was' : 'were'} already here)` : ''}.`;
    render();
  },
  async exportCSV() { await exportFile(`kerb-waits-${dublinParts(at()).date}.csv`, toCSV(S.waits), 'text/csv'); },
  firstRunOk() { S.firstRun = false; store.setSetting('seenFirstRun', true); render(); },
  // ADR 0013: "Why this rank?" opens on the top stand (or the stand the open sheet offers); the phone's Back closes it
  openWhy(id) {
    const target = id || (S.recs[0] && S.recs[0].stand.id);
    if (!target) return;
    if (backPending) { reopen = () => A.openWhy(id); return; } // the Back of a sheet just closed hasn't landed yet
    if (S.tonight) { S.tonight = null; history.replaceState({ kerbWhy: 1 }, ''); } // one sheet at a time, one history entry
    else if (!S.why) history.pushState({ kerbWhy: 1 }, '');
    S.why = { id: target };
    S.scroll[`why:${target}`] = 0;
    render();
    if (!focusTest('why-close')) focusTest('why-open');
  },
  closeWhy() {
    if (!S.why) return;
    if (history.state && history.state.kerbWhy) sheetBack(); // its popstate finds the sheet already shut
    shutWhy();
  },
  // ADR 0015: "Tonight" opens from the off-shift card or the next-hour line; Back, Escape and the backdrop close it
  openTonight(from = 'next-hour') {
    if (backPending) { reopen = () => A.openTonight(from); return; }
    if (S.why) { S.why = null; history.replaceState({ kerbTonight: 1 }, ''); }
    else if (!S.tonight) history.pushState({ kerbTonight: 1 }, '');
    S.tonight = { from, row: null, rowTitle: null };
    S.scroll.tonight = 0;
    // each opening is kept for the kill criterion (settings, not the event log: shifts and waits read every event)
    S.planOpens = [...S.planOpens, { t: clockNow().toISOString(), on_shift: !!S.shift }].slice(-2000);
    store.setSetting('planOpens', S.planOpens);
    render();
    if (!focusTest('tonight-close')) focusTest(from);
  },
  closeTonight() {
    if (!S.tonight) return;
    if (backPending) { // plan review I3: a row's Back hasn't landed; shut now, then step off Tonight's own entry once it has
      reopen = () => { if (history.state && history.state.kerbTonight) sheetBack(); };
      shutTonight();
      return;
    }
    if (history.state && history.state.kerbTonight) sheetBack();
    shutTonight();
  },
  // ADR 0016: a row drills the Tonight card into its reasons, one more history entry; every way back steps one level
  openTonightRow(key, title, kind) {
    if (!S.tonight) return; // plan review I3: a row deferred behind a Back that closed Tonight opens nothing
    if (backPending) { reopen = () => A.openTonightRow(key, title, kind); return; }
    if (S.tonight.row) history.replaceState({ kerbTonight: 1, kerbRow: 1 }, '');
    else history.pushState({ kerbTonight: 1, kerbRow: 1 }, '');
    S.tonight = { ...S.tonight, row: key, rowTitle: title };
    S.scroll[`tonight:${key}`] = 0;
    // each opening is kept for ADR 0016's kill criterion, apart from Tonight's own (they carry `why`)
    S.planOpens = [...S.planOpens, { t: clockNow().toISOString(), on_shift: !!S.shift, why: kind }].slice(-2000);
    store.setSetting('planOpens', S.planOpens);
    render();
    focusTest('tonight-back');
  },
  closeTonightRow() {
    if (!S.tonight || !S.tonight.row) return;
    if (history.state && history.state.kerbRow) sheetBack(); // its popstate finds the detail already shut
    shutTonightRow();
  },
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
  const focusedKey = focused && document.activeElement.dataset.key; // ADR 0016: Tonight's row buttons share one data-test
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
  // ADR 0013: the open sheet sits over the glance, which takes no taps or focus; its scroll survives the rebuild
  let sheet = null;
  if (S.why && S.view === 'glance' && !S.firstRun) {
    // a sheet that can't be built (e.g. data without params.explain) shuts and reports itself; the glance keeps updating
    try { sheet = why(S, A, from()); } catch (e) {
      S.why = null;
      if (history.state && history.state.kerbWhy) sheetBack();
      setTimeout(() => { throw e; });
    }
  } else if (S.tonight && S.view === 'glance' && !S.firstRun) { // ADR 0015: the same way, one sheet at a time
    try { sheet = tonightSheet(S, A); } catch (e) {
      if (S.tonight.row) { // plan review I4: a detail that can't be built steps back one level, to the list
        S.tonight = { ...S.tonight, row: null, rowTitle: null };
        if (history.state && history.state.kerbRow) sheetBack();
        try { sheet = tonightSheet(S, A); } catch (e2) { S.tonight = null; sheetBack(); }
      } else {
        S.tonight = null;
        if (history.state && history.state.kerbTonight) sheetBack();
      }
      setTimeout(() => { throw e; });
    }
  }
  if (sheet) for (const el of view) el.inert = true;
  const whyBody = root.querySelector('[data-test=why-body]');
  if (whyBody && S.renderedWhy) S.scroll[`why:${S.renderedWhy}`] = whyBody.scrollTop;
  const tnBody = root.querySelector('[data-test=tonight-body]');
  if (tnBody && S.renderedTonight === 'list') S.scroll.tonight = tnBody.scrollTop;
  const tdBody = root.querySelector('[data-test=tonight-detail-body]'); // ADR 0016: a row's detail keeps its own scroll
  if (tdBody && typeof S.renderedTonight === 'string' && S.renderedTonight.startsWith('row:')) S.scroll[`tonight:${S.renderedTonight.slice(4)}`] = tdBody.scrollTop;
  // ADR 0009: animate only what changed since the last render; a render mid-animation continues it from where it was
  const seen = renderState(S, viewKey()), t = performance.now();
  S.motion = continueFlags(S.motion, motionFlags(S.lastRender, seen), t);
  const m = motionStyle(S.motion, t);
  root.className = m.className;
  root.style.cssText = m.style;
  S.lastRender = seen;
  root.replaceChildren(...view, ...(S.firstRun ? [firstrun(A)] : []), ...(sheet ? [sheet] : []));
  S.renderedView = viewKey();
  S.renderedWhy = sheet && S.why ? S.why.id : null;
  S.renderedTonight = sheet && S.tonight ? (S.tonight.row ? `row:${S.tonight.row}` : 'list') : false;
  if (sheet && S.why) { const b = sheet.querySelector('[data-test=why-body]'); b.scrollTop = S.scroll[`why:${S.why.id}`] || 0; }
  if (sheet && S.tonight) {
    const b = sheet.querySelector(S.tonight.row ? '[data-test=tonight-detail-body]' : '[data-test=tonight-body]');
    if (b) b.scrollTop = (S.tonight.row ? S.scroll[`tonight:${S.tonight.row}`] : S.scroll.tonight) || 0;
  }
  const after = root.querySelector(':scope > main');
  if (after && S.scroll[S.renderedView]) after.scrollTop = S.scroll[S.renderedView];
  S.changed = false;
  if (focused) {
    const el = root.querySelector(focusedKey ? `[data-test="${focused}"][data-key="${CSS.escape(focusedKey)}"]` : `[data-test="${focused}"]`);
    if (el) el.focus();
  }
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
  // ADR 0012: the reviewed street photos (a committed asset beside the app, precached); none if the file can't load
  S.photos = await fetch('photos/photos.json').then((r) => (r.ok ? r.json() : {})).then((j) => j.photos || {}).catch(() => ({}));
  S.storageOk = await store.open();
  const saved = await store.settings();
  for (const k of Object.keys(S.settings)) if (saved[k] !== undefined) S.settings[k] = saved[k];
  S.firstRun = !saved.seenFirstRun;
  S.device = saved.device || (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));
  if (!saved.device) store.setSetting('device', S.device);
  S.lastBackup = saved.lastBackup || saved.lastExport || null; // lastExport: the name before ADR 0008
  S.forecast = unpackForecast(saved.forecast); // ADR 0015: the last forecast, for Tonight offline (null if unreadable)
  S.planOpens = Array.isArray(saved.planOpens) ? saved.planOpens.filter((o) => o && typeof o.t === 'string') : [];
  // Phone check: remember that Kerb has started with no signal (the offline test a driver does in aeroplane mode)
  S.offlineBootAt = navigator.onLine ? saved.offlineBootAt || null : clockNow().toISOString();
  if (!navigator.onLine) store.setSetting('offlineBootAt', S.offlineBootAt);
  S.events = await store.all();
  // ADR 0010: "Shift mode" (screen on) is now "Keep the screen on while on shift"
  if (saved.keepAwake === undefined && saved.shift !== undefined) { S.settings.keepAwake = !!saved.shift; store.setSetting('keepAwake', S.settings.keepAwake); }
  S.shiftSeenAt = saved.shiftSeenAt || null;
  refreshLog();
  restoreLogger(S.events);
  S.now = clockNow();
  checkShiftDue(); // a shift left on while Kerb was closed ends at its last sign of work
  for (const f of hooks.boot || []) await f(S);
  startWorker();
  loc = watch(onFix, onLocError);
  startTicking();
  document.addEventListener('visibilitychange', onResume);
  addEventListener('pageshow', (e) => { if (e.persisted) onResume(); });
  addEventListener('online', () => { S.online = true; render(); });
  addEventListener('offline', () => { S.online = false; render(); });
  // ADR 0013/0015: the phone's Back and Escape close the open sheet; a sheet left open by a reload leaves no live entry
  if (history.state && (history.state.kerbWhy || history.state.kerbTonight)) history.replaceState(null, '');
  addEventListener('popstate', () => {
    if (backPending) { settleBack(); return; } // the Back a Close asked for: the sheet is already shut
    if (S.tonight && S.tonight.row) shutTonightRow(); // ADR 0016: Back steps out of a row's detail first
    else if (S.why) shutWhy(); else if (S.tonight) shutTonight();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !(S.why || S.tonight)) return;
    e.preventDefault();
    if (S.why) A.closeWhy(); else if (S.tonight.row) A.closeTonightRow(); else A.closeTonight();
  });
  applyAwake();
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
    // ADR 0012: ask the worker to keep the photos for offline use, in their own cache, without holding up anything
    const urls = Object.values(S.photos).map((e) => `photos/${e.f}`);
    if (urls.length) navigator.serviceWorker.ready.then((reg) => reg.active && reg.active.postMessage({ type: 'photos', urls })).catch(() => {});
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
    awake: () => awakeHeld(),
    fix(p) { onFix({ lon: p.lon, lat: p.lat, speed: p.speed ?? null, accuracy: p.accuracy ?? 10, heading: p.heading ?? null, t: clockNow() }); },
  } : {}),
};

// A rotation or resize changes the map's width: repaint it at the new size without waiting for a fix (review fix)
addEventListener('resize', () => { if (S.view === 'detail') drawDetailMap(document.getElementById('app'), S).catch(() => {}); });

boot().catch((e) => {
  document.getElementById('app').textContent = `Kerb couldn't start: ${e.message}. Reload when you have signal.`;
  throw e;
});
