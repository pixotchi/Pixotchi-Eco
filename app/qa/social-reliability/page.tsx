import { notFound } from 'next/navigation';
import { SocialReliabilityFixtures } from './social-fixtures';

export const metadata = { robots: { index: false, follow: false } };
export default function Page() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <SocialReliabilityFixtures />;
}
