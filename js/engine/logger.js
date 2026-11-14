// Wait logger: a pure reducer over GPS fixes and driver taps (spec §7.5, §8b; ADR 0005).
// It emits an append-only event stream; waits are derived from it. Detection works with speed: null (iOS web):
// presence in a stand's queue zone is the stationarity test, never speed computed from 1 Hz fixes.
//   idle -> prompt (30 s in a zone) -> waiting (tap, or automatic after 120 s for well-placed usable stands)
//   waiting -> outcome (left the zone) -> idle (Fare / Left empty / unknown after 30 min)
import { distM, queueZone, headFirst, queueBearing, bearingDeg, nearestOnLine } from './geo.js';

export function initial() {
  return { mode: 'idle', stand: null, candidates: [], joinedAt: null, joinT: null, departAt: null, promptAt: null,
    dwell: null, approach: null, movePt: null, lastFix: null, report: null, lastSeen: null,
    outSince: null, outZ: null, fastSince: null, buf: [], anchor: null, creepSince: null, burst: null,
    suppressedIds: [], speedSeen: false, anchorPt: null, seenAt: null, startUncertain: false };
}

const iso = (t) => t.toISOString();
const sec = (a, b) => (a.getTime() - b.getTime()) / 1000;
const angle = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const byId = (ctx, id) => ctx.stands.find((x) => x.id === id);

function zonesAt(p, ctx) {
  const L = ctx.params.logger;
  const out = [];
  for (const s of ctx.stands) {
    if (!s.line || !ctx.usableIds.has(s.id)) continue;
    const z = queueZone(p, s, L);
    if (z.in) out.push({ id: s.id, z });
  }
  return out.sort((a, b) => a.z.lateral - b.z.lateral);
}

/** Which rank is the car at? (ADR 0006) Uses the latest good fix (accuracy <= 30 m, at most start_fix_max_age_s old):
 *  a stand whose queue zone holds it (on the kerb line first, then nearest; a chain's main stand wins ties within 5 m),
 *  else the nearest usable stand within start_nearest_m, else none. Never a list. */
export function detectStand(fix, now, ctx) {
  const L = ctx.params.logger;
  if (!fix) return { stand: null, detect: 'none', detect_m: null, candidates: [], near: [] };
  const p = [fix.lon, fix.lat];
  const usable = ctx.stands.filter((s) => ctx.usableIds.has(s.id) && (s.line || s.head));
  const dist = (s) => (s.line && s.line.length >= 2 ? nearestOnLine(p, s.line).distM : distM(p, s.head || s.line[0]));
  const ranked = usable.map((s) => ({ id: s.id, d: dist(s) })).sort((a, b) => a.d - b.d);
  const near = ranked.filter((x) => x.d <= L.near_radius_m).slice(0, 5).map((x) => x.id);
  const fresh = (now - fix.t) / 1000 <= L.start_fix_max_age_s && (fix.accuracy == null || fix.accuracy <= 30);
  if (!fresh) return { stand: null, detect: 'none', detect_m: null, candidates: [], near };
  const within = ranked.filter((x) => x.d <= L.start_nearest_m).map((x) => x.id);
  const zone = usable.filter((s) => s.line).map((s) => ({ id: s.id, z: queueZone(p, s, L) })).filter((x) => x.z.in)
    .map((x) => ({ id: x.id, onLine: x.z.s >= 0 && x.z.s <= x.z.L, lat: x.z.lateral }))
    .sort((a, b) => (b.onLine - a.onLine) || a.lat - b.lat);
  if (zone.length) {
    let best = zone[0];
    for (const c of ctx.chains || []) {
      const group = [c.main, ...c.overflow];
      const main = zone.find((z) => z.id === c.main);
      if (group.includes(best.id) && main && main !== best && main.onLine === best.onLine && main.lat - best.lat < 5) best = main;
    }
    return { stand: best.id, detect: 'zone', detect_m: Math.round(best.lat), candidates: [best.id, ...within.filter((id) => id !== best.id)], near };
  }
  if (ranked.length && ranked[0].d <= L.start_nearest_m) {
    return { stand: ranked[0].id, detect: 'nearest', detect_m: Math.round(ranked[0].d), candidates: within, near };
  }
  return { stand: null, detect: 'none', detect_m: null, candidates: [], near };
}

