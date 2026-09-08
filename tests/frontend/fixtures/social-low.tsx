import { memo, Profiler, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ChatProvider, useChat } from '@/components/chat/chat-context';
import { useChatControls, useChatHeader, useChatPane } from '@/components/chat/chat-view-context';
import ChatInput from '@/components/chat/chat-input';
import { MessageResponse } from '@/components/ai-elements/message';
import { AirdropClaimCard } from '@/components/airdrop-claim-card';
import { VerifyClaim } from '@/components/verify-claim';
import { WalletProfile } from '@/components/wallet-profile';
import AboutTab from '@/components/tabs/about-tab';
import StatusBar from '@/components/status-bar';
import { RankingPlantSummary } from '@/components/ranking-plant-summary';
import { RankingPlantFilters, type PlantRankingFilter } from '@/components/ranking-plant-filters';
import { WarehouseAssignmentEventRenderer, PlayedEventRenderer } from '@/components/activity/event-renderers';
import type { ChatMode } from '@/lib/types';
import { A, B, setFixtureOwner } from './social-medium-io';
import { deferNextAuth, releaseAuth } from './social-low-io';

let headerRenders = 0;
const Header = memo(function Header() {
  const chat = useChatHeader(); headerRenders += 1;
  return <><output aria-label="Header renders">{headerRenders}</output><output aria-label="Header unread">{chat.unreadCount}</output></>;
});
const paneRenders = { public: 0, ai: 0 };
const composerCommits = { public: 0, ai: 0 };
const Composer = memo(function Composer({ mode }: { mode: ChatMode }) {
  const [draft, setDraft] = useState('');
  return <div id={`${mode}-composer`}><Profiler id={`${mode}-input`} onRender={() => {
    document.getElementById(`${mode}-composer`)?.setAttribute('data-commits', String(++composerCommits[mode]));
  }}><ChatInput modeOverride={mode} message={draft} onMessageChange={setDraft} /></Profiler></div>;
});
const Pane = memo(function Pane({ mode }: { mode: ChatMode }) {
  const pane = useChatPane(mode); paneRenders[mode] += 1;
  return <section aria-label={`${mode} pane`}>
    <output aria-label={`${mode} renders`}>{paneRenders[mode]}</output>
    <output aria-label={`${mode} sending`}>{String(pane.isSending)}</output>
    <output aria-label={`${mode} ready`}>{String(pane.publicChatAuthenticated)}</output>
    <output aria-label={`${mode} loading`}>{String(pane.loading)}</output>
    <output aria-label={`${mode} messages`}>{pane.messages.map(message => message.message).join('|')}</output>
    <button onClick={() => void pane.sendMessageForMode(mode, 'Programmatic duplicate')}>Duplicate {mode} send</button>
    <Composer mode={mode} />
  </section>;
});
const ConversationProbe = memo(function ConversationProbe() { return <output aria-label="Conversation id">{useChat().conversationId}</output>; });
function ChatFixture() {
  const controls = useChatControls();
  return <><Header /><button onClick={() => controls.setChatOpen(true)}>Open chat</button>
    <ConversationProbe /><button onClick={() => void controls.fetchHistoryForMode('public', true)}>Refresh public history</button>
    <button onClick={deferNextAuth}>Delay next credential check</button><button onClick={releaseAuth}>Finish credential check</button>
    <button onClick={() => setFixtureOwner(B)}>Wallet B</button><button onClick={() => setFixtureOwner(A)}>Wallet A</button>
    <Pane mode="public" /><Pane mode="ai" /></>;
}
function RankingFixture() {
  const [value, setValue] = useState<PlantRankingFilter>('all'); const [mine, setMine] = useState(true);
  const onChange = (filter: PlantRankingFilter, nextMine: boolean) => { setValue(filter); setMine(nextMine); };
  return <><RankingPlantFilters value={value} mine={mine} canFilterMine onChange={onChange} />
    <output aria-label="Filter state">{value}:{String(mine)}</output>
    <RankingPlantSummary name="A long plant identity that must remain readable" level={42} points="12.34K" stars={3} rewards="0.004" compact={false} />
    <StatusBar placement="header" /></>;
}
function MessageFixture() {
  const [updated, setUpdated] = useState(false);
  return <><button onClick={() => setUpdated(true)}>Update markdown configuration</button>
    <MessageResponse className={updated ? 'updated-message' : 'original-message'} mode="static" components={updated ? { p: props => <p data-updated-markdown="true" {...props} /> } : undefined}>Unchanged message text</MessageResponse></>;
}
function WalletFixture() { const [open, setOpen] = useState(false); return <><button onClick={() => setOpen(true)}>Open wallet</button><WalletProfile open={open} onOpenChange={setOpen} /></>; }
function Fixture() {
  const scenario = new URLSearchParams(location.search).get('scenario');
  return <main className="p-4" data-low-ready="true"><h1 className="sr-only">Pixotchi</h1>
    {scenario === 'chat' ? <ChatProvider><ChatFixture /></ChatProvider> : scenario === 'ranking' ? <RankingFixture /> : scenario === 'message' ? <MessageFixture /> : scenario === 'wallet' ? <WalletFixture /> : scenario === 'hidden-claims' ? <><AirdropClaimCard /><VerifyClaim onClaimSuccess={() => {}} /></> : scenario === 'about' ? <AboutTab /> : <>
      {Array.from({ length: 4 }, (_, index) => <WarehouseAssignmentEventRenderer key={index} event={{ __typename: 'WarehouseAssignmentEvent', id: String(index), timestamp: String(Math.floor(Date.now() / 1000) - index * 60), blockHeight: '123456', landId: '1112', plantId: '42', resource: 'points', amount: '1290000000000000' }} />)}
      <PlayedEventRenderer event={{ __typename: 'Played', id: '5', timestamp: 'broken', gameName: 'SpinGameV2', nftId: '42', nftName: 'A'.repeat(200), points: '-1000000000000', timeExtension: '0', leafAmount: 'broken' }} />
    </>}
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
