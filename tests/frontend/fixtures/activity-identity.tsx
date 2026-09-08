import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { getAllActivity } from '@/lib/activity-client';
import type { ActivityEvent } from '@/lib/types';
import { createActivityPerspective } from '@/lib/activity-filters';
import { ActivityIdentityContext, AttackEventRenderer, KilledEventRenderer, MintEventRenderer, PlayedEventRenderer, ItemConsumedEventRenderer, ShopItemPurchasedEventRenderer, WarehouseAssignmentEventRenderer, LandMintedEventRenderer, BarracksRaidEventRenderer } from '@/components/activity/event-renderers';

const perspective = createActivityPerspective(['0', '42', '99999'], ['7']);
function Record({ event }: { event: ActivityEvent }) {
  switch (event.__typename) {
    case 'Attack': return <AttackEventRenderer event={event} perspective={perspective} />;
    case 'Killed': return <KilledEventRenderer event={event} perspective={perspective} />;
    case 'Mint': return <MintEventRenderer event={event} />;
    case 'Played': return <PlayedEventRenderer event={event} perspective={perspective} />;
    // Each raw care entry here is a single-event bundle, as in ActivityTab.
    case 'ItemConsumed': return <ItemConsumedEventRenderer event={{ ...event, quantity: 1 }} perspective={perspective} itemMap={{}} />;
    case 'ShopItemPurchased': return <ShopItemPurchasedEventRenderer event={event} perspective={perspective} itemMap={{}} />;
    case 'WarehouseAssignmentEvent': return <WarehouseAssignmentEventRenderer event={event} />;
    case 'LandMintedEvent': return <LandMintedEventRenderer event={event} />;
    case 'BarracksRaidEvent': return <BarracksRaidEventRenderer event={event} />;
    default: return null;
  }
}
function Fixture() {
  const [events, setEvents] = useState<ActivityEvent[] | null>(null);
  useEffect(() => { void getAllActivity().then(setEvents); }, []);
  return <main data-identity-ready={String(events !== null)}><ActivityIdentityContext.Provider value={perspective}>
    {events?.map(event => <section key={event.id} aria-label={event.id}><Record event={event} /></section>)}
  </ActivityIdentityContext.Provider></main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
