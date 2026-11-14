// Shift mode: keep the screen on while Kerb is visible (Screen Wake Lock). Off unless the driver turns it on.
let lock = null, wanted = false;

async function acquire() {
  if (!wanted || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
  try { lock = await navigator.wakeLock.request('screen'); } catch (e) { lock = null; }
}

document.addEventListener('visibilitychange', () => { if (wanted && !lock) acquire(); });

export async function setShift(on) {
  wanted = on;
  if (on) await acquire();
  else if (lock) { await lock.release(); lock = null; }
}
export const shiftSupported = () => 'wakeLock' in navigator;
