// Wait logger: a pure reducer over driver taps and GPS fixes (spec §7.5). Emits an append-only event stream;
// waits are derived from it. A join is never recorded without a tap.
import { distM, nearestOnLine } from './geo.js';

export function initial() {
  return { mode: 'idle', stand: null, candidates: [], joinedAt: null, departAt: null, promptAt: null,
    stillSince: null, suppressed: false, fastSince: null, lastFix: null, report: null, lastSeen: null };
}

const iso = (t) => t.toISOString();
const sec = (a, b) => (a.getTime() - b.getTime()) / 1000;

function speedOf(fix, last) {
  if (fix.speed != null && Number.isFinite(fix.speed)) return fix.speed;
  if (!last) return 0;
  const dt = sec(fix.t, last.t);
  return dt > 0 ? distM([fix.lon, fix.lat], [last.lon, last.lat]) / dt : 0;
}

function nearStands(p, ctx) {
  const L = ctx.params.logger;
  const out = [];
  for (const s of ctx.stands) {
    if (!s.line || !ctx.usableIds.has(s.id)) continue;
    const d = nearestOnLine(p, s.line).distM;
    if (d <= L.join_radius_m + (s.uncertainty_m || 0)) out.push({ id: s.id, d });
  }
  return out.sort((a, b) => a.d - b.d).map((x) => x.id);
}

function partners(state, ctx) {
  const ids = [...state.candidates];
  for (const c of ctx.chains || []) {
    const group = [c.main, ...c.overflow];
    if (group.includes(state.stand)) ids.push(...group);
  }
  return [...new Set(ids)].filter((id) => id !== state.stand);
}

function joinEvent(state, input, ctx) {
  const stand = input.stand || state.stand;
  const shown = ctx.shown(stand);
  const assisted = state.mode === 'prompt' && (!input.stand || input.stand === state.stand);
  return { type: 'join', t: iso(input.t), stand, source: assisted ? 'assist' : 'manual', shown, versions: ctx.versions,
    gps_accuracy_m: state.lastFix ? state.lastFix.accuracy ?? null : null,
    followed_top_pick: !!(shown && shown.rank_order && shown.rank_order[0] === stand) };
}

const toIdle = (state, extra = {}) => ({ ...state, mode: 'idle', stand: null, candidates: [], joinedAt: null, departAt: null,
  promptAt: null, fastSince: null, report: null, lastSeen: null, ...extra });

function onFix(state, fix, ctx) {
  const L = ctx.params.logger;
  const p = [fix.lon, fix.lat];
  const v = speedOf(fix, state.lastFix);
  const s = { ...state, lastFix: fix };
  const events = [];
  if (state.mode === 'idle' || state.mode === 'prompt') {
    if (v >= L.stationary_mps) return { state: toIdle(s, { stillSince: null, suppressed: false }), events };
    s.stillSince = s.stillSince || fix.t;
    if (state.mode === 'prompt') {
      if (sec(fix.t, state.promptAt) > L.prompt_expire_s) return { state: toIdle(s, { suppressed: true }), events };
      return { state: s, events };
    }
    if (!s.suppressed && sec(fix.t, s.stillSince) >= L.stationary_s) {
      const cands = nearStands(p, ctx);
      if (cands.length) return { state: { ...s, mode: 'prompt', candidates: cands, stand: cands[0], promptAt: fix.t }, events };
    }
    return { state: s, events };
  }
  if (state.mode === 'waiting') {
    const stand = ctx.stands.find((x) => x.id === state.stand);
    const far = stand && stand.line ? nearestOnLine(p, stand.line).distM > L.depart_m : false;
    if (!far) s.lastSeen = fix.t;
    s.fastSince = v > L.depart_mps ? state.fastSince || fix.t : null;
    if (far || (s.fastSince && sec(fix.t, s.fastSince) >= L.depart_s)) {
      let t = s.fastSince || fix.t;
      // After a gap in fixes (driver switched to the nav app) the departure happened somewhere in the gap:
      // stamp it at the last sighting at the stand and mark it uncertain, never at the late evidence.
      const uncertain = !!(state.lastSeen && sec(t, state.lastSeen) > (L.gap_s ?? 120));
      if (uncertain) t = state.lastSeen;
      events.push({ type: 'depart', t: iso(t), stand: state.stand, ...(uncertain ? { uncertain: true } : {}) });
      return { state: { ...s, mode: 'outcome', departAt: t, fastSince: null }, events };
    }
  }
  return { state: s, events };
}

