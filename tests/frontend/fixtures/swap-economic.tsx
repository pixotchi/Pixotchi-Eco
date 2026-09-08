import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import PixotchiSwapPanel from '@/components/tabs/pixotchi-swap-panel';
import { changeFixtureWallet } from './swap-economic-io';

function Fixture() {
  const client = useQueryClient();
  return <main><button onClick={() => void client.invalidateQueries({ queryKey: ['fixture-balance'] })}>Refresh fixture balances</button>
    <button onClick={changeFixtureWallet}>Change fixture wallet</button><PixotchiSwapPanel /></main>;
}
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={new QueryClient()}><Fixture /></QueryClientProvider>);
