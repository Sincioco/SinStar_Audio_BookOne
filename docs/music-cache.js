// Optional, verified music storage. Never shares narration's cache or download state.
const base = new URL('./', location.href);
const cacheName = 'sin-star-music-' + encodeURIComponent(base.pathname) + '-v1';
export const musicURL = track => new URL(track.file + '?v=' + track.sha256, base).href;
export async function verifiedBytes(response, track) {
  if (!response || response.status !== 200) throw new Error('Music file unavailable. Narration is still available.');
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength !== track.bytes) throw new Error('Incomplete music file. Please retry when connected.');
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
  if (hash !== track.sha256) throw new Error('Music verification failed. Please reload and retry.');
  return bytes;
}
async function saved(track) {
  try {
    const response = await (await caches.open(cacheName)).match(musicURL(track));
    if (response) return await verifiedBytes(response, track);
  } catch { /* Denied, evicted or corrupt storage is not a playback dependency. */ }
  return null;
}
export async function musicBytes(track, signal) {
  return await saved(track) || await verifiedBytes(await fetch(musicURL(track), {signal}), track);
}
export async function musicSaved(tracks) {
  return Promise.all(tracks.map(async track => Boolean(await saved(track))));
}
export async function downloadMusic(tracks, signal, progress) {
  const cache = await caches.open(cacheName);
  for (let i=0; i<tracks.length; i++) {
    if (signal.aborted) throw new DOMException('Cancelled','AbortError');
    const track = tracks[i];
    if (!await saved(track)) {
      progress('Saving ' + track.title + '…');
      const bytes = await verifiedBytes(await fetch(musicURL(track), {signal,cache:'no-store'}), track);
      if (signal.aborted) throw new DOMException('Cancelled','AbortError');
      await cache.put(musicURL(track), new Response(bytes, {headers:{'Content-Type':'audio/mpeg','Content-Length':String(track.bytes)}}));
    }
  }
}
export async function removeMusic() { await caches.delete(cacheName); }
