// Dublin wall-clock helpers (spec §5). Every engine function takes `now` as a Date; nothing here reads the clock.
const FMT = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Dublin', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', weekday: 'short',
});
const WD = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
const pad = (n) => String(n).padStart(2, '0');

/** Dublin local parts of an instant. weekday: 0 = Monday … 6 = Sunday. */
export function dublinParts(now) {
  const p = {};
  for (const { type, value } of FMT.formatToParts(now)) p[type] = value;
  const year = +p.year, month = +p.month, day = +p.day;
  return {
    year, month, day, hour: +p.hour, minute: +p.minute, second: +p.second,
    weekday: WD[p.weekday], date: `${year}-${pad(month)}-${pad(day)}`,
  };
}

/** The instant at which Dublin's wall clock shows `hhmm` on `date` ("YYYY-MM-DD", "HH:MM"). */
export function dublinTime(date, hhmm) {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  let t = wall;
  for (let i = 0; i < 2; i++) {
    const p = dublinParts(new Date(t));
    const shown = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    t = wall - (shown - t);
  }
  return new Date(t);
}

export function addDays(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** Whole days from date a to date b ("YYYY-MM-DD"). */
export function daysBetween(a, b) {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

export const hhmm = (date) => { const p = dublinParts(date); return `${pad(p.hour)}:${pad(p.minute)}`; };
