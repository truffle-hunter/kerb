// Keep the screen on while on shift (Screen Wake Lock; ADR 0010). Off unless the driver turns it on, and held only
// while a shift is on, so a phone left in the cradle after the shift ends can sleep.
let lock = null, wanted = false;

async function acquire() {
  if (!wanted || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
  try { lock = await navigator.wakeLock.request('screen'); } catch (e) { lock = null; }
}

document.addEventListener('visibilitychange', () => { if (wanted && !lock) acquire(); });

export async function setKeepAwake(on) {
  wanted = on;
  if (on) await acquire();
  else if (lock) { await lock.release(); lock = null; }
}
export const wakeSupported = () => 'wakeLock' in navigator;
export const awakeHeld = () => !!lock; // for tests and the phone check
