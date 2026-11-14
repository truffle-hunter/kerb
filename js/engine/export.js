// Export of the wait log (spec §7.5): JSON schema kerb-log/1 (read by tools/score/score_waits.py) and a CSV of waits.
export const CSV_HEADER = 'stand,joined_at,ended_at,wait_min,outcome,censored,followed_top_pick,join_source,cabs_ahead,people,demand_level,demand_score,model,params,bundle,confirmed,creeps,left_via,cabs_ahead_est,detect';

export function toJSON({ events, waits, meta, device }) {
  // features tells readers this export may hold unconfirmed automatic waits and review edits (ADR 0005)
  return JSON.stringify({ schema: 'kerb-log/1', device, meta: { ...meta, features: ['auto_join', 'review'] }, events, waits }, null, 1);
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
    w.versions && w.versions.bundle, w.confirmed !== false, w.creeps ?? 0, w.left_via, w.cabs_ahead_est, w.detect].map(cell).join(','));
  return [CSV_HEADER, ...rows].join('\n') + '\n';
}

/** Export reminder (decision 2026-11-14): due when finished waits not yet exported for scoring are `days` old,
 * counted from the last export, or from the first such wait if the driver never exported. Nothing is sent. */
export function exportDue(waits, lastExport, now, days = 7) {
  const after = lastExport ? Date.parse(lastExport) : -Infinity;
  const fresh = waits.filter((w) => Date.parse(w.joined_at) > after);
  if (!fresh.length) return { due: false, days: 0, count: 0 };
  const since = lastExport ? after : Math.min(...fresh.map((w) => Date.parse(w.joined_at)));
  const age = Math.floor((now - since) / 86400000);
  return { due: age >= days, days: age, count: fresh.length };
}