function partners(state, ctx) {
  const ids = [...state.candidates];
  for (const c of ctx.chains || []) {
    const group = [c.main, ...c.overflow];
    if (group.includes(state.stand)) ids.push(...group);
  }
  return [...new Set(ids)].filter((id) => id !== state.stand);
}

function cabsEst(stand, z, fix, L) {
  if (stand.tier !== 'A' || fix.accuracy == null || fix.accuracy > L.cabs_est_max_accuracy_m) return null;
  return Math.round(Math.max(0, z.s) / L.cab_m); // logged only; never displayed (ADR 0005)
}

function joinEvent(state, input, ctx, extra = {}) {
  const stand = input.stand || state.stand;
  const shown = ctx.shown(stand);
  const assisted = state.mode === 'prompt' && (!input.stand || input.stand === state.stand);
  return { type: 'join', t: iso(input.t), stand, source: extra.source || (assisted ? 'assist' : 'manual'), shown, versions: ctx.versions,
    gps_accuracy_m: state.lastFix ? state.lastFix.accuracy ?? null : null,
    followed_top_pick: !!(shown && shown.rank_order && shown.rank_order[0] === stand), ...extra };
}

const waitingState = (state, stand, joinedAt, seenAt) => ({ ...state, mode: 'waiting', stand, joinedAt, joinT: iso(joinedAt), departAt: null,
  promptAt: null, dwell: null, report: null, lastSeen: seenAt, outSince: null, outZ: null, fastSince: null, buf: [], anchor: null, creepSince: null,
  burst: null, speedSeen: false, anchorPt: null, seenAt: seenAt, suppressedIds: [] });

const toIdle = (state, extra = {}) => ({ ...state, mode: 'idle', stand: null, candidates: [], joinedAt: null, joinT: null, departAt: null,
  promptAt: null, dwell: null, report: null, lastSeen: null, outSince: null, outZ: null, fastSince: null, buf: [], anchor: null, creepSince: null,
  burst: null, asserted: false, anchorPt: null, seenAt: null, suppressedIds: [], ...extra });

function suppressAt(p, stand, ctx) {
  const ids = new Set(stand ? [stand] : []);
  if (p) for (const c of zonesAt(p, ctx)) ids.add(c.id);
  return [...ids];
}

function trackApproach(s, p) {
  if (!s.movePt) { s.movePt = p; return; }
  if (distM(s.movePt, p) >= 15) { s.approach = bearingDeg(s.movePt, p); s.movePt = p; }
}

/** ADR 0005 gating: Auto on, the stand placed to ±auto_max_uncertainty_m, and not approached from the wrong way. */
function canAutoJoin(dwell, stand, ctx) {
  const L = ctx.params.logger;
  const qb = queueBearing(headFirst(stand.line, stand.head));
  const opposite = dwell.approach != null && qb != null && angle(dwell.approach, qb) > L.opposite_heading_deg;
  return !!ctx.auto && stand.uncertainty_m != null && stand.uncertainty_m <= L.auto_max_uncertainty_m && !opposite;
}

/** For the idle bar (review fix 2026-11-14): the stand the current stop is timed against and whether it will start a
 * wait by itself, from the same gating as onFixIdle (suppression after an answer or discard included). Null when
 * Auto is off or there is no stop in a queue zone. */
export function autoStartFor(state, ctx) {
  if (!ctx.auto || state.mode !== 'idle' || !state.dwell) return null;
  const stand = byId(ctx, state.dwell.stand);
  if (!stand) return null;
  return { stand: stand.id, will: !state.suppressedIds.includes(stand.id) && canAutoJoin(state.dwell, stand, ctx) };
}

