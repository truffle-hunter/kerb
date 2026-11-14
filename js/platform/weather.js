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

/** Never throws: any failure gives null and the app simply shows no rain line. */
export async function fetchWeather(fetchFn, now) {
  try {
    const r = await fetchFn(MET_URL);
    if (!r.ok) return null;
    const w = parseForecast(await r.text(), now);
    return w && { ...w, fetched: now }; // the app ignores rain older than params.demand.weather_max_age_min
  } catch (e) {
    return null;
  }
}
