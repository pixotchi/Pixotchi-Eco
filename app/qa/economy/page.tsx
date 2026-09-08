import { notFound } from 'next/navigation';
import { EconomyFixtures } from './economy-fixtures';

export const metadata = { robots: { index: false, follow: false } };

export default function EconomyFixturePage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <EconomyFixtures />;
}
