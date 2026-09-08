import { notFound } from 'next/navigation';
import { ScopedFixtures, type FixtureSuite } from './scoped-fixtures';

export const metadata = { robots: { index: false, follow: false } };

export default async function FrontendFixturePage({ searchParams }: { searchParams: Promise<{ suite?: string }> }) {
  // No wallet/provider tree, live reads, or mutations. Never available in a release build.
  if (process.env.NODE_ENV === 'production') notFound();
  const { suite } = await searchParams;
  const selected: FixtureSuite = suite === 'dense' || suite === 'controllers' || suite === 'plant-attack' || suite === 'primitives' ? suite : 'all';
  return <ScopedFixtures suite={selected} />;
}
