// On-device storage (IndexedDB): the append-only wait-log event stream and settings (ADR 0004).
// If IndexedDB is unavailable the app keeps working in memory and says logs can't be saved.
let db = null;
const mem = { events: [], settings: {} };

const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export async function open() {
  try {
    const r = indexedDB.open('kerb', 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore('events', { autoIncrement: true });
      r.result.createObjectStore('settings');
    };
    db = await req(r);
  } catch (e) {
    db = null;
  }
  return db !== null;
}

export const available = () => db !== null;

export async function append(event) {
  if (!db) { mem.events.push(event); return; }
  await req(db.transaction('events', 'readwrite').objectStore('events').add(event));
}

export async function all() {
  if (!db) return [...mem.events];
  return req(db.transaction('events').objectStore('events').getAll());
}

export async function settings() {
  if (!db) return { ...mem.settings };
  const store = db.transaction('settings').objectStore('settings');
  const [keys, values] = await Promise.all([req(store.getAllKeys()), req(store.getAll())]);
  return Object.fromEntries(keys.map((k, i) => [k, values[i]]));
}

export async function setSetting(key, value) {
  if (!db) { mem.settings[key] = value; return; }
  await req(db.transaction('settings', 'readwrite').objectStore('settings').put(value, key));
}

/** Replace the whole event log in one transaction (restore from backup, ADR 0008): all or nothing. */
export async function replaceAll(events) {
  if (!db) { mem.events = [...events]; return; }
  const tx = db.transaction('events', 'readwrite');
  const os = tx.objectStore('events');
  os.clear();
  for (const e of events) os.add(e);
  await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); });
}
