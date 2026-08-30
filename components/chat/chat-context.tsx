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
import dynamic from 'next/dynamic';
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
import {
  storedAIMessageToUIMessage,
  uiMessageToAIChatMessage,
  type AiChatHandle,
  type AiChatStatus,
  type AIUIMessage,
} from './ai-message-utils';

// The AI SDK loads only when chat is first opened; see ai-chat-engine.tsx.
const AiChatEngine = dynamic(() => import('./ai-chat-engine'), { ssr: false });

type AnyChatMessage = ChatMessage | AIChatMessage;

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
  /** Resolve to true only when the message was actually accepted — callers keep the draft otherwise. */
  sendMessage: (message: string) => Promise<boolean>;
  sendMessageForMode: (mode: ChatMode, message: string) => Promise<boolean>;
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
const BASE_AUTH_BOOTSTRAP_WAIT_MS = 5000;
const BASE_AUTH_BOOTSTRAP_POLL_MS = 125;
const PUBLIC_CHAT_AUTO_RETRY_DELAYS_MS = [1250, 2500, 5000] as const;

function normalizeBaseAuthSurface(surface: string | null) {
  return surface === 'coinbase' ? 'base' : surface;
}

function isBaseAuthBootstrapPending(
  surface: 'base' | 'test',
  address: string,
): boolean {
  const autologin = normalizeBaseAuthSurface(sessionStorageManager.getAutologin());
  if (autologin === surface) {
    return true;
  }

  const pendingAuth = sessionStorageManager.getPendingBaseChatAuth();
  return pendingAuth?.address?.toLowerCase() === address.toLowerCase();
}

