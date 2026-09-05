import { notFound } from 'next/navigation';
import { FrontendFixtures } from './frontend-fixtures';

export const metadata = { robots: { index: false, follow: false } };

export default function FrontendFixturePage() {
  // No wallet/provider tree, live reads, or mutations. Never available in a release build.
  if (process.env.NODE_ENV === 'production') notFound();
  return <FrontendFixtures />;
}
