import {initOffline, audioURL, localSource, downloadAudio, cancelDownload, removeOffline} from './offline.js';

import {initCueNavigation} from './cue-navigation.js';
import {initNarrationFollow} from './follow-narration.js';
import {initMusic} from './music.js';
import {initBookmarks} from './bookmarks.js';
import {resolveRange} from './bookmark-anchors.js';

const $ = id => document.getElementById(id);
const audio = $('audio');
const music = initMusic({audio});
let bookmarks;
// Unlock Web Audio synchronously on playback gestures, including keyboard cues.
const musicGesture = event => {
  if(event.isTrusted && event.target.closest('#play,#previous,#next,[data-chapter],[data-home],a[href^="#ch-"],[data-cue-id],#bookmark-list button')) music.gesture();
};
document.addEventListener('click',musicGesture,{capture:true});
document.addEventListener('keydown', event => {if(event.key==='Enter'||event.key===' ')musicGesture(event);},{capture:true});
const sections = [...document.querySelectorAll('.reading-section')];
const links = [...document.querySelectorAll('[data-chapter]')];
let book, current = 0, epoch = 0, objectURL = null, loading = false, pendingTime = null, pendingPlay = false;
let validCues = [], activeCue = null, activeNodes = [], lastSaved = 0, offlineReady = false;
let metadataController, cueVersion = 0, storageWarning = false, downloadBusy = false;
let highlightFrame = null;
const encoder = new TextEncoder();
const normalize = text => (text.match(/[\p{L}\p{N}_]+/gu) || []).join(' ');
const formatTime = value => {
  const n = Math.max(0,Math.floor(Number(value) || 0));
  return n >= 3600 ? Math.floor(n/3600)+':'+String(Math.floor(n/60)%60).padStart(2,'0')+':'+String(n%60).padStart(2,'0') : Math.floor(n/60)+':'+String(n%60).padStart(2,'0');
};
const status = text => { $('playback-status').textContent = text; };
const saveKey = () => book.identity + '-position-v1';
function savePosition() {
  if (!book || loading) return;
  try { localStorage.setItem(saveKey(), JSON.stringify({version:book.version,chapter:book.chapters[current].id,time:audio.currentTime || 0})); }
  catch { storageWarning = true; $('connection-status').textContent = 'Position memory unavailable'; }
}
function clearHighlight() {
  for (const node of activeNodes) node.classList.remove('spoken');
  activeNodes = []; activeCue = null;
}
const followActive = initNarrationFollow({
  reading: $('reading'), checkbox: $('follow'), audio, activeNodes: () => activeNodes,
  header: document.querySelector('.topbar'), player: document.querySelector('.player')
});
function updateHighlight() {
  if (loading || audio.paused || audio.seeking || audio.ended) { clearHighlight(); return; }
  const time = audio.currentTime;
  const cue = validCues.find(item => time >= item.start && time < item.end);
  if (!cue || !cue.valid || !cue.nodes.every(node => node.isConnected) || normalize(cue.nodes.map(node => node.textContent).join(' ')) !== cue.text) { clearHighlight(); return; }
  if (cue.id === activeCue) return;
  clearHighlight(); activeCue = cue.id; activeNodes = cue.nodes;
  for (const node of activeNodes) node.classList.add('spoken');
  followActive();
}
function animateHighlight(){updateHighlight();if(!audio.paused&&!audio.ended)highlightFrame=requestAnimationFrame(animateHighlight);else highlightFrame=null;}
async function validateCues(index) {
  const version = ++cueVersion; clearHighlight(); validCues = [];
  const section = sections[index];
  const cues = await Promise.all(book.chapters[index].cues.map(async cue => {
    const nodes = [...section.querySelectorAll('[data-cue-id="'+cue.id+'"]')].filter(node => !node.closest('figure,figcaption,[data-no-narration]'));
    const text = normalize(nodes.map(node => node.textContent).join(' '));
    let valid = nodes.length > 0 && text === cue.text;
    if (valid && crypto.subtle) {
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(text)))].map(n=>n.toString(16).padStart(2,'0')).join('');
      valid = hash === cue.textHash;
    }
    return {...cue,nodes,valid};
  }));
  if (version !== cueVersion || index !== current) return;
  validCues = cues; cueNavigation.refresh(cues); updateHighlight();
}
function closeContents() { $('contents').classList.remove('open'); $('contents-toggle').setAttribute('aria-expanded','false'); }
const cueNavigation = initCueNavigation({
  root: $('reading'),
  resolve(node) {
    if (!sections[current]?.contains(node)) return null;
    const cue = validCues.find(item => item.id === node.dataset.cueId);
    return cue?.valid && cue.nodes.includes(node) && cue.nodes.every(item=>item.isConnected) && normalize(cue.nodes.map(item=>item.textContent).join(' ')) === cue.text ? cue : null;
  },
  activate(cue) {
    clearHighlight(); pendingTime=cue.start; pendingPlay=true;
    if (audio.readyState >= 1) {
      audio.currentTime=Math.min(cue.start,Math.max(0,audio.duration-.05)); pendingTime=null;
      savePosition();
    }
    void startPlayback();
  },
  unavailable() { clearHighlight(); status('This passage is not matched to the recording. Use the player to continue.'); }
});
async function startPlayback(token = epoch) {
  pendingPlay=true;
  if (!audio.getAttribute('src')) { status('Loading audio.'); return; }
  try {
    await audio.play();
    if (token !== epoch) return;
    status(objectURL ? 'Playing the saved offline copy' : 'Playing');
  } catch (error) {
    if (token !== epoch || error.name === 'AbortError') return;
    if (error.name === 'NotAllowedError') status('Press Play to start or resume audio.');
    else status('Audio unavailable. Connect to the internet or download this chapter first.');
    $('play').textContent = 'Play'; $('play').setAttribute('aria-label','Play audio');
    clearHighlight();
  }
}
async function selectChapter(index,{time=0,play=true,scroll=true}={}) {
  if (!book || index < 0 || index >= book.chapters.length) return;
  savePosition(); loading = true; const token = ++epoch;
  metadataController?.abort(); metadataController = new AbortController();
  pendingPlay=play;
  audio.pause(); audio.removeAttribute('src'); audio.load();
  if (objectURL) URL.revokeObjectURL(objectURL); objectURL = null;
  clearHighlight(); validCues = []; cueNavigation.refresh([]); current = index;
  bookmarks?.chapterChanged();
  const chapter = book.chapters[index]; pendingTime = Math.max(0,Number(time)||0);
  sections.forEach((section,i)=>{section.hidden=i!==index;});
  links.forEach((link,i)=>{if(i===index)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');});
  $('current-title').textContent = chapter.heading;
  $('previous').disabled = index === 0; $('next').disabled = index === book.chapters.length-1;
  $('seek').value = '0'; $('seek').max = String(chapter.duration); $('seek').disabled = true;
  $('elapsed').textContent = formatTime(time); $('duration').textContent = formatTime(chapter.duration);
  $('save-file').href = audioURL(chapter); $('save-file').download = chapter.heading+'.mp3';
  status('Loading audio…'); closeContents();
  history.replaceState(null,'','#'+chapter.id);
  if (scroll) window.scrollTo({top:0,behavior:'instant'});
  void validateCues(index);
  // Keep play() in the trusted gesture stack on WebKit. The service worker
  // serves verified saved audio (including ranges) at this same URL offline.
  const cached = navigator.userActivation?.isActive ? null : await localSource(chapter);
  if (token !== epoch) { if(cached)URL.revokeObjectURL(cached); return; }
  objectURL = cached;
  audio.addEventListener('loadedmetadata',()=>{
    if(token!==epoch)return;
    const duration=Number.isFinite(audio.duration)?audio.duration:chapter.duration;
    $('seek').max=String(duration);$('duration').textContent=formatTime(duration);$('seek').disabled=false;
    if(pendingTime!==null)audio.currentTime=Math.min(pendingTime,Math.max(0,duration-.05));
    pendingTime=null;loading=false;savePosition();
    if(!pendingPlay)status(objectURL?'Saved offline copy ready':'Ready to play');
  },{once:true,signal:metadataController.signal});
  audio.src=cached||audioURL(chapter);audio.load();
  if(pendingPlay)void startPlayback(token);
  return token;
}
function updateClock() {
  $('elapsed').textContent=formatTime(audio.currentTime);$('seek').value=String(audio.currentTime);
  updateHighlight();
  if(Date.now()-lastSaved>1000){savePosition();lastSaved=Date.now();}
}
audio.addEventListener('timeupdate',updateClock);
audio.addEventListener('play',()=>{$('play').textContent='Pause';$('play').setAttribute('aria-label','Pause audio');updateHighlight();});
audio.addEventListener('playing',()=>{status(objectURL?'Playing the saved offline copy':'Playing');if(highlightFrame===null)animateHighlight();});
audio.addEventListener('pause',()=>{$('play').textContent='Play';$('play').setAttribute('aria-label','Play audio');if(highlightFrame!==null)cancelAnimationFrame(highlightFrame);highlightFrame=null;clearHighlight();savePosition();});
audio.addEventListener('seeking',clearHighlight);
audio.addEventListener('seeked',()=>{updateClock();savePosition();});
audio.addEventListener('waiting',()=>{if(!audio.paused)status('Buffering audio…');clearHighlight();});
audio.addEventListener('error',()=>{loading=false;pendingTime=null;pendingPlay=false;clearHighlight();status('Audio unavailable. Connect to the internet or download this chapter first.');});
audio.addEventListener('ended',()=>{
  clearHighlight();savePosition();
  if(current<book.chapters.length-1)void selectChapter(current+1);
  else status('The end. Thank you for listening.');
});
$('play').addEventListener('click',()=>{if(audio.paused){void startPlayback();}else{audio.pause();status('Paused');}});
$('previous').addEventListener('click',()=>void selectChapter(current-1));
$('next').addEventListener('click',()=>void selectChapter(current+1));
$('seek').addEventListener('input',()=>{clearHighlight();if(Number.isFinite(audio.duration))audio.currentTime=Math.min(Number($('seek').value),audio.duration);});
for(const link of links)link.addEventListener('click',event=>{event.preventDefault();void selectChapter(Number(link.dataset.chapter));});
document.querySelector('[data-home]').addEventListener('click',event=>{event.preventDefault();void selectChapter(0);});
document.addEventListener('click',event=>{if(event.defaultPrevented||!book)return;const link=event.target.closest('a[href^="#"]');if(!link)return;const index=book.chapters.findIndex(c=>'#'+c.id===link.getAttribute('href'));if(index>=0){event.preventDefault();void selectChapter(index);}});
$('contents-toggle').addEventListener('click',()=>{const open=$('contents').classList.toggle('open');$('contents-toggle').setAttribute('aria-expanded',String(open));});
function showDownloads(show){$('downloads').hidden=!show;$('downloads-toggle').setAttribute('aria-expanded',String(show));if(show)$('downloads-close').focus();}
$('downloads-toggle').addEventListener('click',()=>showDownloads($('downloads').hidden));
$('downloads-close').addEventListener('click',()=>{showDownloads(false);$('downloads-toggle').focus();});
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'){closeContents();showDownloads(false);bookmarks?.close();}
});
let fontScale=1;
function fontSize(delta){fontScale=Math.max(.85,Math.min(1.4,fontScale+delta));document.documentElement.style.setProperty('--text-size',(1.15*fontScale)+'rem');followActive();}
$('text-smaller').addEventListener('click',()=>fontSize(-.05));$('text-larger').addEventListener('click',()=>fontSize(.05));
addEventListener('pagehide',savePosition);document.addEventListener('visibilitychange',()=>{if(document.hidden)savePosition();});
function connection(){if(!storageWarning)$('connection-status').textContent=navigator.onLine?'':'Offline';}
addEventListener('online',connection);addEventListener('offline',connection);connection();
new MutationObserver(()=>{if(book)void validateCues(current);}).observe($('reading'),{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['data-cue-id']});