async function waitForBaseAuthBootstrap(
  surface: 'base' | 'test',
  address: string,
  shouldContinue: () => boolean,
) {
  const deadline = Date.now() + BASE_AUTH_BOOTSTRAP_WAIT_MS;
  while (
    shouldContinue() &&
    Date.now() < deadline &&
    isBaseAuthBootstrapPending(surface, address)
  ) {
    await delay(BASE_AUTH_BOOTSTRAP_POLL_MS);
  }
}

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
  const bootstrapRunRef = useRef(0);
  const publicChatAutoRetryRef = useRef<{ attempt: number; key: string | null }>({
    attempt: 0,
    key: null,
  });
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
  /*
   * AI engine wiring. The useChat instance lives in <AiChatEngine> (dynamically
   * imported on first chat open); this provider keeps a stable imperative
   * handle plus mirrored status, so the rest of the file reads almost as before.
   */
  const [hasOpenedChat, setHasOpenedChat] = useState(false);
  const aiHandleRef = useRef<AiChatHandle | null>(null);
  const pendingAiHistoryRef = useRef<AIUIMessage[] | null>(null);
  const [aiStatus, setAiStatus] = useState<AiChatStatus>('ready');
  const aiChatStreaming = aiStatus === 'submitted' || aiStatus === 'streaming';

  const handleAiEngineReady = useCallback((handle: AiChatHandle) => {
    aiHandleRef.current = handle;
    if (pendingAiHistoryRef.current) {
      handle.setMessages(pendingAiHistoryRef.current);
      pendingAiHistoryRef.current = null;
    }
  }, []);

  const setAIChatMessages = useCallback((next: AIUIMessage[]) => {
    if (aiHandleRef.current) {
      aiHandleRef.current.setMessages(next);
    } else {
      // Engine not mounted yet (chat never opened): stage the history so the
      // engine hydrates with it on mount.
      pendingAiHistoryRef.current = next;
    }
  }, []);

  const stopAIChat = useCallback(() => {
    return aiHandleRef.current?.stop();
  }, []);

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

      // Invalidate any older async bootstrap before publishing the newer,
      // authoritative session event into React state.
      bootstrapRunRef.current += 1;
      publicChatSessionRef.current = nextSession;
      setPublicChatSession(nextSession);
      if (nextSession) {
        setError(null);
      }
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
    publicChatAutoRetryRef.current = { attempt: 0, key: null };
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
    // Bail when nothing changed: the poll used to replace the array wholesale
    // every cycle, re-rendering this root provider (and the header ChatButton)
    // even when the feed was identical.
    const current = messageCacheRef.current.public;
    if (
      current.length === next.length &&
      current.every((message, index) =>
        message.id === next[index]?.id && message.timestamp === next[index]?.timestamp)
    ) {
      return;
    }
    writeModeMessages('public', next);
  }, [writeModeMessages]);

  const publicIdentityAddressRef = useRef(publicIdentityAddress);
  useEffect(() => {
    publicIdentityAddressRef.current = publicIdentityAddress;
  }, [publicIdentityAddress]);
  const conversationIdRef = useRef(conversationId);
  useEffect(() => {
    conversationIdRef.current = conversationId;
  }, [conversationId]);

  const handleAiMessagesChange = useCallback((uiMessages: AIUIMessage[]) => {
    const next = uiMessages
      .map((message) => uiMessageToAIChatMessage(message, publicIdentityAddressRef.current, conversationIdRef.current))
      .filter((message): message is AIChatMessage => Boolean(message));

    messageCacheRef.current.ai = next;
    setMessageCacheVersion((version) => version + 1);

    const nextConversationId = next
      .map((message) => message.conversationId)
      .find((id) => Boolean(id));

    if (nextConversationId && nextConversationId !== conversationIdRef.current) {
      setConversationId(nextConversationId);
    }

    if (modeRef.current === 'ai') {
      setMessages(next);
    }
  }, []);

  const handleAiError = useCallback((aiError: Error) => {
    const friendlyMessage = aiError.message || 'AI chat failed to stream a response.';
    setError(friendlyMessage);
    toast.error(friendlyMessage);
  }, []);

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
        const next: AnyChatMessage[] = data.messages || [];
        // Preserve any optimistic bubbles the server hasn't echoed yet — a poll
        // landing mid-send used to wipe the user's in-flight message and make it
        // reappear seconds later.
        const serverIds = new Set(next.map((message) => message.id));
        const pendingOptimistic = (messageCacheRef.current.public || []).filter(
          (message) => String(message.id).startsWith('optimistic-') && !serverIds.has(message.id),
        );
        updatePublicMessages(pendingOptimistic.length ? [...next, ...pendingOptimistic] : next);
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

    const bootstrapRunId = bootstrapRunRef.current + 1;
    bootstrapRunRef.current = bootstrapRunId;
    let cancelled = false;
    const isCurrentBootstrap = () =>
      !cancelled && bootstrapRunRef.current === bootstrapRunId;

    if (isMiniApp) {
      bootstrapKeyRef.current = bootstrapKey;

      if (!chatAddress) {
        setPublicChatSession(null);
        setPublicChatState('booting');
        setPublicChatLoading(false);
        return;
      }

      const bootstrapMiniAppChat = async () => {
        setPublicChatState('booting');
        setPublicChatLoading(true);

        try {
          let nextSession = await getCurrentPublicChatSessionForAddress(chatAddress);
          if (!isCurrentBootstrap()) {
            return;
          }

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
            if (!isCurrentBootstrap()) {
              return;
            }
            nextSession = await createFarcasterPublicChatSession({
              expectedAddress: chatAddress,
              token,
            });
          }

          if (isCurrentBootstrap()) {
            publicChatSessionRef.current = nextSession;
            setPublicChatSession(nextSession);
            setPublicChatState('ready');
          }
        } catch (miniAppBootstrapError) {
          console.error('[chat] Failed to bootstrap Mini App public chat session:', miniAppBootstrapError);
          if (isCurrentBootstrap()) {
            publicChatSessionRef.current = null;
            setPublicChatSession(null);
            setPublicChatState('error');
          }
        } finally {
          if (isCurrentBootstrap()) {
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
            if (isCurrentBootstrap()) {
              setPublicChatState('ready');
            }
            return;
          }

          const accessToken = identityToken ? null : await getAccessToken();
          if (!identityToken && !accessToken) {
            throw new Error('Privy token unavailable.');
          }
          if (!isCurrentBootstrap()) {
            return;
          }

          const nextSession = await createPrivyPublicChatSession({
            ...(identityToken ? { identityToken } : {}),
            ...(accessToken ? { accessToken } : {}),
            expectedAddress: chatAddress,
            ...(currentSurface === 'privysolana' ? { solanaAddress } : {}),
          });

          if (isCurrentBootstrap()) {
            publicChatSessionRef.current = nextSession;
            setPublicChatSession(nextSession);
            setPublicChatState('ready');
          }
          return;
        }

        if (shouldCheckBase) {
          const baseSurface: 'base' | 'test' = currentSurface === 'test' ? 'test' : 'base';
          const hasMatchingBaseSession =
            publicChatSession?.provider === 'base' &&
            publicChatSession.address?.toLowerCase() === chatAddress.toLowerCase();

          if (hasMatchingBaseSession) {
            if (isCurrentBootstrap()) {
              setPublicChatState('ready');
            }
            return;
          }

          // Surface switching stores an autologin marker before reloading.
          // Wagmi can reconnect before the SIWE POST completes, so wait for
          // that handshake instead of issuing a predictably unauthenticated
          // GET. The bounded wait still lets genuine auth failures surface.
          await waitForBaseAuthBootstrap(
            baseSurface,
            chatAddress,
            isCurrentBootstrap,
          );
          if (!isCurrentBootstrap()) {
            return;
          }

          let nextSession = await getCurrentPublicChatSessionForAddress(chatAddress);
          if (!isCurrentBootstrap()) {
            return;
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

          if (isCurrentBootstrap()) {
            const eventSession = publicChatSessionRef.current;
            const matchingEventSession =
              eventSession?.provider === 'base' &&
              eventSession.address.toLowerCase() === chatAddress.toLowerCase()
                ? eventSession
                : null;
            const resolvedSession = nextSession ?? matchingEventSession;

            publicChatSessionRef.current = resolvedSession;
            setPublicChatSession(resolvedSession);
            setPublicChatState(resolvedSession ? 'ready' : 'error');
          }

          if (nextSession?.address?.toLowerCase() === chatAddress.toLowerCase()) {
            await sessionStorageManager.clearPendingBaseChatAuth().catch(() => {
              // Ignore cleanup failures once session is established.
            });
          }
        }
      } catch (bootstrapError) {
        console.error('[chat] Failed to bootstrap public chat session:', bootstrapError);
        if (isCurrentBootstrap()) {
          const currentSession = publicChatSessionRef.current;
          const currentSessionMatches =
            currentSession?.address?.toLowerCase() === chatAddress.toLowerCase();
          if (currentSessionMatches) {
            setPublicChatState('ready');
            return;
          }

          publicChatSessionRef.current = null;
          setPublicChatSession(null);
          setPublicChatState('error');
        }
      } finally {
        if (isCurrentBootstrap()) {
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
    const currentSurface = getCurrentWebAuthSurface();
    if (publicChatAuthenticated) {
      publicChatAutoRetryRef.current = { attempt: 0, key: null };
      return;
    }

    if (
      isMiniApp ||
      !chatAddress ||
      (currentSurface !== 'base' && currentSurface !== 'test') ||
      publicChatLoading ||
      publicChatState !== 'error'
    ) {
      return;
    }

    const retryKey = `${currentSurface}:${chatAddress.toLowerCase()}`;
    if (publicChatAutoRetryRef.current.key !== retryKey) {
      publicChatAutoRetryRef.current = { attempt: 0, key: retryKey };
    }

    const attempt = publicChatAutoRetryRef.current.attempt;
    if (attempt >= PUBLIC_CHAT_AUTO_RETRY_DELAYS_MS.length) {
      return;
    }
    publicChatAutoRetryRef.current.attempt += 1;

    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      void (async () => {
        if (cancelled) {
          return;
        }

        const isFinalAttempt = attempt === PUBLIC_CHAT_AUTO_RETRY_DELAYS_MS.length - 1;
        const authenticatedAddress = sessionStorageManager
          .getBaseAuthenticatedAddress()
          ?.toLowerCase();

        if (isFinalAttempt && authenticatedAddress === chatAddress.toLowerCase()) {
          setPublicChatState('booting');
          setPublicChatLoading(true);
          const recovery = await requestBaseChatSessionRefresh('chat-auth-failure', 15_000);
          if (cancelled) {
            return;
          }

          setPublicChatLoading(false);
          if (recovery.status === 'success') {
            setError(null);
            setPublicChatRetryVersion((version) => version + 1);
            return;
          }

          setError(recovery.message ?? 'Could not restore the secure chat session.');
          setPublicChatState('error');
          return;
        }

        setPublicChatState('booting');
        setPublicChatRetryVersion((version) => version + 1);
      })();
    }, PUBLIC_CHAT_AUTO_RETRY_DELAYS_MS[attempt]);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [
    chatAddress,
    getCurrentWebAuthSurface,
    isMiniApp,
    publicChatAuthenticated,
    publicChatLoading,
    publicChatState,
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
    // 60s, down from 15s: this poll runs for every logged-in user with the chat
    // CLOSED, purely to feed the unread badge — 240 requests/hour/user was the
    // single largest source of idle traffic in the app.
    const interval = setInterval(refreshPreview, 60000);

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

  const sendMessageForMode = async (targetMode: ChatMode, messageText: string): Promise<boolean> => {
    if (!messageText.trim()) {
      return false;
    }

    if (targetMode === 'ai' && !publicIdentityAddress) {
      return false;
    }

    if ((targetMode === 'public' || targetMode === 'ai') && !publicChatAuthenticated) {
      toast.error(
        targetMode === 'ai' ? 'AI chat is not ready yet.' : 'Public chat is not ready yet.',
      );
      return false;
    }

    if (targetMode === 'public' && !publicChatAddress) {
      toast.error('Public chat is not ready yet.');
      return false;
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
        const aiHandle = aiHandleRef.current;
        if (!aiHandle) {
          throw new Error('Neural Seed is still loading. Try again in a moment.');
        }
        await aiHandle.sendMessage(
          { text: messageText },
          {
            body: {
              conversationId,
            },
            headers: authHeaders,
          },
        );
        return true;
      } catch (err: UntypedValue) {
        if (/401|unauthorized/i.test(String(err?.message || ''))) {
          await handleChatAuthFailure();
        }

        const friendlyMessage = err?.message || 'AI chat failed to stream a response.';
        setError(friendlyMessage);
        toast.error(friendlyMessage);
        return false;
      } finally {
        setIsSending(false);
        setSendingMode(null);
        setIsAITyping(false);
        setAiTypingModes((previous) => ({ ...previous, [targetMode]: false }));
      }
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
    // randomUUID, not Date.now(): two sends in the same millisecond used to
    // collide on the React key and both bubbles were dropped by reconciliation.
    const optimisticId = `optimistic-${crypto.randomUUID()}`;
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
        return true;
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
      return false;
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

  const sendMessage = async (messageText: string): Promise<boolean> => {
    return sendMessageForMode(modeRef.current, messageText);
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

  const setChatOpen = useCallback((open: boolean) => {
    setIsChatOpen(open);
    if (open) {
      // First open mounts the (dynamically imported) AI engine.
      setHasOpenedChat(true);
    }
  }, []);

  const sendMessageRef = useRef(sendMessage);
  sendMessageRef.current = sendMessage;
  const sendMessageForModeRef = useRef(sendMessageForMode);
  sendMessageForModeRef.current = sendMessageForMode;
  const stableSendMessage = useCallback(
    (messageText: string) => sendMessageRef.current(messageText),
    [],
  );
  const stableSendMessageForMode = useCallback(
    (targetMode: ChatMode, messageText: string) => sendMessageForModeRef.current(targetMode, messageText),
    [],
  );
  const fetchHistoryForModeRef = useRef(fetchHistoryForMode);
  fetchHistoryForModeRef.current = fetchHistoryForMode;
  const stableFetchHistoryForMode = useCallback(
    (targetMode: ChatMode, showLoading?: boolean) => fetchHistoryForModeRef.current(targetMode, showLoading),
    [],
  );

  // Memoized: this used to be a fresh 27-field object literal on every render
  // of a root-level provider, so every consumer (including the header
  // ChatButton) re-rendered whenever anything in here moved.
  const value = useMemo(
    () => ({
      conversationId,
      error,
      fetchHistoryForMode: stableFetchHistoryForMode,
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
      sendMessage: stableSendMessage,
      sendMessageForMode: stableSendMessageForMode,
      setChatOpen,
      setConversationId,
      setMode,
      unreadCount,
    }),
    [
      aiChatStreaming,
      cancelActiveSend,
      conversationId,
      error,
      getLoadingForMode,
      getMessagesForMode,
      isAITyping,
      isAITypingForMode,
      isSending,
      isSendingForMode,
      loading,
      markAsRead,
      messages,
      mode,
      publicChatAddress,
      publicChatAuthenticated,
      publicChatLoading,
      publicChatState,
      retryPublicChatSession,
      setChatOpen,
      setConversationId,
      setMode,
      stableFetchHistoryForMode,
      stableSendMessage,
      stableSendMessageForMode,
      unreadCount,
    ],
  );

  return (
    <ChatContext.Provider value={value}>
      {hasOpenedChat ? (
        <AiChatEngine
          onError={handleAiError}
          onMessagesChange={handleAiMessagesChange}
          onReady={handleAiEngineReady}
          onStatusChange={setAiStatus}
        />
      ) : null}
      {children}
    </ChatContext.Provider>
  );
}

export function useChat() {
  const context = useContext(ChatContext);
  if (context === undefined) {
    throw new Error('useChat must be used within a ChatProvider');
  }
  return context;
}
