/** Elapsed durations use total days, never calendar months/years. */
export function formatDurationSeconds(
  seconds: bigint,
  mode: "compact" | "exact" = "compact",
): string {
  if (seconds <= BigInt(0)) return "0s";
  let remaining = seconds;
  const parts: string[] = [];
  for (const [size, suffix] of [
    [86400, "d"],
    [3600, "h"],
    [60, "m"],
    [1, "s"],
  ] as const) {
    const units = remaining / BigInt(size);
    remaining %= BigInt(size);
    if (units) parts.push(`${units}${suffix}`);
    if (mode === "compact" && parts.length === 2) break;
  }
  return parts.join(" ");
}

/** Countdown labels use days after 24 hours. Minute-only labels round up so a
 * live deadline never appears expired during its final partial minute. */
export function formatCountdownDuration(
  seconds: bigint,
  showSeconds = true,
): string {
  const positive = seconds > BigInt(0) ? seconds : BigInt(0);
  const remaining = showSeconds
    ? positive
    : ((positive + BigInt(59)) / BigInt(60)) * BigInt(60);
  const days = remaining / BigInt(86400);
  const hours = (remaining % BigInt(86400)) / BigInt(3600);
  const minutes = (remaining % BigInt(3600)) / BigInt(60);
  const pad = (value: bigint) => value.toString().padStart(2, "0");
  return `${days ? `${days}d ` : ""}${pad(hours)}h:${pad(minutes)}m${showSeconds ? `:${pad(remaining % BigInt(60))}s` : ""}`;
}
