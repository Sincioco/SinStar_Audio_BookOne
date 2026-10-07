let book, cacheName, notify, controller;
const base = new URL('./', location.href);
export const audioURL = chapter => {
  const url = new URL(chapter.audio, base);
  url.searchParams.set('v', chapter.sha256);
  return url.href;
};
const megabytes = bytes => (bytes / 1e6).toFixed(1) + ' MB';
const hash = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
const keyPrefix = () => 'sin-star-audio-' + encodeURIComponent(base.pathname) + '-';
export async function initOffline(data, callback) {
  book = data; notify = callback;
  cacheName = keyPrefix() + book.version;
  if (!isSecureContext || !('caches' in window) || !('serviceWorker' in navigator)) {
    throw new Error('Offline storage needs HTTPS (or localhost) and browser support. Online playback is available.');
  }
  await caches.open(cacheName);
  await navigator.serviceWorker.register('./sw.js', {scope: './'});
  await Promise.race([navigator.serviceWorker.ready,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Offline setup did not finish. Online playback is available; reconnect and reload to retry.')),15000))]);
  // Remove only this reader's obsolete audio revisions, never another app's cache.
  for (const name of await caches.keys()) if (name.startsWith(keyPrefix()) && name !== cacheName) await caches.delete(name);
  await refreshStatus();
}
async function stored(chapter) {
  if (!cacheName || !('caches' in window)) return null;
  const response = await (await caches.open(cacheName)).match(audioURL(chapter));
  return response?.status === 200 && response.headers.get('X-Audio-SHA256') === chapter.sha256 && Number(response.headers.get('Content-Length')) === chapter.bytes ? response : null;
}
export async function localSource(chapter) {
  try {
    const response = await stored(chapter);
    if (response) {
      const blob = await response.blob();
      if (blob.size === chapter.bytes) return URL.createObjectURL(blob);
    }
  } catch { /* Online playback remains available if browser storage is denied. */ }
  return null;
}
export async function refreshStatus() {
  const available = [];
  for (const chapter of book.chapters) available.push(Boolean(await stored(chapter)));
  notify({available, totalBytes: book.totalBytes, downloadedBytes: book.chapters.reduce((sum,c,i) => sum + (available[i] ? c.bytes : 0),0)});
  return available;
}
export function cancelDownload() { controller?.abort(); }
export async function removeOffline(indices) {
  if (controller) throw new Error('Cancel the current download before removing audio.');
  const cache = await caches.open(cacheName);
  for (const index of indices) await cache.delete(audioURL(book.chapters[index]));
  await refreshStatus();
}
export async function downloadAudio(indices, progress) {
  if (controller) return;
  controller = new AbortController();
  const signal = controller.signal;
  let currentURL = null, committedCurrent = false;
  try {
    const present = await refreshStatus();
    const todo = indices.filter(i => !present[i]);
    const needed = todo.reduce((sum,i) => sum + book.chapters[i].bytes,0);
    const storage = await navigator.storage?.estimate?.().catch(() => null);
    if (storage?.quota && storage.quota - (storage.usage || 0) < needed * 1.05) throw new Error('Not enough browser storage for ' + megabytes(needed) + '. Remove audio or download fewer chapters.');
    let finished = 0;
    const cache = await caches.open(cacheName);
    for (const index of todo) {
      if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      const chapter = book.chapters[index];
      currentURL = audioURL(chapter); committedCurrent = false;
      const response = await fetch(currentURL, {signal, cache:'no-store'});
      if (response.status !== 200 || !response.body) throw new Error('The server did not return a complete audio file. Retry this chapter.');
      const reader = response.body.getReader(), chunks = [];
      let received = 0;
      while (true) {
        const {done, value} = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > chapter.bytes) { await reader.cancel(); throw new Error('Audio size changed. Reload this edition before downloading.'); }
        chunks.push(value);
        progress({fraction:needed ? (finished + received) / needed : 1, message:chapter.heading + ' · ' + megabytes(received) + ' / ' + megabytes(chapter.bytes)});
      }
      if (received !== chapter.bytes) throw new Error('Incomplete audio download. Retry to finish this chapter.');
      const bytes = new Uint8Array(received);let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.byteLength; }
      if (await hash(bytes) !== chapter.sha256) throw new Error('Audio verification failed. Nothing was saved for this chapter; retry.');
      if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      await cache.put(currentURL,new Response(bytes,{status:200,headers:{'Content-Type':'audio/mpeg','Content-Length':String(received),'X-Audio-SHA256':chapter.sha256}}));
      committedCurrent = true; finished += received;
      await refreshStatus();
    }
    progress({fraction:1,message:'Selected audio is saved in this browser. It is ready to play offline.'});
  } catch (error) {
    if (currentURL && !committedCurrent) await (await caches.open(cacheName)).delete(currentURL).catch(() => {});
    if (error.name === 'AbortError') progress({message:'Download cancelled. Completed chapters are kept; retry skips them.'});
    else if (error.name === 'QuotaExceededError') throw new Error('Browser storage is full. Completed chapters are kept; remove audio and retry.');
    else throw error;
  } finally { controller = null; await refreshStatus().catch(() => {}); }
}
