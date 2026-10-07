const queues = new Map();
function serialized(name, task) {
  const pending = (queues.get(name) || Promise.resolve()).catch(() => {}).then(task);
  queues.set(name, pending);
  return pending.finally(() => { if (queues.get(name) === pending) queues.delete(name); });
}
async function limitedBody(response, limit) {
  if (Number(response.headers.get('content-length')) > limit) return null;
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const parts = [];
  let length = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > limit) { await reader.cancel(); return null; }
    parts.push(value);
  }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}
function storedResponse(bytes, response, timestamp) {
  const headers = new Headers(response.headers);
  headers.delete('content-encoding');
  headers.delete('content-length');
  headers.set('X-Lurker-Bytes', String(bytes.length));
  headers.set('X-Lurker-Cached-At', String(timestamp));
  return new Response(bytes, { status: response.status, statusText: response.statusText, headers });
}
async function trim(cache, policy, reserve = 0, reserveEntries = 0) {
  const entries = [];
  const now = Date.now();
  for (const key of await cache.keys()) {
    let response = await cache.match(key);
    if (!response) continue;
    let bytes = Number(response.headers.get('X-Lurker-Bytes'));
    let timestamp = Number(response.headers.get('X-Lurker-Cached-At'));
    if (!response.headers.has('X-Lurker-Bytes') || !timestamp) {
      if (!policy.migrateLegacy || !new URL(key.url).pathname.split('/').pop().startsWith('post-')) {
        await cache.delete(key); continue;
      }
      const body = await limitedBody(response, policy.maxEntryBytes);
      if (!body) { await cache.delete(key); continue; }
      bytes = body.length;
      timestamp = now;
      await cache.put(key, storedResponse(body, response, timestamp));
    }
    if (!Number.isFinite(bytes) || bytes > policy.maxEntryBytes || now - timestamp > policy.maxAge) {
      await cache.delete(key); continue;
    }
    entries.push({ key, bytes, timestamp });
  }
  entries.sort((a, b) => a.timestamp - b.timestamp);
  let total = entries.reduce((sum, entry) => sum + entry.bytes, 0);
  while (entries.length && (total + reserve > policy.maxBytes || entries.length + reserveEntries > policy.maxEntries)) {
    const entry = entries.shift();
    await cache.delete(entry.key);
    total -= entry.bytes;
  }
  return entries;
}
export async function pruneBoundedCache(name, policy, cacheStorage = globalThis.caches) {
  if (!cacheStorage) return;
  return serialized(name, async () => trim(await cacheStorage.open(name), policy)).catch(() => {});
}
export async function putBoundedCache(name, request, response, policy, cacheStorage = globalThis.caches) {
  if (!cacheStorage || !response.ok || response.status === 206 || response.type === 'opaque') return false;
  return serialized(name, async () => {
    const bytes = await limitedBody(response, Math.min(policy.maxEntryBytes, policy.maxBytes));
    if (!bytes) return false;
    const cache = await cacheStorage.open(name);
    await cache.delete(request);
    const remaining = await trim(cache, policy, bytes.length, 1);
    for (;;) {
      try {
        await cache.put(request, storedResponse(bytes, response, Date.now()));
        return true;
      } catch {
        if (!remaining.length) return false;
        await cache.delete(remaining.shift().key);
      }
    }
  }).catch(() => false);
}
export async function matchBoundedCache(name, request, policy, cacheStorage = globalThis.caches) {
  try {
    const cache = await cacheStorage.open(name);
    const response = await cache.match(request);
    if (!response) return null;
    const timestamp = Number(response.headers.get('X-Lurker-Cached-At'));
    if (!timestamp || Date.now() - timestamp > policy.maxAge) {
      await cache.delete(request); return null;
    }
    return response;
  } catch { return null; }
}
export function clearBoundedCache(name, cacheStorage = globalThis.caches) {
  if (!cacheStorage) return Promise.resolve();
  return serialized(name, () => cacheStorage.delete(name)).catch(() => {});
}
