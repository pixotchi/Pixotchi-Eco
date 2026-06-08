import type { Metadata } from 'next';
import { CoreProviders } from '../core-providers';

export const metadata: Metadata = {
  title: 'Pixotchi Admin Dashboard',
  description: 'Administrative interface for Pixotchi operations',
  robots: 'noindex, nofollow', // Prevent search engine indexing
};

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <CoreProviders>
      <div className="admin-page-scrollable min-h-screen">
        {children}
      </div>
    </CoreProviders>
  );
}
