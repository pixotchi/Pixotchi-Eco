'use client';

import { useCallback, useMemo, useState } from 'react';
import { loadChatLastRead, storeChatLastRead } from '@/lib/chat-preferences';
import type { AIChatMessage, ChatMessage } from '@/lib/types';

/** Read-position persistence and the header badge are independent of chat's
 * authentication, history transport and AI streaming lifecycle. */
export function usePublicChatUnread(
  messages: readonly (ChatMessage | AIChatMessage)[],
  isChatOpen: boolean,
  publicIdentityAddress: string | null,
) {
  const [lastReadTimestamp, setLastReadTimestamp] = useState(loadChatLastRead);
  const unreadCount = useMemo(() => messages.filter(message => {
    const isNew = message.timestamp > lastReadTimestamp;
    const isFromMe = publicIdentityAddress && message.address
      ? message.address.toLowerCase() === publicIdentityAddress.toLowerCase()
      : false;
    return isNew && !isFromMe;
  }).length, [lastReadTimestamp, messages, publicIdentityAddress]);

  const markAsRead = useCallback((throughTimestamp: number) => {
    if (!isChatOpen || !Number.isFinite(throughTimestamp)) return;
    setLastReadTimestamp(previous => {
      const next = Math.max(previous, Math.min(Date.now(), throughTimestamp));
      storeChatLastRead(next);
      return next;
    });
  }, [isChatOpen]);

  return { unreadCount, markAsRead };
}
