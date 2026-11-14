// Phone check (decision 2026-11-14): turn what the phone reports into pass / warn / fail rows and a plain-text
// report a driver can paste to Q. Pure: ui/phonecheck.js gathers the facts. The report never contains coordinates.

const USABLE_ACC_M = 30; // the logger ignores fixes worse than this (logger.js: accuracy <= 30)

/** {n, medianAcc, speedN} over recent fixes: how sharp the location is and whether the phone reports speed. */
export function fixSummary(fixes) {
  const acc = fixes.map((f) => f.accuracy).filter((a) => typeof a === 'number').sort((a, b) => a - b);
  const mid = acc.length ? (acc.length % 2 ? acc[(acc.length - 1) / 2] : (acc[acc.length / 2 - 1] + acc[acc.length / 2]) / 2) : null;
  return { n: fixes.length, medianAcc: mid === null ? null : Math.round(mid * 10) / 10,
    speedN: fixes.filter((f) => typeof f.speed === 'number').length };
}

const r = (key, label, state, detail) => ({ key, label, state, detail });

function locationRow(p) {
  const L = 'Location';
  if (p.permission === 'denied') return r('location', L, 'fail', "Blocked: allow location for Kerb in the phone's settings");
  if (!p.fixes.n) return r('location', L, 'todo', 'No reading yet: wait a minute outside or by a window');
  // p.creepAccM is params.logger.creep_max_accuracy_m: moving up the rank is only measured from fixes this good.
  const a = p.fixes.medianAcc, over = `${a} m typical over ${p.fixes.n} readings`;
  if (a <= p.creepAccM) return r('location', L, 'pass', over);
  if (a <= USABLE_ACC_M) return r('location', L, 'warn', `${over}: rank timing works, but moving up the rank needs ${p.creepAccM} m or better`);
  return r('location', L, 'fail', `${over}: too rough, Kerb ignores readings worse than ${USABLE_ACC_M} m`);
}

export function checkRows(p) {
  const d = p.data;
  return [
    p.standalone ? r('installed', 'Installed', 'pass', 'Opened from the home screen')
      : r('installed', 'Installed', 'fail', 'Not installed: add Kerb to the home screen and open it from there'),
    p.swControl === null ? r('offline-ready', 'Offline copy', 'unsupported', "This browser can't keep an offline copy")
      : !p.swControl ? r('offline-ready', 'Offline copy', 'fail', 'Not active yet: open Kerb once more with signal')
        : p.cached && p.cached.have === p.cached.want ? r('offline-ready', 'Offline copy', 'pass', `${p.cached.have}/${p.cached.want} key files saved on the phone`)
          : r('offline-ready', 'Offline copy', 'fail', `${p.cached ? p.cached.have : 0}/${p.cached ? p.cached.want : '?'} key files saved: open Kerb with signal and wait a minute`),
    p.offlineBootAt ? r('offline-start', 'Opens with no signal', 'pass', `Yes, on ${p.offlineBootAt.slice(0, 10)}`)
      : r('offline-start', 'Opens with no signal', 'todo', 'Not tried yet: turn on aeroplane mode, close Kerb fully, open it again, then come back here'),
    p.storage !== 'ok' ? r('storage', 'Saves your log', 'fail', "Can't save on this phone: export your log before closing Kerb")
      : p.persisted === false ? r('storage', 'Saves your log', 'warn', 'Saves it, but the phone may clear it when space runs low: export weekly')
        : r('storage', 'Saves your log', 'pass', 'Saved on this phone'),
    locationRow(p),
    !p.fixes.n ? r('speed', 'Speed from the phone', 'todo', 'No reading yet')
      : p.fixes.speedN ? r('speed', 'Speed from the phone', 'pass', `Reported (${p.fixes.speedN} of ${p.fixes.n} readings)`)
        : r('speed', 'Speed from the phone', 'info', 'Not reported: moving up the rank is estimated from position'),
    p.wakeLock ? r('wake', 'Screen stays on', 'pass', 'Shift mode can keep the screen on')
      : r('wake', 'Screen stays on', 'unsupported', "Not on this browser: set a long screen timeout in the phone's settings"),
    d.timetableCurrent && !d.eventsStale
      ? r('data', 'Data up to date', 'pass', `Built ${d.built}; timetables to ${d.timetableTo}; events checked ${d.eventsUpdated}`)
      : r('data', 'Data up to date', 'fail', `Out of date (built ${d.built}; timetables to ${d.timetableTo}; events checked ${d.eventsUpdated}): open Kerb with signal`),
    p.battery ? r('battery', 'Battery', 'info', `${p.battery.level}%${p.battery.charging ? ', charging' : ''}`)
      : r('battery', 'Battery', 'unsupported', 'Not shown on this browser: note it from the phone'),
  ];
}

/** Plain text for Copy report: what was checked, on which bundle and browser. No coordinates. */
export function reportText(rows, p) {
  return [
    `Kerb phone check, ${p.now}`,
    `Bundle ${p.data.bundle}`,
    `Browser: ${p.ua}`,
    '',
    ...rows.map((x) => `[${x.state.toUpperCase()}] ${x.label}: ${x.detail}`),
  ].join('\n');
}