function onFixIdle(state, s, fix, p, gap, ctx) {
  const L = ctx.params.logger;
  const good = fix.accuracy == null || fix.accuracy <= 30;
  if (gap) s.dwell = null;
  if (s.suppressedIds.length && good) {
    const here = new Set(zonesAt(p, ctx).map((c) => c.id));
    if (!s.suppressedIds.some((id) => here.has(id))) s.suppressedIds = []; // a good fix outside them: the car has moved on
  }
  if (s.dwell) {
    const z = queueZone(p, byId(ctx, s.dwell.stand), L);
    if (z.in && good) s.dwell = { ...s.dwell, lastIn: fix.t, outSince: null, z };
    else {
      const outSince = s.dwell.outSince || fix.t;
      s.dwell = sec(fix.t, outSince) > L.dwell_tolerance_s ? null : { ...s.dwell, outSince };
    }
  }
  if (!s.dwell) {
    if (state.mode === 'prompt') { s.mode = 'idle'; s.stand = null; s.candidates = []; s.promptAt = null; }
    trackApproach(s, p);
    const cands = good ? zonesAt(p, ctx) : [];
    if (cands.length) {
      // The stop began before Kerb saw it when this is the first fix since Kerb opened or since a gap (ADR 0005 review).
      const unseenStart = !state.lastFix || gap;
      s.dwell = { stand: cands[0].id, since: fix.t, lastIn: fix.t, outSince: null, cands: cands.map((c) => c.id), z: cands[0].z,
        approach: s.approach, startUncertain: unseenStart };
    }
  }
  if (!s.dwell || s.suppressedIds.includes(s.dwell.stand)) return { state: s, events: [] };
  const stand = byId(ctx, s.dwell.stand);
  const dur = sec(s.dwell.lastIn, s.dwell.since); // only time actually seen in the zone counts
  const auto = canAutoJoin(s.dwell, stand, ctx);
  const inNow = s.dwell.lastIn === fix.t;
  if (auto && inNow && dur >= L.auto_join_s) {
    const z = s.dwell.z;
    const est = cabsEst(stand, z, fix, L);
    const ev = joinEvent({ ...s, mode: 'idle' }, { stand: stand.id, t: s.dwell.since }, ctx,
      { source: 'auto', detected_at: iso(fix.t), zone_dist_m: Math.round(z.lateral), ...(est != null ? { cabs_ahead_est: est } : {}),
        ...(s.dwell.startUncertain ? { start_uncertain: true } : {}) });
    const w = waitingState(s, stand.id, s.dwell.since, fix.t);
    w.candidates = s.dwell.cands;
    return { state: w, events: [ev] };
  }
  if (s.mode === 'idle' && dur >= L.prompt_s && ctx.auto && !auto) { // ADR 0006: Manual has no prompt; Auto asks only where it can't start itself
    return { state: { ...s, mode: 'prompt', stand: s.dwell.stand, candidates: s.dwell.cands, promptAt: fix.t }, events: [] };
  }
  if (s.mode === 'prompt' && !auto && sec(fix.t, s.promptAt) > L.prompt_expire_s) {
    return { state: { ...s, mode: 'idle', stand: null, candidates: [], promptAt: null, suppressedIds: [s.dwell.stand] }, events: [] };
  }
  return { state: s, events: [] };
}

