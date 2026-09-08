'use client';

import { createContext, useContext } from 'react';
import type { AIChatMessage, ChatMessage, ChatMode } from '@/lib/types';
import type { SecureSessionState } from '@/lib/auth-surface';

export type ChatControls = {
  mode: ChatMode; setMode: (mode: ChatMode) => void; setChatOpen: (open: boolean) => void;
  markAsRead: (timestamp: number) => void;
  fetchHistoryForMode: (mode: ChatMode, showLoading?: boolean) => Promise<void>;
  sendMessageForMode: (mode: ChatMode, text: string) => Promise<boolean>;
  cancelActiveSend: (mode?: ChatMode) => void;
  retryPublicChatSession: () => void;
};
export type ChatPaneState = {
  messages: (ChatMessage | AIChatMessage)[]; loading: boolean; historyError: string | null;
  isSending: boolean; isAITyping: boolean;
};
export type ChatSessionState = {
  publicChatAddress: string | null; publicChatAuthenticated: boolean;
  publicChatLoading: boolean; publicChatState: SecureSessionState;
};

export const ChatControlsContext = createContext<ChatControls | null>(null);
export const ChatSessionContext = createContext<ChatSessionState | null>(null);
export const PublicChatPaneContext = createContext<ChatPaneState | null>(null);
export const AIChatPaneContext = createContext<ChatPaneState | null>(null);
export const PublicChatComposerContext = createContext<Pick<ChatPaneState, 'isSending' | 'isAITyping'> | null>(null);
export const AIChatComposerContext = createContext<Pick<ChatPaneState, 'isSending' | 'isAITyping'> | null>(null);
export const ChatHeaderContext = createContext<Pick<ChatControls, 'setMode' | 'setChatOpen'> & { unreadCount: number } | null>(null);

export function useChatControls() {
  const value = useContext(ChatControlsContext);
  if (!value) throw new Error('Chat controls require ChatProvider');
  return value;
}
export function useChatPane(modeOverride?: ChatMode) {
  const controls = useChatControls();
  const activeMode = modeOverride ?? controls.mode;
  const pane = useContext(activeMode === 'ai' ? AIChatPaneContext : PublicChatPaneContext);
  const session = useContext(ChatSessionContext);
  if (!pane || !session) throw new Error('Chat pane requires ChatProvider');
  return { ...controls, ...session, ...pane, activeMode };
}
export function useChatHeader() {
  const value = useContext(ChatHeaderContext);
  if (!value) throw new Error('Chat header requires ChatProvider');
  return value;
}
/** Composer controls do not subscribe to streamed message arrays or history reads. */
export function useChatComposer(modeOverride?: ChatMode) {
  const controls = useChatControls();
  const activeMode = modeOverride ?? controls.mode;
  const composer = useContext(activeMode === 'ai' ? AIChatComposerContext : PublicChatComposerContext);
  const session = useContext(ChatSessionContext);
  if (!composer || !session) throw new Error('Chat composer requires ChatProvider');
  return { ...controls, ...session, ...composer, activeMode };
}
