// Is a stand legally usable right now? (spec §7.1)
import { dublinParts, dublinTime, addDays, daysBetween, hhmm } from './time.js';

const USABLE = new Set(['open', 'event_active', 'hours_unknown']);
const MIN = 60000;

export const isUsable = (st) => USABLE.has(st.state);

function suspension(stand, now, rules) {
  const today = dublinParts(now).date;
  return rules.find((r) => r.kind === 'suspension' && r.stands.includes(stand.id)
    && (!r.from || r.from <= today) && (!r.to || today <= r.to));
}

function toMin(hm) { const [h, m] = hm.split(':').map(Number); return h * 60 + m; }

function nightly(hours, now) {
  const p = dublinParts(now);
  const t = p.hour * 60 + p.minute, from = toMin(hours.from), to = toMin(hours.to);
  if (t >= from) return { state: 'open', until: dublinTime(addDays(p.date, 1), hours.to), why: `Night stand, ${hours.from}–${hours.to}` };
  if (t < to) return { state: 'open', until: dublinTime(p.date, hours.to), why: `Night stand, ${hours.from}–${hours.to}` };
  return { state: 'closed', until: dublinTime(p.date, hours.from), why: `Night stand: opens ${hours.from}` };
}

function eventStatus(hours, now, ctx) {
  const { events, params } = ctx;
  const L = params.legal;
  const today = dublinParts(now).date;
  const updated = (ctx.meta && ctx.meta.events && ctx.meta.events.updated) || events.updated;
  if (daysBetween(updated, today) > L.events_stale_days || today > events.to || today < events.from) {
    return { state: 'event_unknown', until: null, why: `Event stand: the events list (updated ${updated}) is out of date, so whether an event is on is unknown` };
  }
  const windows = events.items.filter((e) => e.venue === hours.venue).map((e) => ({
    e, from: new Date(Date.parse(e.start) - L.event_before_min * MIN), to: new Date(Date.parse(e.end) + L.event_after_min * MIN),
  })).sort((a, b) => a.from - b.from);
  const on = windows.find((w) => w.from <= now && now <= w.to);
  if (on) return { state: 'event_active', until: on.to, why: `Event stand: ${on.e.label}` };
  const next = windows.find((w) => w.from > now);
  return {
    state: 'event_inactive', until: next ? next.from : null,
    why: next ? `Event stand: next event ${next.e.label}, from ${hhmm(next.from)} on ${dublinParts(next.from).date}` : 'Event stand: no event listed',
  };
}

/** {state, until: Date|null, why} — see spec §7.1 for the states. */
export function status(stand, now, ctx) {
  const s = suspension(stand, now, ctx.rules || []);
  if (s) return { state: 'suspended', until: s.to ? dublinTime(addDays(s.to, 1), '00:00') : null, why: s.note };
  if (stand.kind === 'county') {
    return { state: 'unconfirmed', until: null, why: '2002 Garda bye-law; whether it is still in force is unconfirmed (OQ1)' };
  }
  const h = stand.hours;
  switch (h.type) {
    case 'always': return { state: 'open', until: null, why: 'Open at all times' };
    case 'nightly': return nightly(h, now);
    case 'event': return eventStatus(h, now, ctx);
    case 'text': return { state: 'hours_unknown', until: null, why: `Hours as published: ${h.text}` };
    default: return { state: 'hours_unknown', until: null, why: 'Hours not published' };
  }
}
