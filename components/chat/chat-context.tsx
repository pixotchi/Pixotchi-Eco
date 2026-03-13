"use client";

import React, {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { quickAuth } from '@farcaster/miniapp-sdk';
import { usePrivy, useToken } from '@privy-io/react-auth';
import toast from 'react-hot-toast';
import { useAccount } from 'wagmi';
import { useFrameContext } from '@/lib/frame-context';
import {
  clearPublicChatSession,
  createBasePublicChatSession,
  createFarcasterPublicChatSession,
  createPrivyPublicChatSession,
  getCurrentPublicChatSession,
  type PublicChatSession,
} from '@/lib/chat-auth-client';
import { PIXOTCHI_TOKEN_ADDRESS } from '@/lib/contracts';
import { PLANT_STRAINS } from '@/lib/constants';
import { sessionStorageManager } from '@/lib/session-storage-manager';
import { AIChatMessage, ChatMessage, ChatMode } from '@/lib/types';
import { useIsSolanaWallet, useSolanaWallet } from '@/components/solana';

type AnyChatMessage = ChatMessage | AIChatMessage;

interface ChatContextState {
  conversationId: string | null;
  error: string | null;
  isAITyping: boolean;
  isSending: boolean;
  loading: boolean;
  markAsRead: () => void;
  messages: AnyChatMessage[];
  mode: ChatMode;
  publicChatAddress: string | null;
  publicChatAuthenticated: boolean;
  publicChatLoading: boolean;
  sendMessage: (message: string) => Promise<void>;
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

export function ChatProvider({ children }: { children: ReactNode }) {
  const { address } = useAccount();
  const { authenticated, ready: privyReady } = usePrivy();
  const { getAccessToken } = useToken();
  const fc = useFrameContext();
  const isMiniApp = Boolean(fc?.isInMiniApp);
  const isSolana = useIsSolanaWallet();
  const { effectiveAddress, solanaAddress } = useSolanaWallet();
  const chatAddress = isSolana ? effectiveAddress : address;
  const [messages, setMessages] = useState<AnyChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [mode, setModeState] = useState<ChatMode>('public');
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [isAITyping, setIsAITyping] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [publicMessageVersion, setPublicMessageVersion] = useState(0);
  const [publicChatSession, setPublicChatSession] = useState<PublicChatSession | null>(null);
  const [publicChatLoading, setPublicChatLoading] = useState(false);

  const messageCacheRef = useRef<{ public: AnyChatMessage[]; ai: AnyChatMessage[]; agent: AnyChatMessage[] }>({
    agent: [],
    ai: [],
    public: [],
  });
  const modeRef = useRef<ChatMode>('public');
  const abortControllerRef = useRef<AbortController | null>(null);
  const bootstrapKeyRef = useRef<string | null>(null);
  const previousChatAddressRef = useRef<string | null>(null);
  const previousPublicIdentityAddressRef = useRef<string | null>(null);

  const publicChatAddress = publicChatSession?.address ?? null;
  const publicChatAuthenticated = Boolean(publicChatSession?.authenticated && publicChatAddress);
  const publicIdentityAddress = publicChatAddress ?? null;

  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const handleChatAuthFailure = useCallback(async () => {
    setPublicChatSession(null);
    setConversationId(null);
    messageCacheRef.current.public = [];
    messageCacheRef.current.ai = [];
    setPublicMessageVersion((version) => version + 1);

    if (modeRef.current === 'public' || modeRef.current === 'ai') {
      setMessages([]);
    }

    try {
      await clearPublicChatSession();
    } catch {
      // Ignore cleanup failures after an auth rejection.
    }
  }, []);

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

      if (modeRef.current === 'ai') {
        setMessages([]);
      }
    }

    previousPublicIdentityAddressRef.current = publicIdentityAddress;
  }, [publicIdentityAddress]);

  useEffect(() => {
    const previousAddress = previousChatAddressRef.current;
    if (previousAddress && !chatAddress) {
      void clearPublicChatSession().catch(() => {
        // Ignore cleanup failures during disconnect.
      });
    }

    previousChatAddressRef.current = chatAddress ?? null;
  }, [chatAddress]);

  const setMode = (next: ChatMode) => {
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
    } else if (next === 'agent') {
      setMessages(messageCacheRef.current.agent || []);
    }
  };

  useEffect(() => {
    const savedMode = localStorage.getItem('chat-mode') as ChatMode;
    if (savedMode && ['public', 'ai', 'agent'].includes(savedMode)) {
      setMode(savedMode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    localStorage.setItem('chat-mode', mode);
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    try {
      if (mode === 'agent') {
        localStorage.setItem('agent-chat-history', JSON.stringify(messages));
        messageCacheRef.current.agent = messages;
      }
    } catch {
      // Ignore localStorage failures.
    }
  }, [mode, messages]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('agent-chat-history');
      if (saved) {
        const parsed: AnyChatMessage[] = JSON.parse(saved);
        messageCacheRef.current.agent = parsed;
        if (mode === 'agent') {
          setMessages(parsed);
        }
      }
    } catch {
      // Ignore localStorage failures.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [unreadCount, setUnreadCount] = useState(0);
  const [lastReadTimestamp, setLastReadTimestamp] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('chat-last-read');
      return saved ? parseInt(saved, 10) : Date.now();
    }
    return Date.now();
  });

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
    localStorage.setItem('chat-last-read', now.toString());
    setUnreadCount(0);
  }, []);

  const updatePublicMessages = useCallback((next: AnyChatMessage[]) => {
    messageCacheRef.current.public = next;
    setPublicMessageVersion((version) => version + 1);

    if (modeRef.current === 'public' && isChatOpen) {
      setMessages(next);
    }
  }, [isChatOpen]);

  const fetchHistory = useCallback(async (showLoading = false, requestedMode: ChatMode = modeRef.current) => {
    if (showLoading) {
      setLoading(true);
    }
    setError(null);

    try {
      if (requestedMode === 'public') {
        if (!publicChatAuthenticated) {
          updatePublicMessages([]);
          return;
        }

        const response = await fetch('/api/chat/messages?limit=50', {
          cache: 'no-store',
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
          setMessages([]);
          return;
        }

        const params = new URLSearchParams({
          limit: '50',
        });

        if (conversationId) {
          params.append('conversationId', conversationId);
        }

        const response = await fetch(`/api/chat/ai/messages?${params}`, {
          cache: 'no-store',
        });
        if (response.status === 401) {
          await handleChatAuthFailure();
          return;
        }
        if (!response.ok) {
          throw new Error('Failed to fetch AI messages');
        }

        const data = await response.json();
        if (modeRef.current !== requestedMode) {
          return;
        }
        const next = data.messages || [];
        setMessages(next);
        messageCacheRef.current.ai = next;
        if (typeof data.conversationId === 'string' && data.conversationId !== conversationId) {
          setConversationId(data.conversationId);
        }
      } else if (requestedMode === 'agent' && chatAddress) {
        setMessages(messageCacheRef.current.agent || []);
      } else {
        setMessages([]);
      }
    } catch (err) {
      setError('Failed to fetch message history.');
      console.error(err);
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  }, [chatAddress, conversationId, handleChatAuthFailure, publicChatAuthenticated, updatePublicMessages]);

  const fetchPublicPreview = useCallback(async () => {
    if (!publicChatAuthenticated) {
      return;
    }

    try {
      const response = await fetch('/api/chat/messages?limit=50', {
        cache: 'no-store',
      });
      if (response.status === 401) {
        await handleChatAuthFailure();
        return;
      }
      if (!response.ok) {
        throw new Error('Failed to fetch public preview');
      }

      const data = await response.json();
      const next = data.messages || [];
      updatePublicMessages(next);
    } catch (err) {
      console.error(err);
    }
  }, [handleChatAuthFailure, publicChatAuthenticated, updatePublicMessages]);

  useEffect(() => {
    const currentSurface = !isMiniApp
      ? sessionStorageManager.getAuthSurface()
      : null;
    const bootstrapKey = [
      isMiniApp ? 'miniapp' : currentSurface ?? 'unknown',
      chatAddress?.toLowerCase() ?? 'none',
      solanaAddress ?? 'none',
      authenticated ? '1' : '0',
      privyReady ? '1' : '0',
    ].join(':');

    if (bootstrapKeyRef.current === bootstrapKey) {
      return;
    }

    if (!chatAddress) {
      bootstrapKeyRef.current = null;
      setPublicChatSession(null);
      setPublicChatLoading(false);
      return;
    }

    const shouldBootstrapPrivy =
      !isMiniApp &&
      (currentSurface === 'privy' || currentSurface === 'privysolana') &&
      privyReady &&
      authenticated &&
      Boolean(chatAddress) &&
      (currentSurface !== 'privysolana' || Boolean(solanaAddress));

    const shouldCheckBase = !isMiniApp && currentSurface === 'base';
    const shouldBootstrapMiniApp = isMiniApp;

    if (!shouldBootstrapPrivy && !shouldCheckBase && !shouldBootstrapMiniApp) {
      bootstrapKeyRef.current = null;
      setPublicChatSession(null);
      setPublicChatLoading(false);
      return;
    }

    bootstrapKeyRef.current = bootstrapKey;
    let cancelled = false;

    const bootstrapPublicChat = async () => {
      setPublicChatLoading(true);

      try {
        if (shouldBootstrapMiniApp) {
          const { token } = await quickAuth.getToken();
          if (!token) {
            throw new Error('Farcaster Quick Auth token unavailable.');
          }

          const nextSession = await createFarcasterPublicChatSession({
            expectedAddress: chatAddress,
            token,
          });

          if (!cancelled) {
            setPublicChatSession(nextSession);
          }
          return;
        }

        if (shouldBootstrapPrivy) {
          const accessToken = await getAccessToken();
          if (!accessToken) {
            throw new Error('Privy access token unavailable.');
          }

          const nextSession = await createPrivyPublicChatSession({
            accessToken,
            expectedAddress: chatAddress,
            ...(currentSurface === 'privysolana' ? { solanaAddress } : {}),
          });

          if (!cancelled) {
            setPublicChatSession(nextSession);
          }
          return;
        }

        if (shouldCheckBase) {
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
    isMiniApp,
    privyReady,
    solanaAddress,
  ]);

  useEffect(() => {
    if (mode === 'public') {
      if (!isChatOpen || !publicChatAuthenticated) {
        return () => {
          if (abortControllerRef.current) {
            abortControllerRef.current.abort();
          }
        };
      }

      void fetchHistory(true, 'public');
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
    }

    if (mode === 'ai' && publicChatAuthenticated) {
      void fetchHistory(true, 'ai');
      return () => {
        if (abortControllerRef.current) {
          abortControllerRef.current.abort();
        }
      };
    }

    if (mode === 'agent') {
      setMessages(messageCacheRef.current.agent || []);
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

  const sendMessage = async (messageText: string) => {
    if (!messageText.trim()) {
      return;
    }

    if (mode !== 'public' && !chatAddress) {
      return;
    }

    if ((mode === 'public' || mode === 'ai' || mode === 'agent') && !publicChatAuthenticated) {
      toast.error(
        mode === 'agent'
          ? 'Agent chat is not ready yet.'
          : (mode === 'ai' ? 'AI chat is not ready yet.' : 'Public chat is not ready yet.'),
      );
      return;
    }

    if (mode === 'public' && !publicChatAddress) {
      toast.error('Public chat is not ready yet.');
      return;
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    setIsSending(true);
    setError(null);

    const endpoint = mode === 'ai' ? '/api/chat/ai/send' : '/api/chat/send';
    const senderAddress = mode === 'public'
      ? publicChatAddress
      : ((mode === 'ai' || mode === 'agent') ? publicIdentityAddress : chatAddress);
    const optimisticId = `optimistic-${Date.now()}`;
    const optimisticUserMessage: AnyChatMessage = mode === 'ai'
      ? {
        address: senderAddress!,
        conversationId: conversationId || '',
        displayName: 'You',
        id: optimisticId,
        message: messageText,
        model: '',
        timestamp: Date.now(),
        type: 'user',
      }
      : {
        address: senderAddress!,
        displayName: 'You',
        id: optimisticId,
        message: messageText,
        timestamp: Date.now(),
      };

    setMessages((previous) => {
      const next = [...previous, optimisticUserMessage];
      if (mode === 'public') {
        messageCacheRef.current.public = next;
        setPublicMessageVersion((version) => version + 1);
      }
      if (mode === 'agent') {
        messageCacheRef.current.agent = next;
        try {
          localStorage.setItem('agent-chat-history', JSON.stringify(next));
        } catch {
          // Ignore localStorage failures.
        }
      }
      return next;
    });

    if (mode === 'ai' || mode === 'agent') {
      setIsAITyping(true);
    }

    try {
      if (mode === 'agent') {
        const agentMessages = messageCacheRef.current.agent || [];
        const conversationHistory = agentMessages.slice(-6).map((message) => ({
          content: message.message,
          role: (message as any).displayName === 'Agent' ? 'assistant' : 'user',
        }));

        let preparedSpendCalls: Array<{ data: `0x${string}`; to: `0x${string}`; value: string }> | undefined;
        try {
          const wallet = await fetch('/api/agent/wallet', { signal }).then((response) => response.json()).catch(() => null);
          const spender = wallet?.smartAccountAddress as `0x${string}` | undefined;
          if (spender && address) {
            const [{ createBaseAccountSDK }, spendModule, viem] = await Promise.all([
              import('@base-org/account' as any),
              import('@base-org/account/spend-permission' as any),
              import('viem'),
            ]);
            const sdk = createBaseAccountSDK({ appName: 'Pixotchi Agent' } as any);
            const provider = sdk.getProvider();
            try {
              await provider.request({ method: 'eth_requestAccounts' });
            } catch {
              // Ignore manual connect failures here.
            }
            try {
              await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x2105' }] });
            } catch {
              // Ignore chain switch failures here.
            }
            const permissions = await spendModule.fetchPermissions({
              account: address as `0x${string}`,
              chainId: 8453,
              provider,
              spender,
            }).catch(() => []);
            const seedToken = PIXOTCHI_TOKEN_ADDRESS;
            const seedPermission = (permissions || []).find(
              (permission: any) => `${permission.permission?.token}`.toLowerCase() === seedToken.toLowerCase(),
            );

            if (seedPermission) {
              const extractCount = (text: string): number | null => {
                const match = text.match(/\b(\d{1,2})\b/);
                if (!match) {
                  return null;
                }
                const parsed = parseInt(match[1], 10);
                if (Number.isNaN(parsed)) {
                  return null;
                }
                return Math.max(1, Math.min(5, parsed));
              };

              let inferredCount = extractCount(messageText);
              if (inferredCount == null) {
                for (let index = agentMessages.length - 1; index >= 0; index -= 1) {
                  const previousMessage = agentMessages[index] as any;
                  const isUserMessage = previousMessage?.displayName !== 'Agent';
                  if (!isUserMessage) {
                    continue;
                  }
                  const count = extractCount(previousMessage?.message || '');
                  if (count != null) {
                    inferredCount = count;
                    break;
                  }
                }
              }
              if (inferredCount == null) {
                inferredCount = 1;
              }

              const strains = PLANT_STRAINS;
              let chosenStrain: typeof strains[number] = strains.find((strain) => strain.id === 4) || strains[0];
              const idMatch = /strain\s*(\d{1,2})/i.exec(messageText);
              if (idMatch) {
                const strainId = parseInt(idMatch[1], 10);
                const found = strains.find((strain) => strain.id === strainId);
                if (found) {
                  chosenStrain = found as typeof strains[number];
                }
              } else if (Array.isArray(strains)) {
                const lower = messageText.toLowerCase();
                const byName = strains.find((strain) => lower.includes(String(strain.name || '').toLowerCase()));
                if (byName) {
                  chosenStrain = byName as typeof strains[number];
                }
              }

              const unitCost = chosenStrain?.mintPriceSeed || (strains.find((strain) => strain.id === 4)?.mintPriceSeed || 10);
              const total = unitCost * inferredCount;
              const requiredWei = viem.parseUnits(total.toFixed(6), 18);
              const spendCalls = await spendModule.prepareSpendCallData(seedPermission, requiredWei).catch(() => []);
              if (Array.isArray(spendCalls) && spendCalls.length > 0) {
                preparedSpendCalls = spendCalls.map((call: any) => ({
                  data: (call.data || '0x') as `0x${string}`,
                  to: call.to as `0x${string}`,
                  value: String(call.value ?? 0),
                }));
              }
            }
          }
        } catch {
          // Spend-call preparation is best-effort only.
        }

        const response = await fetch('/api/agent/chat', {
          body: JSON.stringify({
            conversationHistory,
            preparedSpendCalls,
            prompt: messageText,
          }),
          headers: { 'Content-Type': 'application/json' },
          method: 'POST',
          signal,
        });
        if (response.status === 401) {
          await handleChatAuthFailure();
          throw new Error('Agent chat is unavailable for this session.');
        }
        if (!response.ok) {
          const err = await response.json().catch(() => ({}));
          throw new Error(err.error || 'Failed to send agent prompt');
        }
        const data = await response.json();
        const replyText = typeof data?.text === 'string' ? data.text : (data?.success ? 'Done.' : '');
        const agentReply: AnyChatMessage = {
          address,
          displayName: 'Agent',
          id: `agent-${Date.now()}`,
          message: replyText,
          timestamp: Date.now(),
        } as any;
        setMessages((previous) => {
          const next = [...previous, agentReply];
          messageCacheRef.current.agent = next;
          try {
            localStorage.setItem('agent-chat-history', JSON.stringify(next));
          } catch {
            // Ignore localStorage failures.
          }
          return next;
        });
      } else {
        const response = await fetch(endpoint, {
          body: JSON.stringify(
            mode === 'ai'
              ? { message: messageText }
              : { message: messageText },
          ),
          headers: { 'Content-Type': 'application/json' },
          method: 'POST',
          signal,
        });

        if (response.status === 401) {
          await handleChatAuthFailure();
          throw new Error(mode === 'ai' ? 'AI chat is unavailable for this session.' : 'Public chat is unavailable for this session.');
        }

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Failed to send message');
        }

        const data = await response.json();

        if (mode === 'ai') {
          const { aiResponse, userMessage } = data;
          if (!conversationId && userMessage.conversationId) {
            setConversationId(userMessage.conversationId);
          }
          setMessages((previous) => [...previous.filter((message) => message.id !== optimisticId), userMessage, aiResponse]);
        } else {
          const newMessage = data.message;
          setMessages((previous) => {
            const next = [...previous.filter((message) => message.id !== optimisticId), newMessage];
            messageCacheRef.current.public = next;
            setPublicMessageVersion((version) => version + 1);
            return next;
          });
        }
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        setMessages((previous) => previous.filter((message) => message.id !== optimisticId));
      } else {
        const friendlyMessage = err.message || 'An unexpected error occurred.';
        setError(friendlyMessage);
        toast.error(friendlyMessage);
        setMessages((previous) => previous.filter((message) => message.id !== optimisticId));
      }
    } finally {
      setIsSending(false);
      if (mode === 'ai' || mode === 'agent') {
        setIsAITyping(false);
      }
    }
  };

  const value = {
    conversationId,
    error,
    isAITyping,
    isSending,
    loading,
    markAsRead,
    messages,
    mode,
    publicChatAddress,
    publicChatAuthenticated,
    publicChatLoading,
    sendMessage,
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
