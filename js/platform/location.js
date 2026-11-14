// Position fixes. Real geolocation, or in dev mode a fixed `?pos=lon,lat` plus fixes pushed by tests.
import { dev, now } from './clock.js';

const q = new URLSearchParams(location.search);
export const devPos = dev && q.get('pos') ? q.get('pos').split(',').map(Number) : null;

/** watch(onFix, onError, {high}) -> {setHigh(bool), stop()}; fixes are {lon, lat, speed, accuracy, t}. */
export function watch(onFix, onError, { high = false } = {}) {
  if (devPos) {
    queueMicrotask(() => onFix({ lon: devPos[0], lat: devPos[1], speed: 0, accuracy: 5, t: now() }));
    return { setHigh() {}, stop() {} };
  }
  if (!('geolocation' in navigator)) {
    queueMicrotask(() => onError({ code: 0, message: 'This browser has no location service' }));
    return { setHigh() {}, stop() {} };
  }
  let id = null, isHigh = high;
  const ok = (p) => onFix({ lon: p.coords.longitude, lat: p.coords.latitude, speed: p.coords.speed,
    accuracy: p.coords.accuracy, t: now() });
  const start = () => {
    id = navigator.geolocation.watchPosition(ok, onError, { enableHighAccuracy: isHigh, maximumAge: 5000, timeout: 20000 });
  };
  start();
  return {
    setHigh(h) { if (h !== isHigh) { isHigh = h; navigator.geolocation.clearWatch(id); start(); } },
    stop() { navigator.geolocation.clearWatch(id); },
  };
}
