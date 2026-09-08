"use client";

import { useState } from 'react';
import { BarracksReportCard } from '@/components/building-details/barracks-report';
import { ChatMessageBubble } from '@/components/chat/chat-message-bubble';
import { ArcadeStatLine } from '@/components/arcade/arcade-stat-line';
import { RankingColumns } from '@/components/ranking-columns';
import { RankingPlantSummary } from '@/components/ranking-plant-summary';
import { ResourceState } from '@/components/ui/resource-state';
import { Button } from '@/components/ui/button';
import type { BarracksRaidReportV2 } from '@/lib/types';

const B = BigInt;
const report: BarracksRaidReportV2 = {
  raidId: B(123), timestamp: B(1788602400), attackerLandId: B(712), defenderLandId: B(999), attackerWon: false,
  swordsmenSent: B('12345678901234567890'), phalanxSent: B(25), attackerSwordsmenBefore: B('12345678901234567890'), attackerPhalanxBefore: B(25),
  defenderSwordsmenBefore: B(9876), defenderPhalanxBefore: B(8765), attackerSwordsmenLost: B('12345678901234567890'), attackerPhalanxLost: B(25),
  defenderSwordsmenLost: B(12), defenderPhalanxLost: B(34), survivingAttackerSwordsmen: B(0), survivingAttackerPhalanx: B(0),
  survivingDefenderSwordsmen: B(9864), survivingDefenderPhalanx: B(8731), attackerPower: B(1), defenderPower: B(2),
  pendingPointsSettled: B(1), pendingLifetimeSettled: B(86461), pointsStolen: B(0), lifetimeStolen: B(0),
};

export function DenseSurfaceFixtures() {
  const [mode, setMode] = useState<'outgoing' | 'incoming' | 'empty' | 'error'>('outgoing');
  const [profileVisits, setProfileVisits] = useState(0);
  return <>
    <section aria-label="Barracks report fixture" className="max-w-md space-y-4 rounded border bg-card p-4">
      <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => setMode('outgoing')}>Attack report</Button><Button variant="outline" onClick={() => setMode('incoming')}>Defense report</Button><Button variant="outline" onClick={() => setMode('empty')}>Empty report</Button><Button variant="outline" onClick={() => setMode('error')}>Failed report</Button></div>
      <div data-visual="barracks"><BarracksReportCard report={mode === 'error' ? null : mode === 'empty' ? { ...report, raidId: B(0) } : report} mode={mode === 'incoming' ? 'incoming' : 'outgoing'} timestampLabel={new Date(Number(report.timestamp) * 1000).toLocaleString('en-US', { timeZone: 'UTC' })} onRetry={() => setMode('outgoing')} /></div>
    </section>
    <section aria-label="Chat message fixture" className="max-w-xl space-y-3 rounded border bg-background p-3">
      <div data-visual="chat" className="space-y-3">
        <ChatMessageBubble kind="other" displayName="A very long player name that should wrap comfortably" content={'Welcome to the village!\n'+ 'a'.repeat(100)} relativeTime="2m ago" timestamp="2026-09-05T10:00:00.000Z" onOpenProfile={() => setProfileVisits(value => value + 1)} />
        <ChatMessageBubble kind="own" displayName="You" content="Thanks! My plants are ready for their next quest." relativeTime="now" timestamp="2026-09-05T10:02:00.000Z" />
        <ChatMessageBubble kind="assistant" displayName="Neural Seed" content={'### Your next steps\n\n1. Claim your ready production.\n2. Check your plant lifetime.\n\n**Tip:** Keep enough SEED for care.'} relativeTime="now" timestamp="2026-09-05T10:02:00.000Z" />
      </div>
      <output aria-label="Fixture profile visits">{profileVisits}</output>
    </section>
    <section aria-label="Arcade readout fixture" className="max-w-md rounded border bg-card p-4">
      <div data-visual="arcade" className="space-y-4">
        <h2 className="font-semibold">Spin status</h2>
        <div className="divide-y divide-border/60 text-sm"><ArcadeStatLine label="Stars available" value="123456789012345678901234567890" /><ArcadeStatLine label="Cooldown" value="2d 14h" tone="warning" /><ArcadeStatLine label="Confirmation" value="Waiting for your wallet to reconnect" /></div>
        <ResourceState status="error" title="Spin status unavailable" description="Your submitted spin is saved. Reconnect your wallet to check its result." />
      </div>
    </section>
    <section aria-label="Ranking columns fixture" className="rounded border bg-card p-3">
      <RankingColumns rows={Array.from({ length: 11 }, (_, index) => ({ rank: index + 1 }))} renderRow={row => <div key={row.rank} className="flex min-h-11 items-center justify-between gap-3 py-2 text-sm"><span>#{row.rank}</span><div className="min-w-0 flex-1"><RankingPlantSummary name={`Player #${row.rank}`} level={28} points="12.45M" stars={342} rewards="0.000071" /></div><Button size="icon" variant="ghost" aria-label={`View player ${row.rank}`}>↗</Button></div>} />
    </section>
  </>;
}