function offlineStatus(state){
  document.querySelectorAll('[data-offline]').forEach((node,i)=>{node.textContent=state.available[i]?'Saved offline':'';});
  $('storage-status').textContent=state.available.filter(Boolean).length+' of '+book.chapters.length+' audio files saved · '+(state.downloadedBytes/1e6).toFixed(1)+' / '+(state.totalBytes/1e6).toFixed(1)+' MB';
  $('download-all').textContent='Download whole book · '+(state.totalBytes/1e6).toFixed(1)+' MB';
}
function downloadControls(busy){
  downloadBusy=busy;
  for(const id of ['download-current','download-all','remove-current','remove-all'])$(id).disabled=busy||!offlineReady;
  $('download-cancel').hidden=!busy;$('download-progress').hidden=!busy;
}
async function download(indices){
  if(!offlineReady||downloadBusy)return;downloadControls(true);$('download-progress').value=0;
  try{await downloadAudio(indices,p=>{if(p.fraction!==undefined)$('download-progress').value=p.fraction;$('download-status').textContent=p.message;});}
  catch(error){$('download-status').textContent=error.message||'Download failed. Retry when connected.';}
  finally{downloadControls(false);}
}
$('download-current').addEventListener('click',()=>void download([current]));
$('download-all').addEventListener('click',()=>void download(book.chapters.map((_,i)=>i)));
$('download-cancel').addEventListener('click',cancelDownload);
async function remove(indices){try{await removeOffline(indices);$('download-status').textContent='Selected offline copies removed. Online playback is still available.';}catch(error){$('download-status').textContent=error.message;}}
$('remove-current').addEventListener('click',()=>void remove([current]));
$('remove-all').addEventListener('click',()=>void remove(book.chapters.map((_,i)=>i)));

