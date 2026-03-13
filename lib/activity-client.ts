import { ActivityEvent } from './types';

async function fetchActivity(endpoint: string): Promise<ActivityEvent[]> {
  const response = await fetch(endpoint, {
    method: 'GET',
    cache: 'no-store',
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Activity request failed: ${response.status}`);
  }

  const json = await response.json();
  return Array.isArray(json?.activities) ? json.activities : [];
}

export async function getAllActivity(): Promise<ActivityEvent[]> {
  return fetchActivity('/api/activity/recent');
}

export async function getMyActivity(address: string): Promise<ActivityEvent[]> {
  const params = new URLSearchParams({ address });
  return fetchActivity(`/api/activity/my?${params.toString()}`);
}
