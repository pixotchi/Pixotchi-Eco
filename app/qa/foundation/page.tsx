import { notFound } from 'next/navigation';
import { FoundationFixtures } from './foundation-fixtures';

export const metadata = { robots: { index: false, follow: false } };
export default function FoundationFixturePage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <FoundationFixtures />;
}