function outcome(state, t, value, source) {
  const ev = { type: 'outcome', t: iso(t), stand: state.stand, outcome: value, source };
  // Closing an unanswered wait late (new join, timeout): the wait is only known to have lasted until last seen.
  if (value === 'unknown' && state.mode === 'waiting' && state.lastSeen) ev.end_hint = iso(state.lastSeen);
  return ev;
}

/** step(state, input, ctx) -> {state, events}. Every input carries `t` (Date); fixes carry it in `fix.t`. */
export function step(state, input, ctx) {
  const L = ctx.params.logger;
  switch (input.type) {
    case 'fix': return onFix(state, input.fix, ctx);
    case 'tick': {
      if (state.mode === 'prompt' && sec(input.t, state.promptAt) > L.prompt_expire_s) return { state: toIdle(state, { suppressed: true }), events: [] };
      if (state.mode === 'outcome' && sec(input.t, state.departAt) >= L.outcome_timeout_s) {
        return { state: toIdle(state), events: [outcome(state, input.t, 'unknown', 'timeout')] };
      }
      return { state, events: [] };
    }
    case 'dismiss':
      return state.mode === 'prompt' ? { state: toIdle(state, { suppressed: true }), events: [] } : { state, events: [] };
    case 'tap_join': {
      if (!input.stand && !state.stand) return { state, events: [] };
      const events = [];
      if (state.mode === 'waiting' || state.mode === 'outcome') events.push(outcome(state, input.t, 'unknown', 'new_join'));
      const j = joinEvent(state.mode === 'waiting' || state.mode === 'outcome' ? { ...state, mode: 'idle' } : state, input, ctx);
      events.push(j);
      return { state: { ...state, mode: 'waiting', stand: j.stand, joinedAt: input.t, departAt: null, promptAt: null, fastSince: null, report: null, lastSeen: input.t }, events };
    }
    case 'tap_switch': {
      const next = partners(state, ctx)[0];
      if (!next) return { state, events: [] };
      if (state.mode === 'prompt') return { state: { ...state, stand: next, candidates: [...state.candidates.filter((c) => c !== next), state.stand] }, events: [] };
      if (state.mode === 'waiting') {
        return { state: { ...state, stand: next, candidates: [...state.candidates.filter((c) => c !== next), state.stand] },
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
      return { state: toIdle(state), events: [{ type: 'fare_in', t: iso(input.t), stand: state.stand }, outcome(state, input.t, 'fare', 'fare_in')] };
    case 'tap_fare':
    case 'tap_left':
      if (state.mode !== 'waiting' && state.mode !== 'outcome') return { state, events: [] };
      return { state: toIdle(state), events: [outcome(state, input.t, input.type === 'tap_fare' ? 'fare' : 'left_empty', 'tap')] };
    case 'cancel':
      if (state.mode !== 'waiting') return { state, events: [] };
      return { state: toIdle(state), events: [{ type: 'cancel', t: iso(input.t), stand: state.stand }] };
    default:
      throw new Error(`logger.step: unknown input type ${JSON.stringify(input.type)}`);
  }
}

/** Waits derived from the event stream. Unfinished waits are left out; cancelled waits are dropped. */
export function deriveWaits(events) {
  const waits = [];
  let w = null;
  for (const e of events) {
    if (e.type === 'join') {
      w = { stand: e.stand, joined_at: e.t, ended_at: null, wait_min: null, outcome: null, censored: null,
        followed_top_pick: e.followed_top_pick, join_source: e.source, cabs_ahead: null, people: null,
        shown: e.shown, versions: e.versions, gps_accuracy_m: e.gps_accuracy_m, end_uncertain: false, _fareIn: null, _depart: null };
    } else if (!w) {
      continue;
    } else if (e.type === 'report') {
      w.cabs_ahead = e.cabsAhead; w.people = e.people;
    } else if (e.type === 'switch_stand') {
      w.stand = e.stand;
    } else if (e.type === 'fare_in') {
      w._fareIn = e.t;
    } else if (e.type === 'depart') {
      w._depart = e.t;
      if (e.uncertain) w.end_uncertain = true;
    } else if (e.type === 'cancel') {
      w = null;
    } else if (e.type === 'outcome') {
      w.ended_at = w._fareIn || w._depart || e.end_hint || e.t;
      w.wait_min = (Date.parse(w.ended_at) - Date.parse(w.joined_at)) / 60000;
      w.outcome = e.outcome;
      // An uncertain end only bounds the wait from below, so even a fare counts as censored.
      w.censored = e.outcome !== 'fare' || w.end_uncertain;
      delete w._fareIn; delete w._depart;
      waits.push(w);
      w = null;
    }
  }
  return waits;
}
