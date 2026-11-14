// Keyed motion (ADR 0009). render() rebuilds the screen on every GPS fix and every minute, so an entrance animation
// on a fresh node would replay all shift long. Instead each render compares what the driver sees with the last render
// and gets one-render flags on #app; CSS animates only under those flags. No flag, no animation.

/** What the driver sees, for comparing one render with the next. */
export function renderState(S, view) {
  const top = S.recs && S.recs[0];
  return {
    view,
    level: top ? top.demand.level : null,
    bar: `${S.logger ? S.logger.mode : 'idle'}:${!!S.picker}:${S.shift ? (S.shiftView === 'end' ? 'end' : 'on') : 'off'}`, // ADR 0010
    autoLog: S.settings.autoLog !== false,
    firstRun: !!S.firstRun,
    updateReady: !!S.updateReady,
    recChanged: !!S.changed,
  };
}

/**
 * The flags for this render, from the previous render's state (null on the first render):
 * a-view / a-home (a screen opens / back to the glance), a-rec (new recommendation), a-level (demand level changed),
 * a-bar (the logger bar changed state, glance to glance), a-mode (Auto / Manual moved on the glance),
 * a-first (the first-run sheet appears), a-update (the update chip appears).
 */
export function motionFlags(prev, cur) {
  if (!prev) return cur.firstRun ? ['a-first'] : [];
  const flags = [];
  const viewChanged = prev.view !== cur.view;
  if (viewChanged) flags.push(cur.view === 'glance' ? 'a-home' : 'a-view');
  if (cur.view === 'glance') {
    if (cur.recChanged) flags.push('a-rec');
    if (cur.recChanged || (prev.level && cur.level && prev.level !== cur.level)) flags.push('a-level');
    if (!viewChanged && prev.bar !== cur.bar) flags.push('a-bar');
    if (!viewChanged && prev.autoLog !== cur.autoLog) flags.push('a-mode');
  }
  if (cur.firstRun && !prev.firstRun) flags.push('a-first');
  if (cur.updateReady && !prev.updateReady) flags.push('a-update');
  return flags;
}

// How long each flag's animation runs, in ms (the CSS tokens: d0 120, d1 194, d2 314; the stones add two 60 ms staggers).
export const DURATION = { 'a-view': 194, 'a-home': 120, 'a-rec': 194, 'a-level': 314, 'a-bar': 194, 'a-mode': 194, 'a-first': 314, 'a-update': 194 };
const RIVALS = [['a-view', 'a-home']]; // one screen arrives at a time

/**
 * Flags still running at time t (ms, performance.now()), as {flag: startMs}. A flag lives for its animation's duration,
 * so a render in the middle of it (a GPS fix, road distances arriving) continues the animation instead of snapping it
 * to the end; a fresh change restarts its own flag and ends its rival.
 */
export function continueFlags(running, fresh, t) {
  const next = {};
  for (const [f, t0] of Object.entries(running)) if (t - t0 < DURATION[f]) next[f] = t0;
  for (const f of fresh) {
    for (const group of RIVALS) if (group.includes(f)) for (const r of group) delete next[r];
    next[f] = t;
  }
  return next;
}

/** The class list for #app, and each flag's elapsed time as a negative animation-delay (--a-view:-100ms; …). */
export function motionStyle(running, t) {
  const on = Object.entries(running);
  return { className: on.map(([f]) => f).join(' '), style: on.map(([f, t0]) => `--${f}:${Math.round(t0 - t)}ms`).join(';') };
}
