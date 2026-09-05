import type { WarehouseAssignmentEvent } from './types';

type IndexedAssignment = {
  id: string;
  timestamp: string;
  blockHeight: string;
  landId: string;
  plantId: string;
};

type IndexedWarehouseActivity = {
  plantPointsAssignedEvents?: { items: (IndexedAssignment & { addedPoints: string })[] };
  plantLifetimeAssignedEvents?: { items: (IndexedAssignment & { lifetime: string })[] };
};

/** Both deployed event types use the existing indexer, feed window and limits. */
export function warehouseActivityQuery(limit: number, filter: string): string {
  return `
    plantPointsAssignedEvents(orderBy: "timestamp", orderDirection: "desc", limit: ${limit}, where: { ${filter} }) {
      items { id timestamp blockHeight landId plantId addedPoints }
    }
    plantLifetimeAssignedEvents(orderBy: "timestamp", orderDirection: "desc", limit: ${limit}, where: { ${filter} }) {
      items { id timestamp blockHeight landId plantId lifetime }
    }
  `;
}

export function normalizeWarehouseActivity(data: IndexedWarehouseActivity): WarehouseAssignmentEvent[] {
  const normalize = (event: IndexedAssignment, resource: 'points' | 'lifetime', amount: string): WarehouseAssignmentEvent => ({
    __typename: 'WarehouseAssignmentEvent',
    id: `warehouse:${resource}:${event.id}`,
    timestamp: event.timestamp,
    blockHeight: event.blockHeight,
    landId: event.landId,
    plantId: event.plantId,
    resource,
    amount,
  });
  return [
    ...(data.plantPointsAssignedEvents?.items ?? []).map(event => normalize(event, 'points', event.addedPoints)),
    ...(data.plantLifetimeAssignedEvents?.items ?? []).map(event => normalize(event, 'lifetime', event.lifetime)),
  ];
}
