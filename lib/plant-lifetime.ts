/** Contract TOD is an absolute Unix timestamp, not a duration. */
export function getPlantLifetime(starvingAt: number, snapshotTimestamp: number) {
  const remainingSeconds = Math.max(0, starvingAt - snapshotTimestamp);
  return {
    starvingAt,
    lifetimeSnapshotTimestamp: snapshotTimestamp,
    timeUntilStarvingHours: remainingSeconds / 3600,
    timeUntilStarvingSeconds: remainingSeconds,
  };
}
