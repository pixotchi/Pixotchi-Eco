'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type AssetNameSession = { identity: string; generation: number };

/** A live name refresh must not replace a draft or reopen a completed presentation. */
export function useAssetNameDraft(identity: string, currentName: string) {
  const [isOpen, setIsOpen] = useState(false);
  const [newName, setNewName] = useState(currentName);
  const [isTransactionPending, setIsTransactionPending] = useState(false);
  const identityRef = useRef(identity);
  const nameRef = useRef(currentName);
  const generation = useRef(0);
  const openRef = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  identityRef.current = identity;
  nameRef.current = currentName;

  const cancelAutoClose = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const onOpenChange = useCallback((nextOpen: boolean) => {
    cancelAutoClose();
    generation.current += 1;
    openRef.current = nextOpen;
    setIsOpen(nextOpen);
    if (nextOpen) {
      setNewName(nameRef.current);
      setIsTransactionPending(false);
    }
  }, [cancelAutoClose]);

  useEffect(() => {
    // A different wallet/asset gets its own draft and pending presentation.
    generation.current += 1;
    cancelAutoClose();
    setNewName(nameRef.current);
    setIsTransactionPending(false);
    return cancelAutoClose;
  }, [identity, cancelAutoClose]);

  useEffect(() => () => {
    generation.current += 1;
    openRef.current = false;
    cancelAutoClose();
  }, [cancelAutoClose]);

  const beginTransaction = () => {
    cancelAutoClose();
    generation.current += 1;
    setIsTransactionPending(true);
    return { identity: identityRef.current, generation: generation.current };
  };
  const isCurrentSession = (session: AssetNameSession) => (
    session.identity === identityRef.current && session.generation === generation.current && openRef.current
  );
  const scheduleAutoClose = (session: AssetNameSession) => {
    if (!isCurrentSession(session)) return;
    cancelAutoClose();
    timer.current = setTimeout(() => {
      timer.current = null;
      if (isCurrentSession(session)) onOpenChange(false);
    }, 1000);
  };

  return { isOpen, newName, setNewName, isTransactionPending, setIsTransactionPending, onOpenChange, beginTransaction, isCurrentSession, scheduleAutoClose };
}
