import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Pixotchi Admin Dashboard',
  description: 'Administrative interface for Pixotchi invite system management',
  robots: 'noindex, nofollow', // Prevent search engine indexing
};

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="admin-page-scrollable min-h-screen">
      {children}
    </div>
  );
}
