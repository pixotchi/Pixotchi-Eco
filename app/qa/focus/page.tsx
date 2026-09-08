import { notFound } from 'next/navigation';
import { FocusFixtures } from './focus-fixtures';

export const metadata = { robots: { index: false, follow: false } };

export default function FocusFixturePage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <FocusFixtures />;
}
