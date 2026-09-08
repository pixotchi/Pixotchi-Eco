import { notFound } from 'next/navigation';
import { SwapLayoutFixture } from './swap-layout-fixture';
import { MintLayoutFixture } from './mint-layout-fixture';

export const metadata = { robots: { index: false, follow: false } };

export default function EconomyLayoutPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <><SwapLayoutFixture /><MintLayoutFixture /></>;
}