function onFixWaiting(state, s, fix, p, ctx) {
  const L = ctx.params.logger;
  const stand = state.stand ? byId(ctx, state.stand) : null;
  const good = fix.accuracy == null || fix.accuracy <= 30;
  const events = [];
  const hasLine = !!(stand && stand.line && stand.line.length >= 2);
  const z = hasLine ? queueZone(p, stand, L) : null;
  const tail = hasLine ? z.L + L.zone_tail_factor * Math.max(z.L, 20) : 0;
  const lateralMax = L.zone_lateral_m + Math.min((stand && stand.uncertainty_m) || 0, 15);
  // A tapped wait where the car is outside the mapped zone (tier C, "Other stand"), or with no kerb line at all
  // (rank not on Kerb's list, single-point ranks), is anchored on where the driver was when it started (ADR 0005/0006).
  if (state.anchorPt === undefined && good) s.anchorPt = state.asserted && (!hasLine || !z.in) ? p : false; // decided once
  const anchored = !!s.anchorPt;
  if (!anchored && !hasLine) return { state: s, events };
  const inside = anchored ? distM(p, s.anchorPt) <= lateralMax + 15 : z.in;
  const beyond = anchored ? distM(p, s.anchorPt) - (lateralMax + 15)
    : Math.max(z.lateral - lateralMax, -L.zone_head_margin_m - z.s, z.s - tail, 0);
  if (inside && good) {
    s.lastSeen = fix.t; s.outSince = null; s.outZ = null;
    if (!state.seenAt || sec(fix.t, state.seenAt) >= L.seen_every_s) { // sparse evidence for a reload (never a track)
      events.push({ type: 'seen', t: iso(fix.t), stand: state.stand });
      s.seenAt = fix.t;
    }
  } else if (!inside && good && !s.outSince) { s.outSince = fix.t; s.outZ = z; }
  const far = good && !inside && (anchored ? distM(p, s.anchorPt) > L.depart_far_m
    : z.lateral > L.depart_far_m || z.s < -L.depart_far_m || z.s > tail + L.depart_far_m);
  s.fastSince = fix.speed != null && fix.speed > L.depart_speed_mps ? state.fastSince || fix.t : null;
  // Leaving needs as much evidence as staying: 30 s outside, or 10 s outside once clearly displaced (drift stays near).
  const outFor = s.outSince ? sec(fix.t, s.outSince) : 0;
  const outLong = s.outSince && good && (outFor >= L.depart_out_s || (outFor >= L.depart_out_moved_s && beyond >= L.depart_moved_m));
  const fast = s.fastSince && sec(fix.t, s.fastSince) >= L.depart_speed_s;
  if (outLong || far || fast) {
    let t = [s.outSince, s.fastSince, fix.t].filter(Boolean).reduce((a, b) => (a < b ? a : b));
    const exit = s.outZ || z;
    let leftVia = anchored || !exit ? 'unknown' : exit.s < -L.zone_head_margin_m ? 'head' : exit.s > tail ? 'tail' : 'side';
    const uncertain = !!(state.lastSeen && sec(t, state.lastSeen) > L.gap_s);
    if (uncertain) { t = state.lastSeen; leftVia = 'unknown'; }
    events.push({ type: 'depart', t: iso(t), stand: state.stand, left_via: leftVia,
      reason: far ? 'far' : outLong ? 'out_of_zone' : 'speed', ...(uncertain ? { uncertain: true } : {}) });
    return { state: { ...s, mode: 'outcome', departAt: t, buf: [], anchor: null, creepSince: null, burst: null }, events };
  }
  // Moving up the rank (ADR 0005). Creeps never end the wait.
  // With a speed reading (Doppler: Android, iPhones while moving) a creep is a short burst of slow movement, integrated
  // to metres; once a device has reported speed in this wait, only this method is used. Without speed, a sustained
  // drop in the 30 s median distance to the head is logged as approximate only (measured: about 6 in 10 one-cab moves
  // found, about one fake per 10 minutes on correlated urban noise).
  if (fix.speed != null) s.speedSeen = true;
  if (!hasLine) return { state: s, events }; // moving up is measured along a kerb line only
  const b = state.burst;
  if (fix.speed != null && fix.speed >= L.creep_speed_mps && inside) {
    const dt = state.lastFix ? Math.min(2, Math.max(0, sec(fix.t, state.lastFix.t))) : 1;
    s.burst = { since: b ? b.since : fix.t, dist: (b ? b.dist : 0) + fix.speed * dt, lastMove: fix.t };
  } else if (b) {
    if (sec(fix.t, b.lastMove) >= 2) { // any later fix, with speed or without, closes the burst
      if (inside && b.dist >= L.creep_speed_min_m && b.dist <= L.creep_speed_max_m) { // a burst that left the zone is a departure
        const est = cabsEst(stand, { s: z.s }, fix, L);
        events.push({ type: 'creep', t: iso(b.since), stand: state.stand, method: 'speed', moved_m: Math.round(b.dist), d_head_m: Math.round(z.s),
          accuracy: fix.accuracy ?? null, ...(est != null ? { cabs_ahead_est: est } : {}) });
      }
      s.burst = null;
    } else if (fix.speed != null) {
      const dt = state.lastFix ? Math.min(2, Math.max(0, sec(fix.t, state.lastFix.t))) : 1;
      s.burst = { ...b, dist: b.dist + fix.speed * dt };
    }
  } else if (!s.speedSeen && fix.speed == null && z.in && (fix.accuracy == null || fix.accuracy <= L.creep_max_accuracy_m)) {
    s.buf = [...state.buf, { t: fix.t, s: z.s }].filter((q) => sec(fix.t, q.t) <= L.creep_window_s).slice(-30);
    if (s.buf.length >= 5 && sec(fix.t, s.buf[0].t) >= L.creep_window_s / 2) {
      const m = median(s.buf.map((q) => q.s));
      if (s.anchor == null) s.anchor = m;
      else if (m <= s.anchor - L.creep_min_m) {
        s.creepSince = state.creepSince || fix.t;
        if (sec(fix.t, s.creepSince) >= L.creep_hold_s) {
          const est = cabsEst(stand, { s: m }, fix, L);
          events.push({ type: 'creep', t: iso(s.creepSince), stand: state.stand, method: 'position', approximate: true, d_head_m: Math.round(m),
            moved_m: Math.round(s.anchor - m), accuracy: fix.accuracy ?? null, ...(est != null ? { cabs_ahead_est: est } : {}) });
          s.anchor = m;
          s.creepSince = null;
        }
      } else s.creepSince = null;
    }
  }
  return { state: s, events };
}

