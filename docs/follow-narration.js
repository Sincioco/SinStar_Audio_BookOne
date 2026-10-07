// Keep the start of the current spoken passage clear of the fixed controls.
// Only the checkbox controls opting out; scrolling and gestures keep following.
export function initNarrationFollow({reading, checkbox, audio, activeNodes, header, player}) {
  let frame = null, lastTarget = null;
  const margin = 16;
  function follow() {
    if (!checkbox.checked || audio.paused) { lastTarget = null; return; }
    const lines = activeNodes().flatMap(node => [...node.getClientRects()])
      .filter(rect => rect.width > 0 && rect.height > 0);
    const line = lines[0];
    if (!line) return;
    const viewport = window.visualViewport;
    const viewTop = viewport?.offsetTop ?? 0;
    const viewBottom = viewTop + (viewport?.height ?? window.innerHeight);
    const head = header.getBoundingClientRect(), foot = player.getBoundingClientRect();
    let top = viewTop + margin, bottom = viewBottom - margin;
    if (head.bottom > viewTop && head.top < viewBottom) top = Math.max(top, head.bottom + margin);
    if (foot.bottom > viewTop && foot.top < viewBottom) bottom = Math.min(bottom, foot.top - margin);
    if (bottom <= top) return;
    if (line.top >= top && lines.at(-1).bottom <= bottom) { lastTarget = null; return; }
    const scroller = document.scrollingElement;
    const pageTop = viewport?.pageTop ?? window.scrollY;
    const max = Math.max(0, scroller.scrollHeight - (viewport?.height ?? scroller.clientHeight));
    const target = Math.max(0, Math.min(max, pageTop + line.top - top));
    if (Math.abs(pageTop - target) < 1) { lastTarget = null; return; }
    const immediate = matchMedia('(prefers-reduced-motion: reduce), (pointer: coarse), (max-width: 900px)').matches;
    if (!immediate && lastTarget !== null && Math.abs(lastTarget - target) < 1) return;
    lastTarget = target;
    window.scrollTo({top: target, left: viewport?.pageLeft ?? window.scrollX, behavior: immediate ? 'instant' : 'smooth'});
  }
  function schedule() {
    if (frame !== null) return;
    frame = requestAnimationFrame(() => { frame = null; follow(); });
  }
  // Each visit starts following, including browser-restored form/BFCache state.
  // Manual opt-out still lasts for the rest of the current visit.
  function resetForVisit() { checkbox.checked = true; lastTarget = null; schedule(); }
  window.addEventListener('pageshow', resetForVisit);
  resetForVisit();
  function refollow() { lastTarget = null; schedule(); }
  checkbox.addEventListener('change', refollow);
  for (const name of ['wheel', 'touchstart', 'touchmove', 'touchend', 'touchcancel']) {
    reading.addEventListener(name, refollow, {passive: true});
  }
  window.addEventListener('keydown', event => {
    if (['PageDown', 'PageUp', 'Home', 'End', 'ArrowDown', 'ArrowUp', ' '].includes(event.key)) refollow();
  });
  window.addEventListener('pointerdown', refollow, {passive: true});
  window.addEventListener('pointerup', refollow, {passive: true});
  window.addEventListener('scroll', schedule, {passive: true});
  window.addEventListener('resize', schedule);
  window.addEventListener('orientationchange', schedule);
  window.visualViewport?.addEventListener('resize', schedule);
  window.visualViewport?.addEventListener('scroll', schedule);
  const observer = new ResizeObserver(schedule);
  for (const node of [reading, header, player]) observer.observe(node);
  return schedule;
}
