// Pointer and keyboard access to the existing narration segments.
export function initCueNavigation({root, resolve, activate, unavailable}) {
  let nodes = [], pointer = null;
  const excluded = 'a,button,input,textarea,select,figure,figcaption,[data-no-narration],[contenteditable="true"]';
  const target = element => element instanceof Element && !element.closest(excluded) ? element.closest('span[data-cue-id]') : null;
  function focusable(node) {
    for (const item of nodes) item.tabIndex = item === node ? 0 : -1;
  }
  function play(node) {
    const cue = resolve(node);
    if (!cue) { unavailable(); return; }
    focusable(node);
    activate(cue);
  }
  root.addEventListener('pointerdown', event => {
    pointer = {id:event.pointerId, x:event.clientX, y:event.clientY, moved:false,
      touch:event.pointerType==='touch', started:performance.now(), selecting:!window.getSelection()?.isCollapsed};
  }, {passive:true});
  root.addEventListener('pointermove', event => {
    if (pointer?.id === event.pointerId && Math.hypot(event.clientX-pointer.x,event.clientY-pointer.y)>6) pointer.moved = true;
  }, {passive:true});
  root.addEventListener('pointercancel', () => { if(pointer)pointer.moved=true; }, {passive:true});
  root.addEventListener('contextmenu', () => { if(pointer)pointer.selecting=true; });
  document.addEventListener('selectionchange',()=>{if(pointer&&!window.getSelection()?.isCollapsed)pointer.selecting=true;});
  root.addEventListener('click', event => {
    const moved = pointer?.moved || pointer?.selecting || (pointer?.touch && performance.now()-pointer.started>450); pointer = null;
    if (event.defaultPrevented || event.button !== 0 || event.detail > 1 || moved || !window.getSelection()?.isCollapsed) return;
    const node = target(event.target);
    if (!node) return;
    play(node);
  });
  root.addEventListener('keydown', event => {
    const node = target(event.target);
    if (!node || !nodes.includes(node) || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault(); if(!event.repeat)play(node); return;
    }
    const index = nodes.indexOf(node);
    const next = event.key === 'ArrowRight' ? index+1 : event.key === 'ArrowLeft' ? index-1 : event.key === 'Home' ? 0 : event.key === 'End' ? nodes.length-1 : null;
    if (next === null) return;
    event.preventDefault(); event.stopPropagation();
    const selected = nodes[Math.max(0,Math.min(nodes.length-1,next))];
    focusable(selected); selected.focus();
  });
  return {
    refresh(cues) {
      const previous = nodes.find(node => node.tabIndex === 0);
      for (const node of nodes) {
        node.removeAttribute('role'); node.removeAttribute('tabindex'); node.removeAttribute('aria-describedby');
      }
      nodes = cues.filter(cue=>cue.valid).flatMap(cue=>cue.nodes).filter(node=>!node.closest(excluded) && !node.querySelector(excluded));
      for (const node of nodes) {
        node.setAttribute('role','button'); node.tabIndex=-1; node.setAttribute('aria-describedby','passage-help');
      }
      if (nodes.length) focusable(nodes.includes(previous) ? previous : nodes[0]);
    }
  };
}
