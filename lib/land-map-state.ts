export type MapReadStatus = 'loading' | 'ready' | 'error';
export type MapPlotStatus = 'minted' | 'unminted' | 'unknown';
export type MapPoint = { x: number; y: number };

export function getMapPlotStatus(
  tokenId: number,
  totalSupply: number | null,
  knownMintedIds: ReadonlySet<number>,
  supplyIsCurrent: boolean,
): MapPlotStatus {
  if (knownMintedIds.has(tokenId) || (tokenId > 0 && totalSupply !== null && tokenId < totalSupply)) return 'minted';
  return totalSupply !== null && supplyIsCurrent ? 'unminted' : 'unknown';
}

export const clampMapZoom = (zoom: number) => Math.min(5, Math.max(0.2, zoom));

/** Keep the world point under the fingers fixed while zooming and translating. */
export function applyMapPinch(
  view: { center: MapPoint; zoom: number },
  previous: readonly [MapPoint, MapPoint],
  next: readonly [MapPoint, MapPoint],
  viewport: { width: number; height: number },
  tileSize = 40,
) {
  const midpoint = (points: readonly [MapPoint, MapPoint]) => ({ x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 });
  const distance = (points: readonly [MapPoint, MapPoint]) => Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
  const before = midpoint(previous);
  const after = midpoint(next);
  const oldDistance = distance(previous);
  const zoom = clampMapZoom(oldDistance > 0 ? view.zoom * distance(next) / oldDistance : view.zoom);
  const worldX = view.center.x + (before.x - viewport.width / 2) / (tileSize * view.zoom);
  const worldY = view.center.y - (before.y - viewport.height / 2) / (tileSize * view.zoom);
  return {
    zoom,
    center: {
      x: worldX - (after.x - viewport.width / 2) / (tileSize * zoom),
      y: worldY + (after.y - viewport.height / 2) / (tileSize * zoom),
    },
  };
}
