// Export of the wait log (spec §7.5): JSON schema kerb-log/1 (read by tools/score/score_waits.py) and a CSV of waits.
// The JSON export is also the driver's backup (ADR 0008).
import { serviceDate } from './stats.js';
export const CSV_HEADER = 'stand,joined_at,ended_at,wait_min,outcome,censored,followed_top_pick,join_source,cabs_ahead,people,demand_level,demand_score,model,params,bundle,confirmed,creeps,left_via,cabs_ahead_est,detect,off_shift';

export function toJSON({ events, waits, meta, device, shifts = [], planOpens = [] }) {
  // features tells readers this export may hold unconfirmed automatic waits and review edits (ADR 0005), and shifts
  // with waits marked off_shift (ADR 0010; the shifts are also derivable from the events)
  // and the times the Tonight sheet was opened (ADR 0015: kept in settings, not the event log, so no shift or wait reads them)
  return JSON.stringify({ schema: 'kerb-log/1', device, meta: { ...meta, features: ['auto_join', 'review', 'shifts', 'plan_opens'] }, events, waits, shifts,
    plan_opens: planOpens }, null, 1);
}

const cell = (v) => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCSV(waits) {
  const rows = waits.map((w) => [w.stand, w.joined_at, w.ended_at, w.wait_min == null ? '' : w.wait_min.toFixed(2), w.outcome,
    w.censored, w.followed_top_pick, w.join_source, w.cabs_ahead, w.people, w.shown && w.shown.demand_level,
    w.shown && w.shown.demand_score, w.versions && w.versions.model, w.versions && w.versions.params,
    w.versions && w.versions.bundle, w.confirmed !== false, w.creeps ?? 0, w.left_via, w.cabs_ahead_est, w.detect, w.off_shift === true].map(cell).join(','));
  return [CSV_HEADER, ...rows].join('\n') + '\n';
}

/** Backup reminder (ADR 0008). Waits not in the last backup are counted by when they ended (a wait still open at
 * backup time isn't in it). Due when 20 have built up, when the oldest is 7 days old (counted from that wait, so a
 * long break doesn't nag at once), or, where the phone may clear storage (persisted === false), once its shift is
 * over: the real shift's end where there are shifts (onShift / shiftEnd, ADR 0010), else the 04:00 service day.
 * Waits off shift aren't counted. Nothing is sent: the driver keeps the file. */
export function backupDue(waits, lastBackup, now, { persisted = null, startHour = 4, days = 7, count = 20, events = [], onShift, shiftEnd = null } = {}) {
  const after = lastBackup ? Date.parse(lastBackup) : -Infinity;
  const offShift = new Set(waits.filter((w) => w.off_shift).map((w) => w.joined_at));
  // changed since the backup: waits that ended after it, and waits confirmed, answered or edited after it (review fix)
  const changed = new Map();
  for (const w of waits) { const t = Date.parse(w.ended_at || w.joined_at); if (t > after && !offShift.has(w.joined_at)) changed.set(w.joined_at, t); }
  for (const e of events) {
    const t = Date.parse(e.t);
    if (e.wait && !offShift.has(e.wait) && ['confirm', 'edit', 'void'].includes(e.type) && t > after) changed.set(e.wait, Math.min(changed.get(e.wait) ?? t, t));
  }
  if (!changed.size) return { due: false, days: 0, count: 0 };
  const oldest = Math.min(...changed.values());
  const age = Math.floor((now - oldest) / 86400000);
  const shiftOver = persisted === false && (onShift === undefined
    ? serviceDate(new Date(oldest).toISOString(), startHour) < serviceDate(new Date(now).toISOString(), startHour) // no shifts yet
    : !onShift && !!shiftEnd && Date.parse(shiftEnd) >= oldest);
  return { due: changed.size >= count || age >= days || shiftOver, days: age, count: changed.size };
}
