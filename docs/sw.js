const AUDIO_VERSION = '6c507e6916b72311';
const SHELL_VERSION='ffaf6cb1e31f26c3';
const ROOT = new URL('./',self.location.href);
const SCOPE = encodeURIComponent(ROOT.pathname);
const AUDIO = 'sin-star-audio-'+SCOPE+'-'+AUDIO_VERSION;
const SHELL_PREFIX = 'sin-star-shell-'+SCOPE+'-';
const SHELL = SHELL_PREFIX+SHELL_VERSION;
const ASSETS = ["./", "./index.html", "./reader.css", "./app.js", "./cue-navigation.js", "./follow-narration.js", "./offline.js", "./music.js", "./music-cache.js", "./music.json", "./bookmarks.js", "./bookmark-anchors.js", "./book.json", "./manifest.webmanifest", "./icon.svg", "./storyboards.json", "./images/01-panel-01-1.webp", "./images/02-c01-s01-carry.webp", "./images/03-panel-03-2.webp", "./images/04-c04-s02-added.webp", "./images/05-c05-s01-added.webp", "./images/06-panel-07-3.webp", "./images/07-panel-08-4.webp", "./images/08-panel-11-2.webp", "./images/09-c09-s01-added.webp", "./images/10-e01-s01-added.webp"];
self.addEventListener('install',event=>event.waitUntil((async()=>{
  const cache=await caches.open(SHELL);
  await cache.addAll(ASSETS.map(path=>new Request(new URL(path,ROOT),{cache:'reload'})));
  await self.skipWaiting();
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  for(const key of await caches.keys())if(key.startsWith(SHELL_PREFIX)&&key!==SHELL)await caches.delete(key);
  await self.clients.claim();
})()));
async function audioResponse(request){
  const cache=await caches.open(AUDIO),response=await cache.match(request.url);
  if(response?.status===200){
    const range=request.headers.get('Range');
    if(!range)return response;
    const blob=await response.blob(),size=blob.size;
    const match=/^bytes=(\d*)-(\d*)$/.exec(range);
    if(!match||(!match[1]&&!match[2]))return new Response(null,{status:416,headers:{'Content-Range':'bytes */'+size}});
    let start,end;
    if(!match[1]){const suffix=Number(match[2]);start=Math.max(0,size-suffix);end=size-1;}
    else{start=Number(match[1]);end=match[2]?Math.min(Number(match[2]),size-1):size-1;}
    if(start>=size||start>end||!Number.isSafeInteger(start)||!Number.isSafeInteger(end))return new Response(null,{status:416,headers:{'Content-Range':'bytes */'+size}});
    return new Response(blob.slice(start,end+1),{status:206,headers:{'Content-Type':'audio/mpeg','Content-Length':String(end-start+1),'Content-Range':`bytes ${start}-${end}/${size}`,'Accept-Ranges':'bytes'}});
  }
  // Preserve the browser's privileged media Range header by forwarding the original request.
  try{return await fetch(request);}catch{return new Response('This chapter is not saved offline.',{status:503,headers:{'Content-Type':'text/plain'}});}
}
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==ROOT.origin||!url.pathname.startsWith(ROOT.pathname))return;
  if(url.pathname.startsWith(new URL('audio/',ROOT).pathname)){event.respondWith(audioResponse(request));return;}
  const isShell=ASSETS.some(path=>new URL(path,ROOT).pathname===url.pathname);
  if(!isShell&&request.mode!=='navigate')return;
  event.respondWith((async()=>{
    try{const response=await fetch(request);if(response.ok)return response;throw new Error('Unavailable');}
    catch{const cache=await caches.open(SHELL);return await cache.match(request,{ignoreSearch:true})||await cache.match(new URL('index.html',ROOT));}
  })());
});
