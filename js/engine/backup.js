// Backup and restore (ADR 0008). The scoring export (schema kerb-log/1) doubles as the backup. Restore adds the
// file's events that this phone doesn't already have, so restoring the same file twice changes nothing.

/** The events and device id from a backup file's text; throws "not a Kerb backup" for anything else. */
export function parseBackup(text) {
  let data;
  try { data = JSON.parse(text); } catch (e) { throw new Error('not a Kerb backup'); }
  if (!data || data.schema !== 'kerb-log/1' || !Array.isArray(data.events)
      || !data.events.every((e) => e && typeof e.type === 'string' && typeof e.t === 'string')) {
    throw new Error('not a Kerb backup');
  }
  const opens = Array.isArray(data.plan_opens) ? data.plan_opens : []; // ADR 0015; older backups have none
  return { events: data.events, device: typeof data.device === 'string' ? data.device : null,
    planOpens: opens.filter((o) => o && typeof o.t === 'string' && !Number.isNaN(Date.parse(o.t)))
      .map((o) => (typeof o.why === 'string' ? { t: o.t, on_shift: !!o.on_shift, why: o.why } : { t: o.t, on_shift: !!o.on_shift })), // ADR 0016: a row's detail
    exportedAt: data.meta && typeof data.meta.exported_at === 'string' ? data.meta.exported_at : null };
}

/** Canonical JSON (sorted keys), so the same event from either log compares equal. */
function canon(v) {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}

// When an event was written: an automatic join is backdated to the start of the stop but written at detected_at.
const emitted = (e) => Date.parse(e.detected_at || e.t);

/**
 * Merge two event logs. Each keeps its own order; the two are interleaved by when events were written (a stable
 * two-way merge, never a re-sort, because derived waits depend on stream order). The file's device id is adopted
 * only into an empty log, so a restored log keeps labelling its waits as before.
 */
export function mergeEvents(local, incoming, { localDevice = null, fileDevice = null } = {}) {
  const have = new Set(local.map(canon));
  const fresh = [];
  for (const e of incoming) {
    const k = canon(e);
    if (!have.has(k)) { have.add(k); fresh.push(e); }
  }
  const events = [];
  let i = 0, j = 0;
  while (i < local.length || j < fresh.length) {
    if (j >= fresh.length || (i < local.length && emitted(local[i]) <= emitted(fresh[j]))) events.push(local[i++]);
    else events.push(fresh[j++]);
  }
  // the backup's code is adopted only by a phone with no log of its own; shift events alone don't count (ADR 0010: a new
  // phone's driver may tap Start shift before restoring)
  return { events, added: fresh.length, device: !hasOwnLog(local) && fileDevice ? fileDevice : localDevice };
}

/**
 * Close waits left open in a log (review fix): a backup taken mid-wait, or two logs merged so that a wait is followed
 * by a newer join. Each gets an "unknown" outcome at its last sighting, marked uncertain, so it is neither dropped nor
 * resumed weeks later. Only for restore: on the phone, the open wait is the one being timed.
 */
export function closeDanglingWaits(events) {
  const out = [];
  let open = null, last = null;
  const close = () => { out.push({ type: 'outcome', t: last, outcome: 'unknown', uncertain: true, source: 'restore' }); open = null; };
  for (const e of events) {
    if (e.type === 'join') {
      if (open) close();
      open = e.t; last = e.detected_at || e.t;
    } else if (open && (e.type === 'outcome' || e.type === 'cancel' || (e.type === 'void' && e.wait === open))) {
      open = null;
    } else if (open && !e.wait) {
      last = e.t; // events of the open wait itself (reviews of other waits carry `wait` and don't count)
    }
    out.push(e);
  }
  if (open) close();
  return out;
}

/**
 * A restore can merge in a shift that never ended, followed by another start (ADR 0010). Each such shift ends at the
 * last event before the next start (or at its own start), marked restore and uncertain. A trailing open shift is left
 * for the automatic end to judge. Idempotent: closing an already closed log changes nothing.
 */
export function closeDanglingShifts(events) {
  const out = [];
  let open = false, last = null, lastEnd = null, openStart = null;
  for (const e of events) {
    if (e.type === 'shift_start') {
      if (open) out.push({ type: 'shift_end', t: last, detected_at: last, source: 'restore', uncertain: true });
      open = true; last = e.t; openStart = e.t;
    } else if (e.type === 'shift_end') {
      if (open && e.t >= openStart) { open = false; lastEnd = e.t; } // an end from before this shift began is an older one's
    } else if (e.type === 'shift_resume') {
      if (!open && lastEnd && e.end === lastEnd) open = true;
    } else if (open) {
      last = e.detected_at && e.detected_at > e.t ? e.detected_at : e.t;
    }
    out.push(e);
  }
  return out;
}

/** A log of its own: any event other than shift start, end or resume. */
export const hasOwnLog = (events) => events.some((e) => !['shift_start', 'shift_end', 'shift_resume'].includes(e.type));

/** The Tonight openings of two logs merged by time, in order, the most recent `cap` kept (ADR 0015). Idempotent. */
export function mergeOpens(local, incoming, cap = 2000) {
  const byT = new Map();
  for (const o of [...(local || []), ...(incoming || [])]) { const k = `${o.t}|${o.why || ''}`; if (!byT.has(k)) byT.set(k, o); } // ADR 0016: a detail opening can share t
  return [...byT.values()].sort((a, b) => Date.parse(a.t) - Date.parse(b.t)).slice(-cap);
}
