import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { EmptyFarm } from '@/components/empty-farm';
import { AssetTitle } from '@/components/asset-title';
import { FirstCareGuide } from '@/components/first-care-guide';
import { PlantClaimSummary } from '@/components/plant-claim-summary';
import EditPlantName from '@/components/edit-plant-name';
import { EditLandName } from '@/components/edit-land-name';
import WarehousePanel from '@/components/building-details/WarehousePanel';
import BatchClaimCard from '@/components/transactions/batch-claim-card';
import BatchQuestStartCard from '@/components/transactions/batch-quest-start-card';
import PlantProfileDialog from '@/components/plant-profile-dialog';
import { GAME_NAVIGATION_EVENT } from '@/lib/game-navigation';
import { markBatchQuestRunPending } from '@/lib/quest-preferences';
import type { Land } from '@/lib/types';
import { owner, plant } from './gameplay-low-io';

const land: Land = { tokenId: BigInt(1), name: 'Home', owner, tokenUri: '', mintDate: BigInt(0), coordinateX: BigInt(0), coordinateY: BigInt(0), experiencePoints: BigInt(0), accumulatedPlantPoints: BigInt(0), accumulatedPlantLifetime: BigInt(0), farmerAvatar: 0 };
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
if (new URLSearchParams(location.search).get('scenario') === 'quest-pending') markBatchQuestRunPending(`${owner}:1`, Date.now(), 'saved-operation');
function Fixture() {
  const scenario = new URLSearchParams(location.search).get('scenario');
  const [mint, setMint] = useState('');
  const [navigation, setNavigation] = useState('');
  const [action, setAction] = useState('');
  const [liveName, setLiveName] = useState<string | null>(null);
  useEffect(() => {
    const mintListener = (event: Event) => setMint((event as CustomEvent<string>).detail);
    const navigationListener = (event: Event) => setNavigation((event as CustomEvent<{ tab: string }>).detail.tab);
    const nameListener = (event: Event) => setLiveName((event as CustomEvent<string>).detail);
    window.addEventListener('fixture-mint', mintListener);
    window.addEventListener(GAME_NAVIGATION_EVENT, navigationListener);
    window.addEventListener('fixture-name-refresh', nameListener);
    return () => { window.removeEventListener('fixture-mint', mintListener); window.removeEventListener(GAME_NAVIGATION_EVENT, navigationListener); window.removeEventListener('fixture-name-refresh', nameListener); };
  }, []);
  return <main data-fixtures-ready className="mx-auto w-full max-w-lg space-y-4 p-4">
    {scenario === 'empty' && <><EmptyFarm asset="plant" /><EmptyFarm asset="land" /></>}
    {scenario === 'names' && <><EditPlantName plant={{ ...plant, name: liveName ?? plant.name }} onNameChanged={(id, name) => setAction(`plant:${id}:${name}`)} /><EditLandName land={{ ...land, name: liveName ?? land.name }} onNameChanged={(id, name) => setAction(`land:${id}:${name}`)} /></>}
    {scenario === 'title' && <AssetTitle name="Longflowernamewithoutspaces" edit={<button className="h-11 w-11" aria-label="Edit name">Edit</button>} />}
    {scenario === 'guidance' && <><FirstCareGuide hasPlant dead onRevive={() => setAction('revival')} owner={owner} /><PlantClaimSummary points={plant.score} level={plant.level} rewards={plant.rewards} descriptionId="claim-details" /></>}
    {scenario === 'warehouse' && <WarehousePanel landId={BigInt(1)} warehousePoints={BigInt(12) * BigInt(10) ** BigInt(12)} warehouseLifetime={BigInt(3600)} onApplySuccess={() => undefined} />}
    {scenario === 'claim-locked' && <BatchClaimCard lands={[land]} showWhenEmpty onOpenBuildings={() => setAction('village')} />}
    {scenario?.startsWith('quest-') && <BatchQuestStartCard lands={[land]} showWhenEmpty onOpenFarmerHouse={() => setAction('farmer-house')} />}
    {scenario === 'profile' && <PlantProfileDialog open onOpenChange={() => undefined} plant={plant} />}
    <output aria-label="Mint target">{mint}</output><output aria-label="Navigation target">{navigation}</output><output aria-label="Next action">{action}</output>
  </main>;
}
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={client}><Fixture /></QueryClientProvider>);
