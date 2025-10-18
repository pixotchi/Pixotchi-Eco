"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AIChatMessage, ChatMessage, ChatMode } from '@/lib/types';
import { getRecentMessages } from '@/lib/chat-service';
import { getAIConversationMessages } from '@/lib/ai-service';
import { useAccount } from 'wagmi';

// Combined message type for simplicity in the context
type AnyChatMessage = ChatMessage | AIChatMessage;

interface ChatContextState {
  messages: AnyChatMessage[];
  loading: boolean;
  error: string | null;
  mode: ChatMode;
  setMode: (mode: ChatMode) => void;
  sendMessage: (message: string) => Promise<void>;
  isSending: boolean;
  conversationId: string | null;
  setConversationId: (id: string | null) => void;
  isAITyping: boolean;
}

const ChatContext = createContext<ChatContextState | undefined>(undefined);

export function ChatProvider({ children }: { children: ReactNode }) {
  const { address } = useAccount();
  const [messages, setMessages] = useState<AnyChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [mode, setModeState] = useState<ChatMode>('public');
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [isAITyping, setIsAITyping] = useState(false);

  // Cache messages per mode so switching tabs doesn't bleed content across modes
  const messageCacheRef = useRef<{ public: AnyChatMessage[]; ai: AnyChatMessage[]; agent: AnyChatMessage[] }>({ public: [], ai: [], agent: [] });
  const modeRef = useRef<ChatMode>("public");
  
  // AbortController for cancelling pending fetch requests
  const abortControllerRef = useRef<AbortController | null>(null);

  // Cleanup: abort pending requests on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  const setMode = (next: ChatMode) => {
    // Save current mode messages before switching
    if (mode) {
      messageCacheRef.current[mode] = messages;
    }
    
    // Get target mode messages
    const targetCached = messageCacheRef.current[next] || [];
    
    // Set new mode and messages
    setModeState(next);
    setMessages(targetCached);
    // Proactively reload messages for dedicated tab experience
    if (next === 'public') {
      fetchHistory(true, 'public');
    } else if (next === 'ai') {
      fetchHistory(true, 'ai');
    } else if (next === 'agent') {
      setMessages(messageCacheRef.current.agent || []);
    }
  };

  // Persist mode selection in localStorage like the original
  useEffect(() => {
    const savedMode = localStorage.getItem('chat-mode') as ChatMode;
    if (savedMode && ['public', 'ai', 'agent'].includes(savedMode)) {
      setMode(savedMode);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('chat-mode', mode);
    modeRef.current = mode;
  }, [mode]);

  // Persist agent-mode messages to localStorage
  useEffect(() => {
    try {
      // Avoid dependency on the ref object identity; serialize on messages change when in agent mode
      if (mode === 'agent') {
        localStorage.setItem('agent-chat-history', JSON.stringify(messages));
        messageCacheRef.current.agent = messages;
      }
    } catch {}
  }, [mode, messages]);

  // Restore agent-mode messages on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem('agent-chat-history');
      if (saved) {
        const parsed: AnyChatMessage[] = JSON.parse(saved);
        messageCacheRef.current.agent = parsed;
        if (mode === 'agent') setMessages(parsed);
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Note: Message loading is now handled directly in setMode() to prevent race conditions

  const fetchHistory = useCallback(async (showLoading = false, requestedMode: ChatMode = modeRef.current) => {
    if (showLoading) setLoading(true);
    setError(null);
    
    try {
      if (requestedMode === 'public') {
        // Fetch public messages using the API endpoint like the original
        const response = await fetch('/api/chat/messages?limit=50');
        if (!response.ok) {
          throw new Error('Failed to fetch messages');
        }
        const data = await response.json();
        if (modeRef.current !== requestedMode) return; // ignore stale result after tab switch
        const next = data.messages || [];
        setMessages(next);
        messageCacheRef.current.public = next;
      } else if (requestedMode === 'ai' && address) {
        // Fetch AI messages using the API endpoint like the original
        const params = new URLSearchParams({
          address,
          limit: '50'
        });
        
        if (conversationId) {
          params.append('conversationId', conversationId);
        }
        
        const response = await fetch(`/api/chat/ai/messages?${params}`);
        if (!response.ok) {
          throw new Error('Failed to fetch AI messages');
        }
        
        const data = await response.json();
        if (modeRef.current !== requestedMode) return; // ignore stale result after tab switch
        const next = data.messages || [];
        setMessages(next);
        messageCacheRef.current.ai = next;
        if (data.conversationId && !conversationId) {
          setConversationId(data.conversationId);
        }
      } else if (requestedMode === 'agent' && address) {
        const agentCache = messageCacheRef.current['agent'] || [];
        setMessages(agentCache);
      } else {
        setMessages([]);
      }
    } catch (err) {
      setError('Failed to fetch message history.');
      console.error(err);
    } finally {
      if (showLoading) setLoading(false);
    }
  }, [mode, conversationId, address]);

  // Original behavior: set up polling regardless of dialog visibility
  useEffect(() => {
    if (mode === 'public') {
      fetchHistory(true, 'public');
      const interval = setInterval(() => { fetchHistory(false, 'public'); }, 10000);
      return () => clearInterval(interval);
    } else if (mode === 'ai' && address) {
      fetchHistory(true, 'ai');
    } else if (mode === 'agent') {
      // For agent mode, explicitly ensure we have empty messages if cache is empty
      const agentCache = messageCacheRef.current['agent'] || [];
      setMessages(agentCache);
    }
  }, [mode, address, fetchHistory]);

  const sendMessage = async (messageText: string) => {
    if (!address || !messageText.trim()) return;

    // Cancel any previous request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    
    // Create new AbortController for this request
    abortControllerRef.current = new AbortController();
    const signal = abortControllerRef.current.signal;

    setIsSending(true);
    setError(null);

    const endpoint = mode === 'ai' ? '/api/chat/ai/send' : '/api/chat/send';
    
    const optimisticId = `optimistic-${Date.now()}`;
    const optimisticUserMessage: AnyChatMessage = mode === 'ai'
    ? { id: optimisticId, address, message: messageText, timestamp: Date.now(), type: 'user', model: '', displayName: 'You', conversationId: conversationId || '' }
    : { id: optimisticId, address, message: messageText, timestamp: Date.now(), displayName: 'You' };
    
    setMessages(prev => {
      const next = [...prev, optimisticUserMessage];
      if (mode === 'agent') {
        messageCacheRef.current.agent = next;
        try { localStorage.setItem('agent-chat-history', JSON.stringify(next)); } catch {}
      }
      return next;
    });
    if(mode === 'ai' || mode === 'agent') setIsAITyping(true);

    try {
        if (mode === 'agent') {
          // Get recent conversation history for context
          const agentMessages = messageCacheRef.current['agent'] || [];
          const conversationHistory = agentMessages.slice(-6).map(msg => ({
            role: (msg as any).displayName === 'Agent' ? 'assistant' : 'user',
            content: msg.message
          }));

          // Best-effort: prepare Base Account spend calls on the client
          let preparedSpendCalls: Array<{ to: `0x${string}`; value: string; data: `0x${string}` }> | undefined;
          try {
            const wallet = await fetch('/api/agent/wallet', { signal }).then(r => r.json()).catch(() => null);
            const spender = wallet?.smartAccountAddress as `0x${string}` | undefined;
            if (spender && address) {
              const [{ createBaseAccountSDK }, spendMod, viem] = await Promise.all([
                import('@base-org/account' as any),
                import('@base-org/account/spend-permission' as any),
                import('viem')
              ]);
              const sdk = createBaseAccountSDK({ appName: 'Pixotchi Agent' } as any);
              const provider = sdk.getProvider();
              try { await provider.request({ method: 'eth_requestAccounts' }); } catch {}
              try { await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x2105' }] }); } catch {}
              const perms = await spendMod.fetchPermissions({ account: address as `0x${string}`, chainId: 8453, spender, provider }).catch(() => []);
              const SEED = '0x546D239032b24eCEEE0cb05c92FC39090846adc7' as `0x${string}`;
              const seedPerm = (perms || []).find((p: any) => `${p.permission?.token}`.toLowerCase() === SEED.toLowerCase());
              if (seedPerm) {
                // Robustly infer mint count from current or recent user messages; clamp to 1..5 per agent policy
                const extractCount = (txt: string): number | null => {
                  const m = txt.match(/\b(\d{1,2})\b/);
                  if (!m) return null;
                  const n = parseInt(m[1], 10);
                  if (isNaN(n)) return null;
                  return Math.max(1, Math.min(5, n));
                };
                let inferredCount = extractCount(messageText);
                if (inferredCount == null) {
                  for (let i = agentMessages.length - 1; i >= 0; i--) {
                    const m = agentMessages[i] as any;
                    const isUser = m?.displayName !== 'Agent';
                    if (!isUser) continue;
                    const n = extractCount(m?.message || '');
                    if (n != null) { inferredCount = n; break; }
                  }
                }
                if (inferredCount == null) inferredCount = 1;

                // Use the same hardcoded strains as the server (SEED units)
                const STRAINS = [
                  { id: 1, name: 'Flora', mintPriceSeed: 10 },
                  { id: 2, name: 'Taki', mintPriceSeed: 20 },
                  { id: 3, name: 'ROSA', mintPriceSeed: 40 },
                  { id: 4, name: 'ZEST', mintPriceSeed: 10 },
                  { id: 5, name: 'TYJ', mintPriceSeed: 500 },
                ];
                // Default to ZEST in agent mode unless user explicitly specifies another strain
                let chosen = STRAINS.find(s => s.id === 4) || STRAINS[0];
                const idMatch = /strain\s*(\d{1,2})/i.exec(messageText);
                if (idMatch) {
                  const sid = parseInt(idMatch[1], 10);
                  const found = STRAINS.find(s => s.id === sid);
                  if (found) chosen = found;
                } else if (Array.isArray(STRAINS)) {
                  const lower = messageText.toLowerCase();
                  const byName = STRAINS.find(s => lower.includes(String(s.name || '').toLowerCase()));
                  if (byName) chosen = byName;
                }
                const unit = chosen?.mintPriceSeed || (STRAINS.find(s => s.id === 4)?.mintPriceSeed || 10); // SEED units
                const total = unit * inferredCount;
                const requiredWei = viem.parseUnits(total.toFixed(6), 18);
                const spendCalls = await spendMod.prepareSpendCallData(seedPerm, requiredWei).catch(() => []);
                if (Array.isArray(spendCalls) && spendCalls.length > 0) {
                  preparedSpendCalls = spendCalls.map((c: any) => ({ to: c.to as `0x${string}`, value: String(c.value ?? 0), data: (c.data || '0x') as `0x${string}` }));
                }
              }
            }
          } catch {}

          const response = await fetch('/api/agent/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              prompt: messageText,
              userAddress: address, // Pass user address for spend permission validation
              conversationHistory, // Pass conversation context
              preparedSpendCalls
            }),
            signal
          });
          if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.error || 'Failed to send agent prompt');
          }
          const data = await response.json();
          const replyText = typeof data?.text === 'string' ? data.text : (data?.success ? 'Done.' : '');
          const agentReply: AnyChatMessage = { id: `agent-${Date.now()}`, address, message: replyText, timestamp: Date.now(), displayName: 'Agent' } as any;
          setMessages(prev => {
            const next = [...prev, agentReply];
            messageCacheRef.current.agent = next;
            try { localStorage.setItem('agent-chat-history', JSON.stringify(next)); } catch {}
            return next;
          });
        } else {
          const response = await fetch(endpoint, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ message: messageText, address, conversationId }),
              signal
          });
  
          if (!response.ok) {
              const errorData = await response.json();
              throw new Error(errorData.error || 'Failed to send message');
          }
  
          const data = await response.json();
          
          if (mode === 'ai') {
              const { userMessage, aiResponse } = data;
              if (!conversationId) {
                  setConversationId(userMessage.conversationId);
              }
              // Replace optimistic user message and add AI response
              setMessages(prev => [...prev.filter(m => m.id !== optimisticId), userMessage, aiResponse]);
          } else {
              // For public chat, add the returned message
              const newMessage = data.message;
              setMessages(prev => [...prev.filter(m => m.id !== optimisticId), newMessage]);
          }
        }

    } catch (err: any) {
        // Don't show error if request was intentionally aborted
        if (err.name === 'AbortError') {
          console.log('Request was cancelled');
          setMessages(prev => prev.filter(m => m.id !== optimisticId));
        } else {
          setError(err.message || 'An unexpected error occurred.');
          setMessages(prev => prev.filter(m => m.id !== optimisticId));
        }
    } finally {
        setIsSending(false);
        if(mode === 'ai' || mode === 'agent') setIsAITyping(false);
    }
  };

  const value = {
    messages,
    loading,
    error,
    mode,
    setMode,
    sendMessage,
    isSending,
    conversationId,
    setConversationId,
    isAITyping
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
