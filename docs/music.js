import {musicBytes, musicSaved, downloadMusic, removeMusic} from './music-cache.js';

// Web Audio buffers avoid iOS media-element volume limits and a second media player.
// Only current + next track are retained. The narration element remains untouched.
export function initMusic({audio, get=document.getElementById.bind(document), Context=window.AudioContext || window.webkitAudioContext, load=musicBytes}) {
  let context, gain, source, started=0, offset=0, index=0, sequence=0, audible=false;
  let tracks=[], volume=.08, muted=false, downloading, failure=false, busy=false;
  const buffers=new Map();
  const label=get('music-status'), slider=get('music-volume'), toggle=get('music-mute');
  const panel=get('music-panel'), opener=get('music-toggle');
  const enable=get('music-enable');
  opener.addEventListener('click',()=>{
    panel.showModal();opener.setAttribute('aria-expanded','true');get('music-close').focus();
  });
  get('music-close').addEventListener('click',()=>panel.close());
  panel.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();panel.close();}});
  panel.addEventListener('close',()=>{opener.setAttribute('aria-expanded','false');opener.focus();});
  panel.addEventListener('click',event=>{
    if(event.target!==panel)return;
    const r=panel.getBoundingClientRect();
    if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)panel.close();
  });
  const say=text=>{label.textContent=text;};
  function controlState() {
    const enabled=context?.state==='running' && !muted && volume>0 && !failure;
    enable.disabled=Boolean(enabled);
    enable.textContent=enabled?(source?'Music playing':busy?'Loading music…':'Music enabled'):(failure?'Retry music':'Enable music');
    if(muted)say('Music is muted. Unmute or Enable music to hear it with narration.');
    else if(volume===0)say('Music volume is 0%. Raise it or Enable music to restore 8%.');
    else if(enabled&&!audible)say('Music enabled — press Play in the audiobook player.');
  }
  try { const saved=JSON.parse(localStorage.getItem('sin-star-music-settings-v1'));
    if (saved && Number.isFinite(saved.volume)) volume=Math.max(0,Math.min(1,saved.volume));
    muted=saved?.muted===true;
  } catch { /* The control also works without persistent storage. */ }
  function paint() {
    slider.value=String(Math.round(volume*100)); get('music-level').textContent=slider.value+'%';
    toggle.textContent=muted?'Unmute':'Mute'; toggle.setAttribute('aria-pressed',String(muted));
    if (gain) gain.gain.setValueAtTime(muted?0:volume,context.currentTime);
    try {localStorage.setItem('sin-star-music-settings-v1',JSON.stringify({volume,muted}));} catch {}
    controlState();
  }
  function stop() {
    sequence++;
    if (source) {
      offset=Math.min(source.buffer.duration,offset+Math.max(0,context.currentTime-started));
      source.onended=null; source.stop(); source.disconnect(); source=null;
    }
  }
  function pause() { audible=false; stop(); busy=false;if(!failure)say('Music follows narration');controlState(); }
  async function buffer(i) {
    if(!buffers.has(i)) {
      const job=load(tracks[i]).then(bytes=>context.decodeAudioData(bytes));
      buffers.set(i,job); job.catch(()=>{if(buffers.get(i)===job)buffers.delete(i);});
    }
    return buffers.get(i);
  }
  async function play() {
    if(source || !audible || audio.paused || audio.ended || !tracks.length || muted || volume===0) return;
    if(!context || context.state!=='running') {say('Tap Enable music to listen');return;}
    const token=++sequence;
    busy=true;say('Loading music…');controlState();
    for(let attempt=0; attempt<tracks.length; attempt++) {
      try {
        const decoded=await buffer(index);
        if(token!==sequence || !audible || audio.paused || context.state!=='running')return;
        if(offset>=decoded.duration)offset=0;
        source=context.createBufferSource(); source.buffer=decoded; source.connect(gain);
        started=context.currentTime;
        source.onended=()=>{
          source?.disconnect(); source=null; offset=0; index=(index+1)%tracks.length;
          void play();
        };
        source.start(0,offset); failure=false;busy=false;controlState();
        say(tracks[index].title);
        const next=(index+1)%tracks.length;
        for(const key of buffers.keys())if(key!==index&&key!==next)buffers.delete(key);
        void buffer(next).catch(()=>{});
        return;
      } catch {
        if(token!==sequence)return;
        offset=0; index=(index+1)%tracks.length;
      }
    }
    failure=true;busy=false;controlState();say('Music unavailable — narration can continue. Use Retry music when connected.');
  }
  function gesture() {
    if(!Context){say('Music is unsupported in this browser');return;}
    try {
      if(!context) {
        context=new Context(); gain=context.createGain(); gain.gain.value=muted?0:volume; gain.connect(context.destination);
        context.addEventListener('statechange',()=>{
          if(context.state!=='running') {stop();busy=false;controlState();say('Tap Enable music to resume');}
          else if(audible)void play();
        });
      }
      // resume is called directly inside the click/key handler, before any fetch.
      void context.resume().then(()=>{failure=false;controlState();if(audible)void play();}).catch(()=>{failure=true;controlState();say('Tap Retry music to resume');});
    } catch {say('Music unavailable — narration can continue');}
  }
  audio.addEventListener('playing',()=>{audible=true;void play();});
  for(const name of ['pause','ended','waiting','emptied','error'])audio.addEventListener(name,pause);
  window.addEventListener('pagehide',pause);
  slider.addEventListener('input',()=>{gesture();volume=Number(slider.value)/100;paint();if(volume===0)stop();else void play();});
  toggle.addEventListener('click',()=>{gesture();muted=!muted;paint();if(muted)stop();else void play();});
  enable.addEventListener('click',()=>{
    muted=false;if(volume===0)volume=.08;failure=false;paint();
    say('Enabling music…');gesture();
  });
  async function savedStatus() {
    try {const saved=await musicSaved(tracks);get('music-storage-status').textContent=saved.filter(Boolean).length+' of '+tracks.length+' music tracks saved in this browser';}
    catch {get('music-storage-status').textContent='Music storage unavailable. Online music is still available.';}
  }
  get('music-download').addEventListener('click',async()=>{
    if(downloading||!tracks.length)return;
    downloading=new AbortController();get('music-cancel').hidden=false;get('music-download').disabled=true;get('music-remove').disabled=true;
    let warning='';
    try {await downloadMusic(tracks,downloading.signal,text=>{get('music-storage-status').textContent=text;});}
    catch(error){warning=error.name==='AbortError'?'Cancelled; completed music downloads are kept.':error.message;}
    finally {downloading=null;get('music-cancel').hidden=true;get('music-download').disabled=false;get('music-remove').disabled=false;await savedStatus();if(warning)get('music-storage-status').textContent+=' · '+warning;}
  });
  get('music-cancel').addEventListener('click',()=>downloading?.abort());
  get('music-remove').addEventListener('click',async()=>{try{await removeMusic();await savedStatus();}catch{get('music-storage-status').textContent='Music copies could not be removed.';}});
  paint();
  const ready=fetch('./music.json').then(r=>{if(!r.ok)throw new Error();return r.json();}).then(data=>{
    tracks=data.tracks;get('music-download').disabled=false;
    get('music-download').textContent='Download music · '+(tracks.reduce((n,t)=>n+t.bytes,0)/1e6).toFixed(1)+' MB';
    void savedStatus(); if(audible)void play();
  }).catch(()=>{failure=true;say('Music unavailable — narration can continue');get('music-storage-status').textContent='Music list unavailable.';});
  return {gesture, ready};
}
