// Rain in the next hour from Met Éireann's open point forecast (CC BY 4.0; CORS-open, so no relay needed).
export const MET_URL = 'https://openaccess.pf.api.met.ie/metno-wdb2ts/locationforecast?lat=53.35;long=-6.26';
const HOUR = 3600000;

/** {rainNextHourMm, issued} from the forecast XML, prorating hourly precipitation over [now, now + 1 h]; null if not covered. */
export function parseForecast(xmlText, now) {
  const created = /<weatherdata[^>]*\screated="([^"]+)"/.exec(xmlText);
  const lo = now.getTime(), hi = lo + HOUR;
  let mm = 0, covered = 0;
  const re = /<time datatype="forecast" from="([^"]+)" to="([^"]+)">([\s\S]*?)<\/time>/g;
  for (let m; (m = re.exec(xmlText));) {
    const from = Date.parse(m[1]), to = Date.parse(m[2]);
    if (to - from !== HOUR) continue; // hourly precipitation intervals only
    const p = /<precipitation[^>]*\svalue="([^"]+)"/.exec(m[3]);
    if (!p) continue;
    const overlap = Math.min(hi, to) - Math.max(lo, from);
    if (overlap <= 0) continue;
    mm += parseFloat(p[1]) * (overlap / HOUR);
    covered += overlap;
  }
  if (covered < HOUR / 2) return null;
  return { rainNextHourMm: Math.round(mm * 1e9) / 1e9, issued: created ? new Date(created[1]) : null };
}

const STEP_H = new Set([1, 3, 6]);

/** Every precipitation step of 1, 3 or 6 hours, [{from, to, mm}] in time order; [] for anything else (ADR 0015: the
 * Tonight sheet's rain band uses the hourly steps, its week marks the coarser ones too). */
export function parseSteps(xmlText) {
  if (typeof xmlText !== 'string') return [];
  const out = [];
  const re = /<time datatype="forecast" from="([^"]+)" to="([^"]+)">([\s\S]*?)<\/time>/g;
  for (let m; (m = re.exec(xmlText));) {
    const from = Date.parse(m[1]), to = Date.parse(m[2]);
    if (!STEP_H.has((to - from) / HOUR)) continue;
    const p = /<precipitation[^>]*\svalue="([^"]+)"/.exec(m[3]);
    const mm = p ? parseFloat(p[1]) : NaN;
    if (Number.isFinite(mm)) out.push({ from: new Date(from), to: new Date(to), mm });
  }
  return out.sort((a, b) => a.from - b.from || (a.to - a.from) - (b.to - b.from));
}

/** The forecast as plain JSON for the settings store, and back; anything unreadable unpacks to null. */
export const packForecast = (f) => ({ steps: f.steps.map((s) => [s.from.toISOString(), s.to.toISOString(), s.mm]),
  issued: f.issued ? f.issued.toISOString() : null, fetched: f.fetched.toISOString() });
export function unpackForecast(o) {
  if (!o || !Array.isArray(o.steps) || typeof o.fetched !== 'string') return null;
  const steps = o.steps.map((s) => (Array.isArray(s) ? { from: new Date(s[0]), to: new Date(s[1]), mm: s[2] } : null));
  const fetched = new Date(o.fetched), issued = o.issued ? new Date(o.issued) : null;
  const bad = (d) => Number.isNaN(d.getTime());
  if (bad(fetched) || (issued && bad(issued)) || steps.some((s) => !s || bad(s.from) || bad(s.to) || !Number.isFinite(s.mm))) return null;
  return { steps, issued, fetched };
}

/** Never throws: any failure gives null and the app simply shows no rain line. */
export async function fetchWeather(fetchFn, now) {
  try {
    const r = await fetchFn(MET_URL);
    if (!r.ok) return null;
    const text = await r.text();
    const w = parseForecast(text, now);
    return w && { ...w, fetched: now, steps: parseSteps(text) }; // the app ignores rain older than params.demand.weather_max_age_min
  } catch (e) {
    return null;
  }
}
