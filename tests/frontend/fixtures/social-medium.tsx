import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import ActivityTab from '@/components/tabs/activity-tab';
import FeedbackDialog from '@/components/feedback-dialog';
import { ChatProvider, useChat } from '@/components/chat/chat-context';
import ChatMessages from '@/components/chat/chat-messages';
import { SecretGardenOverlay } from '@/components/secret-garden-overlay';
import { BroadcastMessageModal } from '@/components/broadcast-message-modal';
import { VerifyClaimContent } from '@/components/verify-claim';
import { AirdropClaimCard } from '@/components/airdrop-claim-card';
import { A, B, failFixtureRecovery, setFixtureOwner, setFixtureVisible, useFixtureRecoveryCount, useFixtureSignatures } from './social-medium-io';
import type { BroadcastMessage } from '@/lib/broadcast-service';

function FeedbackFixture() {
  const [open, setOpen] = useState(false);
  return <><button onClick={() => setOpen(true)}>Open feedback dialog</button><FeedbackDialog open={open} onOpenChange={setOpen} /></>;
}
function ChatFixture() {
  const chat = useChat();
  const recoveryCount = useFixtureRecoveryCount();
  const [pane, setPane] = useState<'public' | 'ai' | null>(null);
  return <section>
    <button onClick={() => { setPane('public'); chat.setChatOpen(true); chat.setMode('public'); }}>Open public pane</button>
    <button onClick={() => { setPane('ai'); chat.setChatOpen(true); chat.setMode('ai'); }}>Open AI pane</button>
    <button onClick={() => { setPane(null); chat.setChatOpen(false); }}>Close chat</button>
    <button onClick={() => void chat.fetchHistoryForMode('public', true)}>Refresh public</button>
    <button onClick={() => void chat.fetchHistoryForMode('ai', true)}>Refresh AI</button>
    <button onClick={() => void chat.sendMessageForMode('ai', 'A private question')}>Ask AI</button>
    <button onClick={chat.retryPublicChatSession}>Retry chat session</button>
    <button onClick={failFixtureRecovery}>Fail recovery</button>
    <output aria-label="Chat recoveries">{recoveryCount}</output>
    <output aria-label="Chat state">{chat.publicChatState}</output>
    <output aria-label="Chat restoring">{String(chat.publicChatLoading)}</output>
    <output aria-label="Chat ready">{String(chat.publicChatAuthenticated)}</output>
    <output aria-label="Unread">{chat.unreadCount}</output>
    <output aria-label="AI messages">{chat.getMessagesForMode('ai').map(message => message.message).join('|')}</output>
    <output aria-label="Public messages">{chat.getMessagesForMode('public').map(message => message.message).join('|')}</output>
    {pane && <div style={{ height: 320 }} data-testid="chat-pane"><ChatMessages modeOverride={pane} /></div>}
  </section>;
}
function OverlayFixture() {
  const [garden, setGarden] = useState(false);
  const [message, setMessage] = useState<BroadcastMessage | null>(null);
  const announcement = (id: string): BroadcastMessage => ({ id, title: `Announcement ${id}`, content: 'A fixture announcement', createdAt: Date.now(), createdBy: 'fixture', priority: 'normal', type: 'info', dismissible: false, action: { label: 'Read announcement', url: 'https://example.com/announcement' }, stats: { impressions: 0, dismissals: 0 } });
  return <section><button onClick={() => setGarden(true)}>Open Secret Garden</button><button onClick={() => setMessage(announcement('first'))}>Open broadcast</button>
    <button onClick={() => setMessage(announcement('second'))}>Replace broadcast</button>
    <SecretGardenOverlay open={garden} onClose={() => setGarden(false)} />
    <BroadcastMessageModal message={message} onDismiss={() => setMessage(null)} />
  </section>;
}
function Fixture() {
  const signatures = useFixtureSignatures();
  const scenario = new URLSearchParams(location.search).get('scenario');
  return <main className="p-4" data-fixtures-ready="true">
    <output aria-label="Fixture signatures">{signatures}</output>
    <button onClick={() => setFixtureOwner(A)}>Wallet A</button><button onClick={() => setFixtureOwner(B)}>Wallet B</button><button onClick={() => setFixtureOwner(undefined)}>Disconnect fixture</button>
    {scenario === 'chat' ? <ChatProvider><ChatFixture /></ChatProvider> : scenario === 'feedback' ? <FeedbackFixture /> : scenario === 'claim' ? <VerifyClaimContent address={A} signMessageAsync={async () => '0x1234'} onClaimSuccess={() => {}} /> : scenario === 'airdrop' ? <AirdropClaimCard /> : scenario === 'overlay' ? <OverlayFixture /> : <><button onClick={() => setFixtureVisible(false)}>Hide Activity</button><button onClick={() => setFixtureVisible(true)}>Show Activity</button><div style={{ height: 650 }}><ActivityTab /></div></>}
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
