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
  return { events: data.events, device: typeof data.device === 'string' ? data.device : null,
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
  return { events, added: fresh.length, device: local.length === 0 && fileDevice ? fileDevice : localDevice };
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
