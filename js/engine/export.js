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