function onFix(state, fix, ctx) {
  const L = ctx.params.logger;
  const p = [fix.lon, fix.lat];
  const gap = !!(state.lastFix && sec(fix.t, state.lastFix.t) > L.gap_s);
  const s = { ...state, lastFix: fix };
  if (state.mode === 'idle' || state.mode === 'prompt') return onFixIdle(state, s, fix, p, gap, ctx);
  if (state.mode === 'waiting') return onFixWaiting(state, s, fix, p, ctx);
  // outcome: still watching for the next rank, so a driver who never answers does not go blind (ADR 0005 review)
  const r = onFixIdle({ ...state, mode: 'idle' }, { ...s, mode: 'idle' }, fix, p, gap, ctx);
  if (r.events.some((e) => e.type === 'join')) return { state: r.state, events: [outcome(state, fix.t, 'unknown', 'new_join'), ...r.events] };
  return { state: { ...s, dwell: r.state.dwell, approach: r.state.approach, movePt: r.state.movePt, suppressedIds: r.state.suppressedIds }, events: [] };
}

function outcome(state, t, value, source) {
  const ev = { type: 'outcome', t: iso(t), stand: state.stand, outcome: value, source };
  // Closing an unanswered wait late (new join, timeout): the wait is only known to have lasted until last seen.
  if (value === 'unknown' && state.mode === 'waiting' && state.lastSeen) ev.end_hint = iso(state.lastSeen);
  return ev;
}

/** step(state, input, ctx) -> {state, events}. Every input carries `t` (Date); fixes carry it in `fix.t`.
 *  ctx.auto enables automatic joins (Settings: "Log rank waits automatically"). */
