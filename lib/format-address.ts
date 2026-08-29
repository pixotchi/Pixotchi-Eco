import { ADDRESS_TRUNCATION } from "./constants";

/**
 * Standardized address formatting using centralized truncation constants.
 *
 * Lives here rather than in lib/utils.ts to keep lib/contracts.ts out of an import
 * cycle: utils.ts imports contract addresses from contracts.ts, so having
 * contracts.ts import formatAddress back from utils.ts made the app's most widely
 * imported module part of a cycle. It resolved only because every use sat inside a
 * function body; a single top-level use in utils.ts would have turned it into a
 * temporal-dead-zone crash at module init. lib/constants.ts imports nothing, so
 * this module is a safe leaf for both sides.
 */
export function formatAddress(address: string, prefixLen?: number, suffixLen?: number, full: boolean = false): string {
  if (full || address.length <= 14) return address;
  const prefix = prefixLen ?? ADDRESS_TRUNCATION.prefix;
  const suffix = suffixLen ?? ADDRESS_TRUNCATION.suffix;
  return `${address.slice(0, prefix)}...${address.slice(-suffix)}`;
}
