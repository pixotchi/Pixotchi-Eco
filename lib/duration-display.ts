/** Elapsed durations use total days, never calendar months/years. */
export function formatDurationSeconds(seconds: bigint, mode: 'compact' | 'exact' = 'compact'): string {
  if (seconds <= BigInt(0)) return '0s';
  let remaining = seconds;
  const parts: string[] = [];
  for (const [size, suffix] of [[86400, 'd'], [3600, 'h'], [60, 'm'], [1, 's']] as const) {
    const units = remaining / BigInt(size);
    remaining %= BigInt(size);
    if (units) parts.push(`${units}${suffix}`);
    if (mode === 'compact' && parts.length === 2) break;
  }
  return parts.join(' ');
}
