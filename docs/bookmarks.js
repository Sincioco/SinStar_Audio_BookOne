import {captureSelection, resolveRange, cleanBookmarks} from './bookmark-anchors.js';

export function initBookmarks({book, sections, current, cues, navigate, get=document.getElementById.bind(document)}) {
  const key='sin-star-book-one-bookmarks-v1';
  const panel=get('bookmarks'), list=get('bookmark-list'), toggle=get('bookmarks-toggle');
  let items=[], draft=null, memoryOnly=false, corrupt=false, highlighted=[];
  function message(text){get('bookmark-status').textContent=text;}
  try {
    const raw=localStorage.getItem(key);
    if(raw){const parsed=JSON.parse(raw);if(!Array.isArray(parsed))throw new Error();items=cleanBookmarks(parsed);}
  } catch {memoryOnly=true;corrupt=true;}
  function persist() {
    if(corrupt) {message('Existing bookmark storage could not be read. Changes are kept for this visit only.');return;}
    try {localStorage.setItem(key,JSON.stringify(items));memoryOnly=false;}
    catch {memoryOnly=true;}
    message(memoryOnly?'Browser storage unavailable. Changes are kept for this visit only.':'Saved on this browser and device.');
  }
  function clearHighlight() {
    globalThis.CSS?.highlights?.delete('bookmark');
    for(const node of highlighted)node.classList.remove('bookmarked'); highlighted=[];
  }
  function highlight(range,section) {
    clearHighlight();
    if(globalThis.CSS?.highlights && globalThis.Highlight)CSS.highlights.set('bookmark',new Highlight(range));
    else {
      highlighted=[...section.querySelectorAll('[data-narratable]')].filter(node=>range.intersectsNode(node));
      if(!highlighted.length)highlighted=[section];
      for(const node of highlighted)node.classList.add('bookmarked');
    }
    const rect=range.getClientRects()[0];
    if(rect)window.scrollTo({top:window.scrollY+rect.top-document.querySelector('.topbar').getBoundingClientRect().bottom-24,behavior:'instant'});
  }
  function show(open) {
    panel.hidden=!open;toggle.setAttribute('aria-expanded',String(open));
    if(open){get('bookmark-close').focus();renderDraft();}
  }
  function renderDraft() {
    get('bookmark-composer').open=Boolean(draft);
    get('bookmark-quote').textContent=draft?.quote||'Select text in the chapter, then open Bookmarks.';
    get('bookmark-save').disabled=!draft;
    get('bookmark-match').textContent=draft?(draft.cueId?'Playback will begin at the first matched passage.':'No matching narration cue. This bookmark will open the text without starting audio.'):'';
  }
  function capture() {
    const candidate=captureSelection(window.getSelection(),sections[current()],book.chapters[current()],cues());
    if(candidate){draft=candidate;renderDraft();}
  }
  document.addEventListener('selectionchange',capture);
  toggle.addEventListener('pointerdown',capture);
  toggle.addEventListener('click',()=>{capture();show(panel.hidden);});
  get('bookmark-close').addEventListener('click',()=>{show(false);toggle.focus();});
  panel.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();show(false);toggle.focus();}});
  function button(text,action) {const b=document.createElement('button');b.type='button';b.textContent=text;b.addEventListener('click',action);return b;}
  function render() {
    list.replaceChildren();
    if(!items.length){const p=document.createElement('p');p.textContent='No bookmarks yet.';list.append(p);}
    for(const item of items) {
      const card=document.createElement('li'), chapter=document.createElement('p'), quote=document.createElement('blockquote'), note=document.createElement('p'), actions=document.createElement('div');
      chapter.className='bookmark-chapter';chapter.textContent=item.chapterLabel||item.chapterId;
      quote.textContent=item.quote;note.className='bookmark-note';note.textContent=item.note||'No note';actions.className='bookmark-actions';
      const open=button('Open & listen',async()=>{
        show(false);
        const result=await navigate(item);
        if(!result)return;
        const range=resolveRange(item,result.section);
        if(range){highlight(range,result.section);result.section.tabIndex=-1;result.section.focus({preventScroll:true});}
        else {clearHighlight();message('The saved quote has changed or moved. The chapter is open; its old text anchor was not used.');show(true);}
        if(result.message){message(result.message);if(!result.playing)show(true);}
      });
      const edit=button('Edit note',()=>{
        const label=document.createElement('label');label.textContent='Bookmark note';
        const input=document.createElement('textarea');input.value=item.note;input.maxLength=10000;label.append(input);
        const editor=document.createElement('div');editor.append(label);
        const save=button('Save note',()=>{item.note=input.value;persist();render();toggle.focus();});
        const cancel=button('Cancel',()=>{render();toggle.focus();});editor.append(save,cancel);actions.replaceWith(editor);input.focus();
      });
      const remove=button('Delete',()=>{
        actions.replaceChildren(document.createTextNode('Delete this bookmark? '),button('Delete bookmark',()=>{items=items.filter(b=>b.id!==item.id);persist();render();get('bookmark-close').focus();}),button('Keep',render));
      });
      actions.append(open,edit,remove);card.append(chapter,quote,note,actions);list.append(card);
    }
  }
  get('bookmark-save').addEventListener('click',()=>{
    if(!draft)return;
    if(items.length>=500){message('This browser has 500 bookmarks. Delete one before adding another.');return;}
    items.unshift({...draft,id:crypto.randomUUID(),note:get('bookmark-note').value.slice(0,10000)});
    window.getSelection()?.removeAllRanges();
    draft=null;get('bookmark-note').value='';persist();render();renderDraft();
    list.querySelector('button')?.focus({preventScroll:true});
  });
  window.addEventListener('storage',event=>{
    if(event.key!==key||memoryOnly)return;
    try{items=cleanBookmarks(JSON.parse(event.newValue||'[]'));render();message('Bookmarks updated in another tab.');}catch{message('Another tab saved unreadable bookmark data.');}
  });
  render();renderDraft();
  message(memoryOnly?'Bookmark storage is unavailable. Changes are kept for this visit only.':'Bookmarks and notes stay in this browser on this device.');
  return {chapterChanged(){draft=null;renderDraft();clearHighlight();}, close(){show(false);}};
}