export function step(state, input, ctx) {
  const L = ctx.params.logger;
  switch (input.type) {
    case 'fix': return onFix(state, input.fix, ctx);
    case 'tick': {
      if (state.mode === 'prompt' && sec(input.t, state.promptAt) > L.prompt_expire_s) {
        return { state: { ...state, mode: 'idle', stand: null, candidates: [], promptAt: null, suppressedIds: [state.dwell ? state.dwell.stand : state.stand] }, events: [] };
      }
      if (state.mode === 'outcome' && sec(input.t, state.departAt) >= L.outcome_timeout_s) {
        return { state: toIdle(state), events: [outcome(state, input.t, 'unknown', 'timeout')] };
      }
      return { state, events: [] };
    }
    case 'dismiss':
      return state.mode === 'prompt' ? { state: { ...state, mode: 'idle', stand: null, candidates: [], promptAt: null, suppressedIds: [state.stand] }, events: [] } : { state, events: [] };
    case 'tap_join': {
      if (!input.stand && !state.stand) return { state, events: [] };
      const events = [];
      if (state.mode === 'waiting' || state.mode === 'outcome') events.push(outcome(state, input.t, 'unknown', 'new_join'));
      const j = joinEvent(state.mode === 'waiting' || state.mode === 'outcome' ? { ...state, mode: 'idle' } : state, input, ctx);
      events.push(j);
      const w = waitingState(state, j.stand, input.t, input.t);
      w.candidates = state.candidates;
      w.asserted = true;
      w.anchorPt = undefined; // set from the next fix: the tap position, if the car is outside the mapped zone
      return { state: w, events };
    }
    case 'tap_start': { // ADR 0006: "Start rank timer" / "Start now" — the rank is detected, never picked from a list
      if (state.mode === 'waiting' || state.mode === 'outcome') return { state, events: [] };
      const det = detectStand(state.lastFix, input.t, ctx);
      const observed = state.dwell && state.dwell.stand === det.stand && !state.dwell.startUncertain;
      const t = ctx.auto && det.stand && observed ? state.dwell.since : input.t; // Auto "Start now" keeps the first minute
      const shown = det.stand ? ctx.shown(det.stand) : null;
      const ev = { type: 'join', t: iso(t), stand: det.stand, source: 'start', detect: det.detect,
        ...(det.detect_m != null ? { detect_m: det.detect_m } : {}), ...(det.detect === 'none' ? { near: det.near } : {}),
        shown, versions: ctx.versions, gps_accuracy_m: state.lastFix ? state.lastFix.accuracy ?? null : null,
        followed_top_pick: !!(det.stand && shown && shown.rank_order && shown.rank_order[0] === det.stand) };
      const w = waitingState(state, det.stand, t, input.t);
      w.candidates = det.candidates;
      w.asserted = true;
      // anchor on the tap position only when that fix is fresh and accurate; otherwise the next good fix decides (review fix)
      const f = state.lastFix;
      const usableFix = f && (input.t - f.t) / 1000 <= ctx.params.logger.start_fix_max_age_s && (f.accuracy == null || f.accuracy <= 30);
      w.anchorPt = det.detect === 'zone' || !usableFix ? undefined : [f.lon, f.lat];
      return { state: w, events: [ev] };
    }
    case 'tap_still': { // "Still waiting": the departure was wrong; the timer carries on (ADR 0006)
      if (state.mode !== 'outcome') return { state, events: [] };
      const here = state.lastFix ? [state.lastFix.lon, state.lastFix.lat] : null;
      // re-anchor where the car is now, so a queue longer than the mapped zone does not raise the question again (review fix)
      return { state: { ...state, mode: 'waiting', departAt: null, outSince: null, outZ: null, fastSince: null, lastSeen: input.t, seenAt: input.t,
        anchorPt: here || state.anchorPt },
      events: [{ type: 'resume', t: iso(input.t), stand: state.stand }] };
    }
    case 'tap_discard': {
      if (state.mode !== 'waiting' && state.mode !== 'outcome') return { state, events: [] };
      const p = state.lastFix ? [state.lastFix.lon, state.lastFix.lat] : null;
      return { state: toIdle(state, { suppressedIds: suppressAt(p, state.stand, ctx) }),
        events: [{ type: 'void', t: iso(input.t), wait: state.joinT, stand: state.stand, source: 'bar' }] };
    }
    case 'tap_switch': { // "Other stand" cycles the candidates; "Choose rank" passes the stand explicitly (ADR 0006)
      const next = input.stand || partners(state, ctx)[0];
      if (!next) return { state, events: [] };
      if (state.mode === 'prompt') return { state: { ...state, stand: next, candidates: [...state.candidates.filter((c) => c !== next), state.stand].filter(Boolean) }, events: [] };
      if (state.mode === 'waiting') {
        return { state: { ...state, stand: next, candidates: [...state.candidates.filter((c) => c !== next), state.stand].filter(Boolean), asserted: true, anchorPt: undefined },
          events: [{ type: 'switch_stand', t: iso(input.t), from: state.stand, stand: next }] };
      }
      return { state, events: [] };
    }
    case 'report':
      if (state.mode !== 'waiting') return { state, events: [] };
      return { state: { ...state, report: { cabsAhead: input.cabsAhead ?? null, people: input.people ?? null, t: input.t } },
        events: [{ type: 'report', t: iso(input.t), stand: state.stand, cabsAhead: input.cabsAhead ?? null, people: input.people ?? null }] };
    case 'tap_fare_in':
      if (state.mode !== 'waiting') return { state, events: [] };
      return { state: toIdle(state, { suppressedIds: [state.stand] }), events: [{ type: 'fare_in', t: iso(input.t), stand: state.stand }, outcome(state, input.t, 'fare', 'fare_in')] };
    case 'tap_fare':
    case 'tap_left':
      if (state.mode !== 'waiting' && state.mode !== 'outcome') return { state, events: [] };
      return { state: toIdle(state, { suppressedIds: state.mode === 'waiting' ? [state.stand] : [] }),
        events: [outcome(state, input.t, input.type === 'tap_fare' ? 'fare' : 'left_empty', 'tap')] };
    case 'cancel':
      if (state.mode !== 'waiting') return { state, events: [] };
      return { state: toIdle(state, { suppressedIds: [state.stand] }), events: [{ type: 'cancel', t: iso(input.t), stand: state.stand }] };
    default:
      throw new Error(`logger.step: unknown input type ${JSON.stringify(input.type)}`);
  }
}