try {
  const response=await fetch('./book.json');if(!response.ok)throw new Error('Book data unavailable');book=await response.json();
  bookmarks=initBookmarks({book,sections,current:()=>current,cues:()=>validCues,
    spokenCue:()=>!loading&&!audio.paused&&!audio.seeking&&!audio.ended ? validCues.find(c=>c.id===activeCue&&audio.currentTime>=c.start&&audio.currentTime<c.end) : null,
    async navigate(item){
    const index=book.chapters.findIndex(c=>c.id===item.chapterId);
    if(index<0){status('This bookmarked chapter is no longer in this edition.');return {section:sections[current],message:'This bookmarked chapter is no longer in this edition.',playing:false};}
    const section=sections[index], range=resolveRange(item,section);
    const candidate=book.chapters[index].cues.find(c=>c.id===item.cueId&&c.textHash===item.cueHash);
    const nodes=candidate?[...section.querySelectorAll('[data-cue-id]')].filter(n=>n.dataset.cueId===candidate.id):[];
    const cue=range && candidate && nodes.length && normalize(nodes.map(n=>n.textContent).join(' '))===candidate.text ? candidate:null;
    const task=selectChapter(index,{time:cue?.start||0,play:Boolean(cue),scroll:false});
    const expected=epoch;await task;if(epoch!==expected)return null;
    return {section,playing:Boolean(cue),message:cue?'':range?'No matching narration cue. Text opened without starting audio.':'The saved quote changed or moved. Audio was not started.'};
  }});
  let index=0,time=0;
  try{const saved=JSON.parse(localStorage.getItem(saveKey())||'null');if(saved?.version===book.version){const found=book.chapters.findIndex(c=>c.id===saved.chapter);if(found>=0&&Number.isFinite(saved.time)){index=found;time=Math.max(0,saved.time);}}}catch{storageWarning=true;}
  const bookmark=book.chapters.findIndex(chapter=>'#'+chapter.id===location.hash);
  if(bookmark>=0&&bookmark!==index){index=bookmark;time=0;}
  // Configure cache identity before playback lookup; optional setup runs independently.
  initOffline(book,offlineStatus).then(()=>{offlineReady=true;downloadControls(false);}).catch(error=>{$('storage-status').textContent=error.message;offlineReady=false;downloadControls(false);});
  await selectChapter(index,{time,play:true});
  downloadControls(false);
} catch(error) {status('Open this website through HTTP/HTTPS, then reload. '+error.message);}
