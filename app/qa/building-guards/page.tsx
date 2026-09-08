import { notFound } from 'next/navigation';
import { BuildingGuardFixtures } from './fixtures';

export const metadata = { robots: { index: false, follow: false } };

export default function BuildingGuardPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <BuildingGuardFixtures />;
}
