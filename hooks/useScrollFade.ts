'use client';

import { useCallback, useEffect, useState, type Ref } from 'react';

/** Observe the mounted scrollport and its content, including portaled dialogs. */
export function useScrollFade<T extends HTMLElement>(forwardedRef?: Ref<T>) {
  const [element, setElement] = useState<T | null>(null);
  const ref = useCallback((node: T | null) => {
    setElement(node);
    if (typeof forwardedRef === 'function') {
      const cleanup = forwardedRef(node);
      if (typeof cleanup === 'function') return () => { setElement(null); cleanup(); };
    }
    else if (forwardedRef) forwardedRef.current = node;
  }, [forwardedRef]);

  useEffect(() => {
    if (!element) return;
    let frame = 0;
    let disposed = false;
    const update = () => {
      frame = 0;
      if (disposed) return;
      const extent = element.scrollHeight - element.clientHeight;
      element.toggleAttribute('data-scroll-fade-top', extent > 2 && element.scrollTop > 2);
      element.toggleAttribute('data-scroll-fade-bottom', extent > 2 && element.scrollTop < extent - 2);
      if (element.hasAttribute('data-scroll-fade-top')) element.setAttribute('data-scroll-fade-top', 'true');
      if (element.hasAttribute('data-scroll-fade-bottom')) element.setAttribute('data-scroll-fade-bottom', 'true');
    };
    const schedule = () => { if (!disposed && !frame) frame = requestAnimationFrame(update); };
    const sizes = new ResizeObserver(schedule);
    const observeContent = () => {
      sizes.disconnect();
      sizes.observe(element);
      for (const child of element.children) sizes.observe(child);
      schedule();
    };
    // This observer belongs to one scrollport. Fade attributes are deliberately
    // excluded, so publishing a fade does not schedule another measurement.
    const content = new MutationObserver(observeContent);
    content.observe(element, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'open'] });
    element.addEventListener('scroll', schedule, { passive: true });
    element.addEventListener('load', schedule, true);
    document.fonts?.addEventListener('loadingdone', schedule);
    observeContent();
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      sizes.disconnect();
      content.disconnect();
      element.removeEventListener('scroll', schedule);
      element.removeEventListener('load', schedule, true);
      document.fonts?.removeEventListener('loadingdone', schedule);
      element.removeAttribute('data-scroll-fade-top');
      element.removeAttribute('data-scroll-fade-bottom');
    };
  }, [element]);
  return ref;
}
