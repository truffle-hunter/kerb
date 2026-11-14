// Shifts (ADR 0010): the driver declares the start with one tap; the end is automatic, backdated to the last sign of
// work, with an undo. Shifts are derived from three append-only events (shift_start, shift_end, shift_resume) that
// carry no `wait` field, so deriveWaits and older readers of kerb-log/1 pass over them. Pure functions, unit-tested.
import { distM } from './geo.js';

const MIN = 60000;
const ms = (x) => (typeof x === 'number' ? x : Date.parse(x));
const iso = (t) => new Date(t).toISOString();
const SHIFT_TYPES = new Set(['shift_start', 'shift_end', 'shift_resume']);

/** Shifts in order: [{start, end | null, end_source, uncertain, end_written}]. end_written is when the end was decided
 * (an automatic end is backdated, so a shift found over 10 h later ended long before it was written). A second start
 * while on is ignored; a resume undoes the end it names if that shift is still the latest. */
export function deriveShifts(events) {
  const out = [];
  for (const e of events) {
    const last = out[out.length - 1];
    if (e.type === 'shift_start') {
      if (!last || last.end) out.push({ start: e.t, end: null, end_source: null, uncertain: false, end_written: null });
    } else if (e.type === 'shift_end') {
      // an end from before this shift began belongs to an older one (a restore orders events by when they were written)
      if (last && !last.end && ms(e.t) >= ms(last.start)) {
        last.end = e.t; last.end_source = e.source; last.uncertain = !!e.uncertain; last.end_written = e.detected_at || e.t;
      }
    } else if (e.type === 'shift_resume') {
      if (last && last.end && last.end === e.end) { last.end = null; last.end_source = null; last.uncertain = false; last.end_written = null; }
    }
  }
  return out;
}

/** The shift that is on now, or null. */
export const currentShift = (shifts) => {
  const last = shifts[shifts.length - 1];
  return last && !last.end ? last : null;
};

/** Is this fix a sign of work? An open wait is; a move of active_move_m from the anchor is (and moves the anchor); a
 * still car never is. With no usable fix Kerb can't tell, so time on screen counts. The anchor lives in memory only. */
const COARSE_M = 30; // the logger's "good fix" bar: a parked phone indoors jumps hundreds of metres on coarse fixes
export function activityOf({ anchor, fix, mode, locOk }, P) {
  const here = fix ? [fix.lon, fix.lat] : null;
  if (mode === 'waiting' || mode === 'outcome') return { active: true, anchor: here || anchor };
  if (!locOk || !here) return { active: true, anchor };
  if (fix.accuracy != null && fix.accuracy > COARSE_M) return { active: false, anchor }; // can't tell a move from noise
  if (!anchor) return { active: false, anchor: here };
  return distM(anchor, here) >= P.active_move_m ? { active: true, anchor: here } : { active: false, anchor };
}

/** The last sign of work in a shift, in ms: its start, any logger event in it (an automatic join counts from when it
 * was detected), "Still on shift", or the heartbeat Kerb keeps while it sees work. */
export function lastActivity(events, shift, seenAt) {
  const from = ms(shift.start);
  let last = from;
  for (const e of events) {
    if (SHIFT_TYPES.has(e.type) && e.type !== 'shift_resume') continue;
    const t = Math.max(ms(e.t), e.detected_at ? ms(e.detected_at) : -Infinity);
    if (t >= from && t > last) last = t;
  }
  if (seenAt != null && ms(seenAt) > last) last = ms(seenAt);
  return last;
}

/** Should the shift end now, and when did it end? After idle_end_min with no sign of work it ended at the last one;
 * at max_shift_h it ends whatever happens. A clock that went back never ends a shift. */
export function shiftDue(shift, lastActiveMs, nowMs, P) {
  if (!shift || shift.end) return null;
  if (nowMs - lastActiveMs >= P.idle_end_min * MIN) return { t: iso(lastActiveMs), source: 'idle' };
  const cap = ms(shift.start) + P.max_shift_h * 60 * MIN;
  if (nowMs >= cap) return { t: iso(Math.min(lastActiveMs, cap)), source: 'cap' };
  return null;
}

/** Each wait with the shift it overlaps ({shift: start}), or legacy (before the first shift ever: counted as before),
 * or off_shift (outside every shift: kept, never counted). */
export function tagWaits(waits, shifts) {
  if (!shifts.length) return waits.map((w) => ({ ...w, shift: null, off_shift: false }));
  const first = ms(shifts[0].start);
  return waits.map((w) => {
    const a = ms(w.joined_at);
    const b = w.ended_at ? ms(w.ended_at) : Number.isFinite(w.wait_min) ? a + w.wait_min * MIN : Infinity; // open: still going
    if (b < first) return { ...w, shift: null, off_shift: false };
    const s = shifts.findLast((x) => a <= (x.end ? ms(x.end) : Infinity) && b >= ms(x.start)); // the later shift wins
    return s ? { ...w, shift: s.start, off_shift: false } : { ...w, shift: null, off_shift: true };
  });
}

/** One shift added up from its tagged waits: minutes on shift (to now while on) and at ranks, waits, fares, answered,
 * the longest and shortest wait. */
export function shiftSummary(shift, waits, nowMs) {
  const ws = waits.filter((w) => w.shift === shift.start && Number.isFinite(w.wait_min));
  const by = [...ws].sort((a, b) => a.wait_min - b.wait_min);
  const pick = (w) => (w ? { min: w.wait_min, stand: w.stand, uncertain: !!(w.end_uncertain || w.start_uncertain) } : null);
  return {
    start: shift.start, end: shift.end,
    on_min: Math.round(((shift.end ? ms(shift.end) : nowMs) - ms(shift.start)) / MIN),
    rank_min: Math.round(ws.reduce((t, w) => t + w.wait_min, 0)),
    waits: ws.length, fares: ws.filter((w) => w.outcome === 'fare').length,
    answered: ws.filter((w) => w.outcome === 'fare' || w.outcome === 'left_empty').length,
    longest: pick(by[by.length - 1]), shortest: pick(by[0]),
  };
}

/** Minutes on shift in the last windowH hours (the fatigue count: all time on shift, since Kerb can't see fares). */
export function onShiftMinutes(shifts, nowMs, windowH) {
  const from = nowMs - windowH * 60 * MIN;
  let total = 0;
  for (const s of shifts) {
    const a = Math.max(ms(s.start), from), b = Math.min(s.end ? ms(s.end) : nowMs, nowMs);
    if (b > a) total += b - a;
  }
  return Math.round(total / MIN);
}

/** 0 below the first fatigue mark, then 1, 2, 3 at 9, 10, 11 hours (params.shift.fatigue_h). */
export const fatigueStage = (minutes, P) => P.fatigue_h.filter((h) => minutes >= h * 60).length;
