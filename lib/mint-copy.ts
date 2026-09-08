import { formatDurationSeconds } from './duration-display';
import type { Strain } from './types';

export const PLANT_MINT_DESCRIPTION = 'Choose a look you like, then review the mint price, payment token and available supply.';
export const LAND_MINT_DESCRIPTION = 'Mint a land to build and upgrade its Village and Town. Village buildings produce PTS and lifetime that you can collect and apply to a plant.';

export function formatStartingLifetime(seconds: number): string {
  if (!Number.isSafeInteger(seconds) || seconds < 0) return 'Unavailable';
  if (seconds % 3600 === 0) {
    const hours = seconds / 3600;
    return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  }
  return formatDurationSeconds(BigInt(seconds));
}

/** Describe the loaded catalog; do not hardcode a value the contract can change. */
export function getSharedStartingLifetimeCopy(strains: readonly Pick<Strain, 'strainInitialTOD'>[]): string | null {
  if (strains.length < 2) return null;
  const seconds = strains[0].strainInitialTOD;
  if (!Number.isSafeInteger(seconds) || seconds < 0 || strains.some(strain => strain.strainInitialTOD !== seconds)) return null;
  return `All listed strains currently start with ${formatStartingLifetime(seconds)} of lifetime.`;
}