const DRIVER = new Set(['report', 'switch_stand', 'fare_in', 'confirm', 'edit']);

/** Waits derived from the event stream (spec §7.5, ADR 0005). Unfinished waits are left out; cancelled and voided
 *  waits are dropped; review edits are applied; auto waits are unconfirmed until the driver touches them. */
export function deriveWaits(events) {
  const waits = [];
  let w = null;
  const close = () => { delete w._fareIn; delete w._depart; waits.push(w); w = null; };
  for (const e of events) {
    if (e.type === 'join') {
      w = { stand: e.stand, joined_at: e.t, ended_at: null, wait_min: null, outcome: null, censored: null,
        followed_top_pick: e.followed_top_pick, join_source: e.source, cabs_ahead: null, people: null,
        shown: e.shown, versions: e.versions, gps_accuracy_m: e.gps_accuracy_m, end_uncertain: false,
        confirmed: e.source !== 'auto', detected_at: e.detected_at || null, creeps: 0, left_via: null, start_uncertain: !!e.start_uncertain,
        detect: e.detect || (e.source === 'auto' ? 'auto' : null), near: e.near || null,
        cabs_ahead_est: e.cabs_ahead_est ?? null, _fareIn: null, _depart: null };
    } else if (!w) {
      continue;
    } else if (e.type === 'report') {
      w.cabs_ahead = e.cabsAhead; w.people = e.people; w.confirmed = true;
    } else if (e.type === 'switch_stand') {
      w.stand = e.stand; w.confirmed = true;
    } else if (e.type === 'creep') {
      w.creeps++;
    } else if (e.type === 'resume') { // "Still waiting": the departure did not happen
      w._depart = null; w.left_via = null; w.end_uncertain = false; w.confirmed = true;
    } else if (e.type === 'fare_in') {
      w._fareIn = e.t;
    } else if (e.type === 'depart') {
      w._depart = e.t;
      w.left_via = e.left_via || null;
      if (e.uncertain) w.end_uncertain = true;
    } else if (e.type === 'cancel' || (e.type === 'void' && e.wait === w.joined_at)) {
      w = null;
    } else if (e.type === 'outcome') {
      w.ended_at = w._fareIn || w._depart || e.end_hint || e.t;
      w.wait_min = (Date.parse(w.ended_at) - Date.parse(w.joined_at)) / 60000;
      w.outcome = e.outcome;
      // An uncertain end only bounds the wait from below, so even a fare counts as censored.
      // Unseen start or uncertain end: the wait lasted at least this long, so even a fare counts as censored.
      w.censored = e.outcome !== 'fare' || w.end_uncertain || w.start_uncertain;
      if (e.source === 'tap' || e.source === 'fare_in') w.confirmed = true;
      close();
    }
  }
  // Review events (Log screen) refer to a finished wait by its join time.
  const byJoin = new Map(waits.map((x) => [x.joined_at, x]));
  const voided = new Set();
  for (const e of events) {
    const x = byJoin.get(e.wait);
    if (!x) continue;
    if (e.type === 'void') voided.add(e.wait);
    else if (e.type === 'confirm') x.confirmed = true;
    else if (e.type === 'edit') {
      x.confirmed = true;
      if (e.field === 'stand') x.stand = e.value;
      if (e.field === 'outcome' && ['fare', 'left_empty', 'unknown'].includes(e.value)) {
        x.outcome = e.value;
        x.censored = e.value !== 'fare' || x.end_uncertain || x.start_uncertain;
      }
    }
  }
  return waits.filter((x) => !voided.has(x.joined_at));
}

export { DRIVER as DRIVER_EVENTS };
