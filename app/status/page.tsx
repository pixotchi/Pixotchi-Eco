import { Metadata } from 'next';
import { CLIENT_ENV } from '@/lib/env-config';
import { runStatusChecks } from '@/lib/status-checks';
import { StatusPageClient } from '@/components/status/StatusPageClient';

export const metadata: Metadata = {
  title: 'Pixotchi Status | Live system health',
  description: 'Real-time uptime information for Pixotchi Mini App, RPC providers, indexer, notifications, and infrastructure.',
  openGraph: {
    title: 'Pixotchi Status',
    description: 'Live system health for the Pixotchi ecosystem.',
    url: 'https://status.pixotchi.tech',
    siteName: 'Pixotchi Status',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Pixotchi Status',
    description: 'Live system health for the Pixotchi ecosystem.',
  },
};

export const revalidate = 0;

export default async function StatusPage() {
  const snapshot = await runStatusChecks();
  const refreshMinutes = CLIENT_ENV.STATUS_REFRESH_MINUTES || 15;
  return (
    <StatusPageClient initialSnapshot={snapshot} refreshMinutes={refreshMinutes} />
  );
}

