// Durable anchors are block IDs + UTF-16 text offsets, with an exact quote check.
// A cue ID/hash is independent: it determines whether narration can safely seek.
export function cleanBookmarks(value) {
  if(!Array.isArray(value))return [];
  return value.filter(b=>b && typeof b.id==='string' && typeof b.chapterId==='string' && typeof b.quote==='string' && b.quote.length>0 && b.quote.length<=20000)
    .slice(0,500).map(b=>({...b,note:typeof b.note==='string'?b.note.slice(0,10000):''}));
}
function element(node) {return node?.nodeType===1?node:node?.parentElement;}
function point(section,node,offset) {
  const block=element(node)?.closest('[data-narratable][id]') || section;
  const range=document.createRange();range.selectNodeContents(block);range.setEnd(node,offset);
  return {blockId:block.id,offset:range.toString().length};
}
function textPoint(block,offset) {
  if(!Number.isInteger(offset)||offset<0)return null;
  const walker=document.createTreeWalker(block,NodeFilter.SHOW_TEXT);
  for(let node; (node=walker.nextNode());) {
    if(offset<=node.length)return {node,offset};
    offset-=node.length;
  }
  return null;
}
export function captureSelection(selection,section,chapter,cues) {
  if(!selection?.rangeCount||selection.isCollapsed||!section)return null;
  const range=selection.getRangeAt(0);
  if(!section.contains(range.startContainer)||!section.contains(range.endContainer))return null;
  const quote=range.toString();
  if(!quote.trim()||quote.length>20000)return null;
  // Only actual nonempty overlap counts, not an adjacent cue at a range boundary.
  const cue=cues.find(c=>c.valid&&c.nodes.some(node=>{
    if(!range.intersectsNode(node))return false;
    const test=range.cloneRange(), bounds=document.createRange();bounds.selectNodeContents(node);
    if(test.compareBoundaryPoints(Range.START_TO_START,bounds)<0)test.setStart(bounds.startContainer,bounds.startOffset);
    if(test.compareBoundaryPoints(Range.END_TO_END,bounds)>0)test.setEnd(bounds.endContainer,bounds.endOffset);
    return Boolean(test.toString().trim());
  }));
  return {chapterId:chapter.id,chapterLabel:chapter.heading,quote,start:point(section,range.startContainer,range.startOffset),end:point(section,range.endContainer,range.endOffset),cueId:cue?.id||null,cueHash:cue?.textHash||null};
}
export function resolveRange(bookmark,section) {
  try {
    const blocks=[section,...section.querySelectorAll('[data-narratable][id]')];
    const start=blocks.find(n=>n.id===bookmark.start?.blockId),end=blocks.find(n=>n.id===bookmark.end?.blockId);
    if(!start||!end)return null;
    const a=textPoint(start,bookmark.start.offset),b=textPoint(end,bookmark.end.offset);
    if(!a||!b)return null;
    const range=document.createRange();range.setStart(a.node,a.offset);range.setEnd(b.node,b.offset);
    return range.toString()===bookmark.quote?range:null;
  } catch {return null;}
}
export function resolveBookmarkCue(bookmark,cues) {
  return cues.find(c=>c.valid && c.id===bookmark.cueId && c.textHash===bookmark.cueHash) || null;
}

// Freeze the actual highlighted cue; never recover a cleared or stale highlight.
export function captureSpokenCue(cue,section,chapter) {
  if(!cue?.valid || !cue.nodes?.length || !section)return null;
  const nodes=cue.nodes;
  if(!nodes.every(n=>n.isConnected && section.contains(n) && n.classList.contains('spoken')))return null;
  const normalize=text=>(text.match(/[\p{L}\p{N}_]+/gu)||[]).join(' ');
  if(normalize(nodes.map(n=>n.textContent).join(' '))!==cue.text)return null;
  const range=document.createRange();range.selectNodeContents(nodes[0]);
  const last=nodes[nodes.length-1];range.setEnd(last,last.childNodes.length);
  return captureSelection({rangeCount:1,isCollapsed:false,getRangeAt:()=>range},section,chapter,[cue]);
}
