import { ActivityEvent } from './types';

/** A personal feed plus the plant/land IDs it was scoped to. */
export type MyActivityResponse = {
  activities: ActivityEvent[];
  landIds: string[];
  plantIds: string[];
};

async function fetchActivityPayload(endpoint: string): Promise<UntypedValue> {
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

  return response.json();
}

function toActivityList(value: UntypedValue): ActivityEvent[] {
  return Array.isArray(value) ? value : [];
}

function toIdList(value: UntypedValue): string[] {
  return Array.isArray(value) ? value.map((id) => String(id)) : [];
}

export async function getAllActivity(): Promise<ActivityEvent[]> {
  const json = await fetchActivityPayload('/api/activity/recent');
  return toActivityList(json?.activities);
}

export async function getMyActivity(address: string): Promise<MyActivityResponse> {
  const params = new URLSearchParams({ address });
  const json = await fetchActivityPayload(`/api/activity/my?${params.toString()}`);

  return {
    activities: toActivityList(json?.activities),
    landIds: toIdList(json?.landIds),
    plantIds: toIdList(json?.plantIds),
  };
}
