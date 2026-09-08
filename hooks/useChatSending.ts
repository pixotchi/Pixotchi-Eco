'use client';

import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { ChatMode } from '@/lib/types';

/** Each pane owns its operation; finishing Public cannot clear a pending AI send. */
export function useChatSending(principal: string) {
  const active = useRef<Partial<Record<ChatMode, AbortController>>>({});
  const [snapshot, setSnapshot] = useState<{ principal: string; public: boolean; ai: boolean }>({ principal, public: false, ai: false });
  useLayoutEffect(() => {
    active.current = {};
    setSnapshot({ principal, public: false, ai: false });
    return () => { Object.values(active.current).forEach(controller => controller.abort()); active.current = {}; };
  }, [principal]);
  const begin = useCallback((mode: ChatMode) => {
    if (active.current[mode]) return null;
    const token = new AbortController();
    active.current[mode] = token;
    setSnapshot(current => ({ ...current, principal, [mode]: true }));
    const finish = () => {
      if (active.current[mode] !== token) return;
      delete active.current[mode];
      setSnapshot(current => ({ ...current, [mode]: false }));
    };
    return {
      signal: token.signal,
      finish,
      // Credential providers may not accept AbortSignal. Stop must still settle
      // our attempt immediately and prevent their delayed result from sending.
      waitFor: <T,>(pending: Promise<T>): Promise<T> => new Promise((resolve, reject) => {
        const cancelled = () => reject(new DOMException('Send cancelled', 'AbortError'));
        if (token.signal.aborted) { cancelled(); return; }
        token.signal.addEventListener('abort', cancelled, { once: true });
        pending.then(resolve, reject).finally(() => token.signal.removeEventListener('abort', cancelled));
      }),
    };
  }, [principal]);
  const cancel = useCallback((mode: ChatMode) => active.current[mode]?.abort(), []);
  const sending = snapshot.principal === principal ? snapshot : { public: false, ai: false };
  return { begin, cancel, publicSending: sending.public, aiSending: sending.ai };
}
