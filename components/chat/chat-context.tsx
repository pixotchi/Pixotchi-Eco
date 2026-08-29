"use client";

import React, {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useChat as useAIChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { useIdentityToken, usePrivy } from '@privy-io/react-auth';
import toast from 'react-hot-toast';
import { useAccount } from 'wagmi';
import { sdk } from '@farcaster/miniapp-sdk';
import { useFrameContext } from '@/lib/frame-context';
import {
  clearPublicChatSession,
  createBasePublicChatSession,
  createFarcasterPublicChatSession,
  createPrivyPublicChatSession,
  getCurrentPublicChatSession,
  getCurrentPublicChatSessionForAddress,
  PUBLIC_CHAT_SESSION_EVENT,
  type PublicChatSession,
} from '@/lib/chat-auth-client';
import { requestBaseChatSessionRefresh } from '@/lib/base-chat-session-refresh';
import {
  clearConfirmedMiniAppSession,
  useConfirmedMiniAppSession,
} from '@/lib/confirmed-miniapp-session';
import { getMiniAppQuickAuthHeaders } from '@/lib/farcaster-miniapp-auth-client';
import {
  loadChatLastRead,
  loadChatMode,
  storeChatLastRead,
  storeChatMode,
} from '@/lib/chat-preferences';
import { resolvePreferredAuthSurface, SecureSessionState } from '@/lib/auth-surface';
import { sessionStorageManager } from '@/lib/session-storage-manager';
import { AIChatMessage, ChatMessage, ChatMode } from '@/lib/types';
import { useIsSolanaWallet, useSolanaWallet } from '@/components/solana';

type AnyChatMessage = ChatMessage | AIChatMessage;
type AIMessageMetadata = {
  address?: string;
  continuations?: number;
  conversationId?: string;
  displayName?: string;
  finishReason?: string;
  model?: string;
  persistedMessageId?: string;
  provider?: string;
  recoveredFromLength?: boolean;
  timestamp?: number;
  tokensUsed?: number;
  toolCalls?: AIChatMessage['toolCalls'];
};
type AIUIMessage = UIMessage<AIMessageMetadata>;

interface ChatContextState {
  conversationId: string | null;
  error: string | null;
  getLoadingForMode: (mode: ChatMode) => boolean;
  getMessagesForMode: (mode: ChatMode) => AnyChatMessage[];
  isAITyping: boolean;
  isAITypingForMode: (mode: ChatMode) => boolean;
  isSending: boolean;
  isSendingForMode: (mode: ChatMode) => boolean;
  loading: boolean;
  markAsRead: () => void;
  messages: AnyChatMessage[];
  mode: ChatMode;
  publicChatAddress: string | null;
  publicChatAuthenticated: boolean;
  publicChatLoading: boolean;
  publicChatState: SecureSessionState;
  cancelActiveSend: () => void;
  retryPublicChatSession: () => void;
  fetchHistoryForMode: (mode: ChatMode, showLoading?: boolean) => Promise<void>;
  sendMessage: (message: string) => Promise<void>;
  sendMessageForMode: (mode: ChatMode, message: string) => Promise<void>;
  setChatOpen: (open: boolean) => void;
  setConversationId: (id: string | null) => void;
  setMode: (mode: ChatMode) => void;
  unreadCount: number;
}

const ChatContext = createContext<ChatContextState | undefined>(undefined);

function delay(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

const PUBLIC_CHAT_MIN_FETCH_INTERVAL_MS = 4500;

type PublicChatFetchGate = {
  inFlight: boolean;
  lastFetchStartedAt: number;
};

function getPublicChatFetchGate(): PublicChatFetchGate {
  if (typeof window === 'undefined') {
    return {
      inFlight: false,
      lastFetchStartedAt: 0,
    };
  }

  const globalWindow = window as typeof window & {
    __pixotchiPublicChatFetchGate?: PublicChatFetchGate;
  };

  globalWindow.__pixotchiPublicChatFetchGate ??= {
    inFlight: false,
    lastFetchStartedAt: 0,
  };

  return globalWindow.__pixotchiPublicChatFetchGate;
}

function getAIUIMessageText(message: AIUIMessage): string {
  return message.parts
    .filter((part): part is Extract<typeof part, { type: 'text' }> => part.type === 'text')
    .map((part) => part.text)
    .join('');
}

function storedAIMessageToUIMessage(message: AIChatMessage): AIUIMessage {
  return {
    id: message.id,
    metadata: {
      address: message.address,
      continuations: message.continuations,
      conversationId: message.conversationId,
      displayName: message.displayName,
      finishReason: message.finishReason,
      model: message.model,
      persistedMessageId: message.id,
      provider: message.provider,
      recoveredFromLength: message.recoveredFromLength,
      timestamp: message.timestamp,
      tokensUsed: message.tokensUsed,
      toolCalls: message.toolCalls,
    },
    parts: [
      {
        text: message.message,
        type: 'text',
      },
    ],
    role: message.type === 'user' ? 'user' : 'assistant',
  };
}

function uiMessageToAIChatMessage(
  message: AIUIMessage,
  fallbackAddress: string | null,
  fallbackConversationId: string | null,
): AIChatMessage | null {
  const text = getAIUIMessageText(message);
  if (!text.trim()) {
    return null;
  }

  const metadata = message.metadata || {};
  const type = message.role === 'assistant' ? 'assistant' : 'user';

  return {
    address: metadata.address || fallbackAddress || '0x0000000000000000000000000000000000000000',
    continuations: metadata.continuations,
    conversationId: metadata.conversationId || fallbackConversationId || '',
    displayName: metadata.displayName || (type === 'assistant' ? 'Neural Seed' : 'You'),
    finishReason: metadata.finishReason,
    id: metadata.persistedMessageId || message.id,
    message: text,
    model: metadata.model || '',
    provider: metadata.provider,
    recoveredFromLength: metadata.recoveredFromLength,
    timestamp: metadata.timestamp || Date.now(),
    tokensUsed: metadata.tokensUsed,
    toolCalls: metadata.toolCalls,
    type,
  };
}

export function ChatProvider({ children }: { children: ReactNode }) {
  const { address } = useAccount();
  const { authenticated, getAccessToken, ready: privyReady } = usePrivy();
  const { identityToken } = useIdentityToken();
  const fc = useFrameContext();
  const isMiniApp = Boolean(fc?.isInMiniApp);
  const confirmedMiniAppSession = useConfirmedMiniAppSession();
  const isSolana = useIsSolanaWallet();
  const { effectiveAddress, solanaAddress } = useSolanaWallet();
  const chatAddress = isSolana ? effectiveAddress : address;
  const [messages, setMessages] = useState<AnyChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [sendingMode, setSendingMode] = useState<ChatMode | null>(null);
  const [mode, setModeState] = useState<ChatMode>('public');
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [isAITyping, setIsAITyping] = useState(false);
  const [aiTypingModes, setAiTypingModes] = useState<Partial<Record<ChatMode, boolean>>>({});
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [loadingModes, setLoadingModes] = useState<Partial<Record<ChatMode, boolean>>>({});
  const [, setMessageCacheVersion] = useState(0);
  const [publicMessageVersion, setPublicMessageVersion] = useState(0);
  const [publicChatSession, setPublicChatSession] = useState<PublicChatSession | null>(null);
  const [publicChatLoading, setPublicChatLoading] = useState(false);
  const [publicChatState, setPublicChatState] = useState<SecureSessionState>('unneeded');
  const [publicChatSessionVersion, setPublicChatSessionVersion] = useState(0);
  const [publicChatRetryVersion, setPublicChatRetryVersion] = useState(0);

  const messageCacheRef = useRef<{ public: AnyChatMessage[]; ai: AnyChatMessage[] }>({
    ai: [],
    public: [],
  });
  const modeRef = useRef<ChatMode>('public');
  const abortControllerRef = useRef<AbortController | null>(null);
  const fetchInFlightRef = useRef<Partial<Record<ChatMode, boolean>>>({});
  const bootstrapKeyRef = useRef<string | null>(null);
  const previousChatAddressRef = useRef<string | null>(null);
  const previousPublicIdentityAddressRef = useRef<string | null>(null);
  const publicChatSessionRef = useRef<PublicChatSession | null>(null);
  const normalizedChatAddress = chatAddress?.toLowerCase() ?? null;
  const confirmedMiniAppAddress = isMiniApp && confirmedMiniAppSession.confirmed
    ? confirmedMiniAppSession.address?.toLowerCase() ?? null
    : null;
  const verifiedMiniAppSessionAddress =
    isMiniApp &&
    publicChatSession?.authenticated &&
    publicChatSession.provider === 'farcaster' &&
    publicChatSession.method === 'farcaster-miniapp'
      ? publicChatSession.address?.toLowerCase() ?? null
      : null;
  const matchingConfirmedMiniAppAddress =
    confirmedMiniAppAddress &&
    (!normalizedChatAddress || confirmedMiniAppAddress === normalizedChatAddress)
      ? confirmedMiniAppAddress
      : null;
  const matchingVerifiedMiniAppSessionAddress =
    verifiedMiniAppSessionAddress &&
    (!normalizedChatAddress || verifiedMiniAppSessionAddress === normalizedChatAddress)
      ? verifiedMiniAppSessionAddress
      : null;

  const publicChatAddress = isMiniApp
    ? (matchingConfirmedMiniAppAddress ?? matchingVerifiedMiniAppSessionAddress)
    : (publicChatSession?.address ?? null);
  const publicChatAuthenticated = isMiniApp
    ? Boolean(matchingConfirmedMiniAppAddress || matchingVerifiedMiniAppSessionAddress)
    : Boolean(publicChatSession?.authenticated && publicChatAddress);
  const publicIdentityAddress = publicChatAddress ?? null;
  const aiTransport = useMemo(
    () => new DefaultChatTransport<AIUIMessage>({
      api: '/api/chat/ai/send',
      credentials: 'same-origin',
      prepareSendMessagesRequest: ({ body, id, messageId, messages, trigger }) => {
        const latestUserMessage = [...messages].reverse().find((message) => message.role === 'user');
        return {
          body: {
            ...body,
            id,
            message: latestUserMessage ? getAIUIMessageText(latestUserMessage) : '',
            messageId,
            messages: latestUserMessage ? [latestUserMessage] : [],
            trigger,
          },
        };
      },
    }),
    [],
  );
  const aiChat = useAIChat<AIUIMessage>({
    experimental_throttle: 60,
    transport: aiTransport,
  });
  const aiChatStreaming = aiChat.status === 'submitted' || aiChat.status === 'streaming';
  const setAIChatMessages = aiChat.setMessages;
  const sendAIChatMessage = aiChat.sendMessage;
  const stopAIChat = aiChat.stop;

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  useEffect(() => {
    publicChatSessionRef.current = publicChatSession;
  }, [publicChatSession]);

  const getCurrentWebAuthSurface = useCallback(() => {
    if (isMiniApp || typeof window === 'undefined') {
      return null;
    }

    return resolvePreferredAuthSurface({
      search: window.location.search,
      storedSurface: sessionStorageManager.getAuthSurface(),
    });
  }, [isMiniApp]);

  useEffect(() => {
    if (publicChatAuthenticated) {
      setPublicChatState('ready');
      return;
    }

    if (publicChatLoading) {
      setPublicChatState('booting');
      return;
    }

    if (!chatAddress && !isMiniApp) {
      setPublicChatState('unneeded');
    }
  }, [chatAddress, isMiniApp, publicChatAuthenticated, publicChatLoading]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const handlePublicChatSession = (event: Event) => {
      const detail = (event as CustomEvent<{ session: PublicChatSession | null }>).detail;
      const nextSession = detail?.session ?? null;
      const currentSession = publicChatSessionRef.current;
      const sessionChanged =
        currentSession?.address?.toLowerCase() !== nextSession?.address?.toLowerCase() ||
        currentSession?.provider !== nextSession?.provider ||
        currentSession?.method !== nextSession?.method;

      if (!sessionChanged) {
        return;
      }

      publicChatSessionRef.current = nextSession;
      setPublicChatSession(nextSession);
      setPublicChatSessionVersion((version) => version + 1);
    };

    window.addEventListener(PUBLIC_CHAT_SESSION_EVENT, handlePublicChatSession as EventListener);
    return () => {
      window.removeEventListener(PUBLIC_CHAT_SESSION_EVENT, handlePublicChatSession as EventListener);
    };
  }, []);

  const handleChatAuthFailure = useCallback(async () => {
    const currentSurface = getCurrentWebAuthSurface();

    if ((currentSurface === 'base' || currentSurface === 'test') && chatAddress) {
      const recovery = await requestBaseChatSessionRefresh('chat-auth-failure');
      if (recovery.status === 'success') {
        setPublicChatState('booting');
        setPublicChatRetryVersion((version) => version + 1);
        return;
      }
    }

    setPublicChatSession(null);
    setPublicChatState(isMiniApp || chatAddress ? 'error' : 'unneeded');
    setConversationId(null);
    messageCacheRef.current.public = [];
    messageCacheRef.current.ai = [];
    setMessageCacheVersion((version) => version + 1);
    setPublicMessageVersion((version) => version + 1);

    if (modeRef.current === 'public' || modeRef.current === 'ai') {
      setMessages([]);
    }

    try {
      await clearPublicChatSession();
    } catch {
      // Ignore cleanup failures after an auth rejection.
    }
  }, [chatAddress, getCurrentWebAuthSurface, isMiniApp]);

  const retryPublicChatSession = useCallback(() => {
    setError(null);
    setPublicChatState('booting');

    const currentSurface = getCurrentWebAuthSurface();
    if ((currentSurface === 'base' || currentSurface === 'test') && chatAddress) {
      setPublicChatLoading(true);
      void (async () => {
        const recovery = await requestBaseChatSessionRefresh('chat-auth-failure');

        if (recovery.status === 'success') {
          setPublicChatRetryVersion((version) => version + 1);
          return;
        }

        setPublicChatSession(null);
        setPublicChatState('error');
        setPublicChatLoading(false);
        if (recovery.message) {
          setError(recovery.message);
        }
      })();
      return;
    }

    setPublicChatRetryVersion((version) => version + 1);
  }, [chatAddress, getCurrentWebAuthSurface]);

  useEffect(() => {
    if (mode !== 'public' && mode !== 'ai') {
      return;
    }

    if (publicChatLoading) {
      setLoading(true);
      return;
    }

    if (!publicChatAuthenticated) {
      setLoading(false);
    }
  }, [mode, publicChatAuthenticated, publicChatLoading]);

  useEffect(() => {
    if (publicChatAuthenticated) {
      return;
    }

    messageCacheRef.current.public = [];
    messageCacheRef.current.ai = [];
    setConversationId(null);
    setMessageCacheVersion((version) => version + 1);
    setPublicMessageVersion((version) => version + 1);

    if (modeRef.current === 'public' || modeRef.current === 'ai') {
      setMessages([]);
    }
  }, [publicChatAuthenticated]);

  useEffect(() => {
    const previousAddress = previousPublicIdentityAddressRef.current;
    if (previousAddress && previousAddress !== publicIdentityAddress) {
      messageCacheRef.current.ai = [];
      setConversationId(null);
      setMessageCacheVersion((version) => version + 1);

      if (modeRef.current === 'ai') {
        setMessages([]);
      }
    }

    previousPublicIdentityAddressRef.current = publicIdentityAddress;
  }, [publicIdentityAddress]);

  useEffect(() => {
    const previousAddress = previousChatAddressRef.current;
    if (!isMiniApp && previousAddress && !chatAddress) {
      void clearPublicChatSession().catch(() => {
        // Ignore cleanup failures during disconnect.
      });
    }

    previousChatAddressRef.current = chatAddress ?? null;
  }, [chatAddress, isMiniApp]);

  useEffect(() => {
    if (!isMiniApp) {
      clearConfirmedMiniAppSession('chat-host-downgrade');
    }
  }, [isMiniApp]);

  useEffect(() => {
    storeChatMode(mode);
    modeRef.current = mode;
  }, [mode]);

  const [unreadCount, setUnreadCount] = useState(0);
  const [lastReadTimestamp, setLastReadTimestamp] = useState<number>(loadChatLastRead);

  useEffect(() => {
    const publicMessages = mode === 'public' && isChatOpen
      ? messages
      : (messageCacheRef.current.public || []);

    if (publicMessages.length === 0) {
      setUnreadCount(0);
      return;
    }

    const count = publicMessages.filter((message) => {
      const isNew = message.timestamp > lastReadTimestamp;
      const isFromMe = publicIdentityAddress && message.address
        ? message.address.toLowerCase() === publicIdentityAddress.toLowerCase()
        : false;
      return isNew && !isFromMe;
    }).length;

    setUnreadCount(count);
  }, [isChatOpen, lastReadTimestamp, messages, mode, publicIdentityAddress, publicMessageVersion]);

  const markAsRead = useCallback(() => {
    const now = Date.now();
    setLastReadTimestamp(now);
    storeChatLastRead(now);
    setUnreadCount(0);
  }, []);

  const writeModeMessages = useCallback((targetMode: ChatMode, next: AnyChatMessage[]) => {
    messageCacheRef.current[targetMode] = next;
    setMessageCacheVersion((version) => version + 1);

    if (targetMode === 'public') {
      setPublicMessageVersion((version) => version + 1);
    }

    if (modeRef.current === targetMode) {
      setMessages(next);
    }
  }, []);

  const updatePublicMessages = useCallback((next: AnyChatMessage[]) => {
    writeModeMessages('public', next);
  }, [writeModeMessages]);

  useEffect(() => {
    const next = aiChat.messages
      .map((message) => uiMessageToAIChatMessage(message, publicIdentityAddress, conversationId))
      .filter((message): message is AIChatMessage => Boolean(message));

    messageCacheRef.current.ai = next;
    setMessageCacheVersion((version) => version + 1);

    const nextConversationId = next
      .map((message) => message.conversationId)
      .find((id) => Boolean(id));

    if (nextConversationId && nextConversationId !== conversationId) {
      setConversationId(nextConversationId);
    }

    if (modeRef.current === 'ai') {
      setMessages(next);
    }
  }, [aiChat.messages, conversationId, publicIdentityAddress]);

  useEffect(() => {
    if (!aiChat.error) {
      return;
    }

    const friendlyMessage = aiChat.error.message || 'AI chat failed to stream a response.';
    setError(friendlyMessage);
    toast.error(friendlyMessage);
  }, [aiChat.error]);

  useEffect(() => {
    setAiTypingModes((previous) => ({ ...previous, ai: aiChatStreaming }));

    if (modeRef.current === 'ai') {
      setIsAITyping(aiChatStreaming);
    }
  }, [aiChatStreaming]);

  const fetchHistory = useCallback(async (showLoading = false, requestedMode: ChatMode = modeRef.current) => {
    if (requestedMode === 'public') {
      const now = Date.now();
      const publicFetchGate = getPublicChatFetchGate();

      if (
        publicFetchGate.inFlight ||
        now - publicFetchGate.lastFetchStartedAt < PUBLIC_CHAT_MIN_FETCH_INTERVAL_MS
      ) {
        return;
      }

      publicFetchGate.inFlight = true;
      publicFetchGate.lastFetchStartedAt = now;
    } else if (fetchInFlightRef.current[requestedMode]) {
      return;
    }

    fetchInFlightRef.current[requestedMode] = true;

    if (showLoading) {
      setLoadingModes((previous) => ({ ...previous, [requestedMode]: true }));
      if (modeRef.current === requestedMode) {
        setLoading(true);
      }
    }
    setError(null);

    try {
      if (requestedMode === 'public') {
        if (!publicChatAuthenticated) {
          updatePublicMessages([]);
          return;
        }

        const authHeaders = await getMiniAppQuickAuthHeaders({
          expectedAddress: publicChatAddress ?? chatAddress,
        });
        const response = await fetch('/api/chat/messages?limit=50', {
          cache: 'no-store',
          headers: authHeaders,
        });
        if (response.status === 401) {
          await handleChatAuthFailure();
          return;
        }
        if (!response.ok) {
          throw new Error('Failed to fetch messages');
        }
        const data = await response.json();
        const next = data.messages || [];
        updatePublicMessages(next);
      } else if (requestedMode === 'ai') {
        if (!publicChatAuthenticated) {
          setConversationId(null);
          messageCacheRef.current.ai = [];
          setMessageCacheVersion((version) => version + 1);
          if (modeRef.current === 'ai') {
            setMessages([]);
          }
          return;
        }

        const params = new URLSearchParams({
          limit: '50',
        });

        if (conversationId) {
          params.append('conversationId', conversationId);
        }

        const authHeaders = await getMiniAppQuickAuthHeaders({
          expectedAddress: publicChatAddress ?? chatAddress,
        });
        const response = await fetch(`/api/chat/ai/messages?${params}`, {
          cache: 'no-store',
          headers: authHeaders,
        });
        if (response.status === 401) {
          await handleChatAuthFailure();
          return;
        }
        if (!response.ok) {
          throw new Error('Failed to fetch AI messages');
        }

        const data = await response.json();
        const next = data.messages || [];
        setAIChatMessages(next.map(storedAIMessageToUIMessage));
        writeModeMessages('ai', next);
        if (typeof data.conversationId === 'string' && data.conversationId !== conversationId) {
          setConversationId(data.conversationId);
        }
      } else {
        writeModeMessages(requestedMode, []);
      }
    } catch (err) {
      setError('Failed to fetch message history.');
      console.error(err);
    } finally {
      if (requestedMode === 'public') {
        getPublicChatFetchGate().inFlight = false;
      }
      fetchInFlightRef.current[requestedMode] = false;
      if (showLoading) {
        setLoadingModes((previous) => ({ ...previous, [requestedMode]: false }));
        if (modeRef.current === requestedMode) {
          setLoading(false);
        }
      }
    }
  }, [
    chatAddress,
    conversationId,
    handleChatAuthFailure,
    publicChatAddress,
    publicChatAuthenticated,
    setAIChatMessages,
    updatePublicMessages,
    writeModeMessages,
  ]);

  const setMode = useCallback((next: ChatMode) => {
    if (mode) {
      messageCacheRef.current[mode] = messages;
    }

    const targetCached = messageCacheRef.current[next] || [];

    setModeState(next);
    setMessages(targetCached);

    if (next === 'public') {
      if (isChatOpen && publicChatAuthenticated) {
        void fetchHistory(true, 'public');
      }
    } else if (next === 'ai') {
      void fetchHistory(true, 'ai');
    }
  }, [fetchHistory, isChatOpen, messages, mode, publicChatAuthenticated]);

  useEffect(() => {
    // loadChatMode validates the stored value and falls back to the current mode,
    // so an absent/blocked/garbage entry is a no-op.
    setMode(loadChatMode(modeRef.current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchPublicPreview = useCallback(async () => {
    await fetchHistory(false, 'public');
  }, [fetchHistory]);

  useEffect(() => {
    const currentSurface = getCurrentWebAuthSurface();
    const bootstrapKey = isMiniApp
      ? [
        'miniapp',
        chatAddress?.toLowerCase() ?? 'no-wallet',
        publicChatSessionVersion.toString(),
        publicChatRetryVersion.toString(),
      ].join(':')
      : [
        currentSurface ?? 'UntypedValue',
        chatAddress?.toLowerCase() ?? 'none',
        solanaAddress ?? 'none',
        authenticated ? '1' : '0',
        privyReady ? '1' : '0',
        identityToken ? '1' : '0',
        publicChatSessionVersion.toString(),
        publicChatRetryVersion.toString(),
      ].join(':');

    if (bootstrapKeyRef.current === bootstrapKey) {
      return;
    }

    if (isMiniApp) {
      bootstrapKeyRef.current = bootstrapKey;

      if (!chatAddress) {
        setPublicChatSession(null);
        setPublicChatState('booting');
        setPublicChatLoading(false);
        return;
      }

      let cancelled = false;

      const bootstrapMiniAppChat = async () => {
        setPublicChatState('booting');
        setPublicChatLoading(true);

        try {
          let nextSession = await getCurrentPublicChatSessionForAddress(chatAddress);

          const nextSessionMatchesWallet =
            nextSession?.address?.toLowerCase() === chatAddress.toLowerCase();

          if (
            nextSession &&
            (nextSession.provider !== 'farcaster' || !nextSessionMatchesWallet)
          ) {
            await clearPublicChatSession().catch((error) => {
              console.warn('[chat] Failed to clear stale Mini App chat session:', error);
            });
            nextSession = null;
          }

          if (!nextSession) {
            const { token } = await sdk.quickAuth.getToken();
            nextSession = await createFarcasterPublicChatSession({
              expectedAddress: chatAddress,
              token,
            });
          }

          if (!cancelled) {
            setPublicChatSession(nextSession);
            setPublicChatState('ready');
          }
        } catch (miniAppBootstrapError) {
          console.error('[chat] Failed to bootstrap Mini App public chat session:', miniAppBootstrapError);
          if (!cancelled) {
            setPublicChatSession(null);
            setPublicChatState('error');
          }
        } finally {
          if (!cancelled) {
            setPublicChatLoading(false);
          }
        }
      };

      void bootstrapMiniAppChat();

      return () => {
        cancelled = true;
      };
    }

    if (!chatAddress) {
      bootstrapKeyRef.current = null;
      setPublicChatSession(null);
      setPublicChatState('unneeded');
      setPublicChatLoading(false);
      return;
    }

    const shouldBootstrapPrivy =
      (currentSurface === 'privy' || currentSurface === 'privysolana') &&
      privyReady &&
      authenticated &&
      Boolean(chatAddress) &&
      (currentSurface !== 'privysolana' || Boolean(solanaAddress));

    const shouldCheckBase = currentSurface === 'base' || currentSurface === 'test';

    if (!shouldBootstrapPrivy && !shouldCheckBase) {
      bootstrapKeyRef.current = null;
      setPublicChatSession(null);
      setPublicChatState('unneeded');
      setPublicChatLoading(false);
      return;
    }

    bootstrapKeyRef.current = bootstrapKey;
    let cancelled = false;

    const bootstrapPublicChat = async () => {
      setPublicChatState('booting');
      setPublicChatLoading(true);

      try {
        if (shouldBootstrapPrivy) {
          const expectedPrivyMethod = currentSurface === 'privysolana' ? 'privy-solana' : 'privy-ethereum';
          const hasMatchingPrivySession =
            publicChatSession?.provider === 'privy' &&
            publicChatSession?.method === expectedPrivyMethod &&
            publicChatSession.address?.toLowerCase() === chatAddress.toLowerCase();

          if (hasMatchingPrivySession) {
            setPublicChatState('ready');
            return;
          }

          const accessToken = identityToken ? null : await getAccessToken();
          if (!identityToken && !accessToken) {
            throw new Error('Privy token unavailable.');
          }

          const nextSession = await createPrivyPublicChatSession({
            ...(identityToken ? { identityToken } : {}),
            ...(accessToken ? { accessToken } : {}),
            expectedAddress: chatAddress,
            ...(currentSurface === 'privysolana' ? { solanaAddress } : {}),
          });

          if (!cancelled) {
            setPublicChatSession(nextSession);
            setPublicChatState('ready');
          }
          return;
        }

        if (shouldCheckBase) {
          const hasMatchingBaseSession =
            publicChatSession?.provider === 'base' &&
            publicChatSession.address?.toLowerCase() === chatAddress.toLowerCase();

          if (hasMatchingBaseSession) {
            setPublicChatState('ready');
            return;
          }

          let nextSession: PublicChatSession | null = null;

          for (let attempt = 0; attempt < 3; attempt += 1) {
            nextSession = await getCurrentPublicChatSession();
            if (nextSession?.address?.toLowerCase() === chatAddress.toLowerCase()) {
              break;
            }

            if (attempt < 2) {
              await delay(250);
            }
          }

          if (!nextSession) {
            const pendingBaseAuth = sessionStorageManager.getPendingBaseChatAuth();

            if (pendingBaseAuth?.address?.toLowerCase() === chatAddress.toLowerCase()) {
              try {
                nextSession = await createBasePublicChatSession({
                  address: pendingBaseAuth.address,
                  message: pendingBaseAuth.message,
                  signature: pendingBaseAuth.signature,
                });
                await sessionStorageManager.clearPendingBaseChatAuth();
              } catch (error) {
                const errorMessage = error instanceof Error ? error.message.toLowerCase() : '';
                if (
                  errorMessage.includes('nonce') ||
                  errorMessage.includes('signature') ||
                  errorMessage.includes('unexpected') ||
                  errorMessage.includes('required')
                ) {
                  await sessionStorageManager.clearPendingBaseChatAuth();
                }
                console.warn('[chat] Failed to bootstrap Base public chat session:', error);
              }
            }
          }

          if (nextSession && nextSession.address.toLowerCase() !== chatAddress.toLowerCase()) {
            await clearPublicChatSession();
            nextSession = null;
          }

          if (!cancelled) {
            setPublicChatSession(nextSession);
            setPublicChatState(nextSession ? 'ready' : 'error');
          }

          if (nextSession?.address?.toLowerCase() === chatAddress.toLowerCase()) {
            await sessionStorageManager.clearPendingBaseChatAuth().catch(() => {
              // Ignore cleanup failures once session is established.
            });
          }
        }
      } catch (bootstrapError) {
        console.error('[chat] Failed to bootstrap public chat session:', bootstrapError);
        if (!cancelled) {
          setPublicChatSession(null);
          setPublicChatState('error');
        }
      } finally {
        if (!cancelled) {
          setPublicChatLoading(false);
        }
      }
    };

    void bootstrapPublicChat();

    return () => {
      cancelled = true;
    };
  }, [
    authenticated,
    chatAddress,
    getAccessToken,
    getCurrentWebAuthSurface,
    identityToken,
    isMiniApp,
    publicChatSession,
    publicChatSessionVersion,
    publicChatRetryVersion,
    privyReady,
    solanaAddress,
  ]);

  useEffect(() => {
    if (!isChatOpen || !publicChatAuthenticated) {
      return () => {
        if (abortControllerRef.current) {
          abortControllerRef.current.abort();
        }
      };
    }

    void fetchHistory(mode === 'public', 'public');
    const refreshPublicChat = () => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        void fetchHistory(false, 'public');
      }
    };

    const interval = setInterval(refreshPublicChat, 5000);
    const handleVisibilityChange = () => refreshPublicChat();
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }

    return () => {
      clearInterval(interval);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [fetchHistory, isChatOpen, mode, publicChatAuthenticated]);

  useEffect(() => {
    if (mode === 'ai' && publicChatAuthenticated) {
      void fetchHistory(true, 'ai');
      return () => {
        if (abortControllerRef.current) {
          abortControllerRef.current.abort();
        }
      };
    }

  }, [fetchHistory, isChatOpen, mode, publicChatAuthenticated]);

  useEffect(() => {
    if (!publicChatAuthenticated || isChatOpen) {
      return;
    }

    const refreshPreview = () => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        void fetchPublicPreview();
      }
    };

    refreshPreview();
    const interval = setInterval(refreshPreview, 15000);

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', refreshPreview);
    }

    return () => {
      clearInterval(interval);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', refreshPreview);
      }
    };
  }, [fetchPublicPreview, isChatOpen, publicChatAuthenticated]);

  const sendMessageForMode = async (targetMode: ChatMode, messageText: string) => {
    if (!messageText.trim()) {
      return;
    }

    if (targetMode === 'ai' && !publicIdentityAddress) {
      return;
    }

    if ((targetMode === 'public' || targetMode === 'ai') && !publicChatAuthenticated) {
      toast.error(
        targetMode === 'ai' ? 'AI chat is not ready yet.' : 'Public chat is not ready yet.',
      );
      return;
    }

    if (targetMode === 'public' && !publicChatAddress) {
      toast.error('Public chat is not ready yet.');
      return;
    }

    if (targetMode === 'ai') {
      setIsSending(true);
      setSendingMode(targetMode);
      setError(null);
      setIsAITyping(true);
      setAiTypingModes((previous) => ({ ...previous, [targetMode]: true }));

      try {
        const authHeaders = await getMiniAppQuickAuthHeaders({
          expectedAddress: publicChatAddress ?? chatAddress,
        });
        await sendAIChatMessage(
          { text: messageText },
          {
            body: {
              conversationId,
            },
            headers: authHeaders,
          },
        );
      } catch (err: UntypedValue) {
        if (/401|unauthorized/i.test(String(err?.message || ''))) {
          await handleChatAuthFailure();
        }

        const friendlyMessage = err?.message || 'AI chat failed to stream a response.';
        setError(friendlyMessage);
        toast.error(friendlyMessage);
      } finally {
        setIsSending(false);
        setSendingMode(null);
        setIsAITyping(false);
        setAiTypingModes((previous) => ({ ...previous, [targetMode]: false }));
      }
      return;
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;
    const signal = controller.signal;

    setIsSending(true);
    setSendingMode(targetMode);
    setError(null);

    const endpoint = '/api/chat/send';
    const senderAddress = publicChatAddress;
    const optimisticId = `optimistic-${Date.now()}`;
    const optimisticUserMessage: AnyChatMessage = {
      address: senderAddress!,
      displayName: 'You',
      id: optimisticId,
      message: messageText,
      timestamp: Date.now(),
    };

    const previousMessages = targetMode === modeRef.current
      ? messages
      : (messageCacheRef.current[targetMode] || []);
    const nextOptimisticMessages = [...previousMessages, optimisticUserMessage];
    writeModeMessages(targetMode, nextOptimisticMessages);

    try {
      const authHeaders = await getMiniAppQuickAuthHeaders({
        expectedAddress: publicChatAddress ?? chatAddress,
      });
      const response = await fetch(endpoint, {
          body: JSON.stringify({ message: messageText }),
          headers: {
            'Content-Type': 'application/json',
            ...authHeaders,
          },
          method: 'POST',
          signal,
        });

        if (response.status === 401) {
          await handleChatAuthFailure();
          throw new Error('Public chat is unavailable for this session.');
        }

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Failed to send message');
        }

        const data = await response.json();

        const newMessage = data.message;
        const next = [
          ...(messageCacheRef.current.public || []).filter((message) => message.id !== optimisticId),
          newMessage,
        ];
        writeModeMessages('public', next);
    } catch (err: UntypedValue) {
      const next = (messageCacheRef.current[targetMode] || []).filter((message) => message.id !== optimisticId);
      if (err.name === 'AbortError') {
        writeModeMessages(targetMode, next);
      } else {
        const friendlyMessage = err.message || 'An unexpected error occurred.';
        setError(friendlyMessage);
        toast.error(friendlyMessage);
        writeModeMessages(targetMode, next);
      }
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
      setIsSending(false);
      setSendingMode(null);
    }
  };

  const cancelActiveSend = useCallback(() => {
    if (sendingMode === 'ai' || aiChatStreaming) {
      void stopAIChat();
      setIsSending(false);
      setSendingMode(null);
      setIsAITyping(false);
      setAiTypingModes((previous) => ({ ...previous, ai: false }));
      return;
    }

    const controller = abortControllerRef.current;
    if (!controller) {
      return;
    }

    controller.abort();
    abortControllerRef.current = null;
    setIsSending(false);
    setSendingMode(null);
    setIsAITyping(false);
    setAiTypingModes((previous) => ({ ...previous, ai: false }));
  }, [aiChatStreaming, sendingMode, stopAIChat]);

  const sendMessage = async (messageText: string) => {
    await sendMessageForMode(modeRef.current, messageText);
  };

  const getMessagesForMode = useCallback((targetMode: ChatMode) => {
    if (targetMode === mode) {
      return messages;
    }

    return messageCacheRef.current[targetMode] || [];
  }, [messages, mode]);

  const getLoadingForMode = useCallback((targetMode: ChatMode) => {
    if (targetMode === mode) {
      return loading;
    }

    return Boolean(loadingModes[targetMode]);
  }, [loading, loadingModes, mode]);

  const isSendingForMode = useCallback((targetMode: ChatMode) => {
    if (targetMode === 'ai') {
      return sendingMode === targetMode || aiChatStreaming;
    }

    return sendingMode === targetMode;
  }, [aiChatStreaming, sendingMode]);

  const isAITypingForMode = useCallback((targetMode: ChatMode) => {
    return Boolean(aiTypingModes[targetMode]);
  }, [aiTypingModes]);

  const fetchHistoryForMode = useCallback(async (targetMode: ChatMode, showLoading = false) => {
    await fetchHistory(showLoading, targetMode);
  }, [fetchHistory]);

  const value = {
    conversationId,
    error,
    fetchHistoryForMode,
    getLoadingForMode,
    getMessagesForMode,
    isAITyping,
    isAITypingForMode,
    isSending: isSending || aiChatStreaming,
    isSendingForMode,
    loading,
    markAsRead,
    messages,
    mode,
    publicChatAddress,
    publicChatAuthenticated,
    publicChatLoading,
    publicChatState,
    cancelActiveSend,
    retryPublicChatSession,
    sendMessage,
    sendMessageForMode,
    setChatOpen: setIsChatOpen,
    setConversationId,
    setMode,
    unreadCount,
  };

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat() {
  const context = useContext(ChatContext);
  if (context === undefined) {
    throw new Error('useChat must be used within a ChatProvider');
  }
  return context;
}
