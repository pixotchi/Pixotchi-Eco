import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { WalletProfile } from '../../../components/wallet-profile';

function Fixture() {
  const [open, setOpen] = useState(false);
  return <><button onClick={() => setOpen(true)}>Open wallet profile</button><WalletProfile open={open} onOpenChange={setOpen} /></>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
