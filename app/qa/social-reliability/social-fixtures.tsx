"use client";

import { useCallback, useRef, useState } from 'react';
import AiChatEngine from '@/components/chat/ai-chat-engine';
import { ChatComposer } from '@/components/chat/chat-composer';
import { ChatMessageBubble } from '@/components/chat/chat-message-bubble';
import { getAIUIMessageText, type AIUIMessage, type AiChatHandle, type AiChatStatus } from '@/components/chat/ai-message-utils';
import { VerifyClaimContent } from '@/components/verify-claim';
import { useActivityFeeds } from '@/hooks/useActivityFeeds';

const A = '0x1111111111111111111111111111111111111111';
const B = '0x2222222222222222222222222222222222222222';
const identity = (events: string[]) => events;
const loadAll = async () => ['Public activity'];

function ActivityFixture() {
  const [owner, setOwner] = useState<string | null>(null);
  const reads = useRef<{ owner: string; resolve: (data: { activities: string[]; landIds: string[]; plantIds: string[] }) => void }[]>([]);
  const [count, setCount] = useState(0);
  const loadMy = useCallback((address: string) => new Promise<{ activities: string[]; landIds: string[]; plantIds: string[] }>(resolve => {
    reads.current.push({ owner: address, resolve });
    setCount(reads.current.length);
  }), []);
  const feeds = useActivityFeeds({ owner, visible: true, loadAll, loadMy, transform: identity });
  const resolve = (index: number) => {
    const read = reads.current[index];
    read?.resolve({ activities: [read.owner === A ? 'Wallet A activity' : 'Wallet B activity'], landIds: [], plantIds: [] });
  };
  return <section aria-label="Activity reliability">
    <button onClick={() => setOwner(A)}>Connect A</button>
    <button onClick={() => setOwner(B)}>Connect B</button>
    <button onClick={() => resolve(0)}>Resolve first activity</button>
    <button onClick={() => resolve(reads.current.length - 1)}>Resolve latest activity</button>
    <output aria-label="Activity reads">{count}</output>
    <output aria-label="My activity">{feeds.loadingByView.my ? 'Loading' : feeds.activitiesByView.my.join(', ') || 'Empty'}</output>
  </section>;
}

function ClaimFixture() {
  const [owner, setOwner] = useState<typeof A | typeof B>(A);
  const [successes, setSuccesses] = useState(0);
  const [requests, setRequests] = useState(0);
  const [signatures, setSignatures] = useState(0);
  const statusReads = useRef<{ owner: string; resolve: (response: Response) => void }[]>([]);
  const signature = useRef<((signature: `0x${string}`) => void) | null>(null);
  const claim = useRef<((response: Response) => void) | null>(null);
  const request = useCallback<typeof fetch>((url) => {
    const path = String(url);
    if (path.startsWith('/api/verify/status')) return new Promise(resolve => {
      statusReads.current.push({ owner: path.includes(A) ? A : B, resolve });
      setRequests(statusReads.current.length);
    });
    if (path === '/api/verify/check') return Promise.resolve(Response.json({ verified: true, token: 'fixture' }));
    if (path === '/api/verify/claim') return new Promise(resolve => { claim.current = resolve; setSignatures(value => value + 1); });
    throw new Error(`Unexpected fixture request ${path}`);
  }, []);
  const signMessageAsync = useCallback(() => new Promise<`0x${string}`>(resolve => { signature.current = resolve; }), []);
  const resolveStatus = (address: string, state: string) => statusReads.current.filter(read => read.owner === address).forEach(read => read.resolve(Response.json({ claimState: state, bonuses: { leaf: false, seed: false } })));
  return <section aria-label="Claim reliability">
    <button onClick={() => setOwner(B)}>Switch claim wallet</button>
    <button onClick={() => resolveStatus(A, 'complete')}>A already claimed</button>
    <button onClick={() => resolveStatus(A, 'unclaimed')}>A eligible</button>
    <button onClick={() => resolveStatus(B, 'unclaimed')}>B eligible</button>
    <button onClick={() => signature.current?.('0x1234')}>Resolve signature</button>
    <button onClick={() => claim.current?.(Response.json({ success: true, status: 'complete', mintTxHash: '0xfixture' }))}>Resolve submitted claim</button>
    <output aria-label="Claim status reads">{requests}</output>
    <output aria-label="Submitted claims">{signatures}</output>
    <output aria-label="Claim successes">{successes}</output>
    <VerifyClaimContent key={owner} address={owner} signMessageAsync={signMessageAsync} request={request} onClaimSuccess={() => setSuccesses(value => value + 1)} />
  </section>;
}

function AiFixture() {
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState<AiChatStatus>('ready');
  const [error, setError] = useState('');
  const [messages, setMessages] = useState<AIUIMessage[]>([]);
  const [ready, setReady] = useState(false);
  const handle = useRef<AiChatHandle | null>(null);
  const onReady = useCallback((value: AiChatHandle) => { handle.current = value; setReady(true); }, []);
  const onError = useCallback((value: Error) => setError(value.message), []);
  return <section aria-label="AI reliability" data-ai-ready={ready}>
    <AiChatEngine onReady={onReady} onError={onError} onStatusChange={setStatus} onMessagesChange={setMessages} />
    <output aria-label="AI error">{error}</output>
    <button onClick={() => handle.current?.setMessages([])}>Replace AI history</button>
    {messages.map(message => <ChatMessageBubble key={message.id} content={getAIUIMessageText(message)} kind={message.role === 'assistant' ? 'assistant' : 'own'} displayName={message.role === 'assistant' ? 'Neural Seed' : 'You'} relativeTime="now" deliveryStatus={message.metadata?.deliveryStatus} />)}
    <ChatComposer activeMode="ai" message={draft} onMessageChange={setDraft} activeSending={status === 'submitted' || status === 'streaming'} publicChatAuthenticated={true} publicChatLoading={false}
      cancelActiveSend={() => void handle.current?.stop()} onSend={async text => {
        const result = await handle.current!.sendMessage({ text }, { body: {}, headers: {} });
        if (result.status === 'failed') setError(result.error.message);
        return result.status === 'accepted';
      }} />
  </section>;
}

export function SocialReliabilityFixtures() {
  return <main className="mx-auto max-w-xl space-y-10 p-4"><h1>Social reliability fixtures</h1><ActivityFixture /><ClaimFixture /><AiFixture /></main>;
}
