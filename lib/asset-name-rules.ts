export type RenameAssetType = 'land' | 'plant';

export const ASSET_NAME_RULES: Record<RenameAssetType, {
  maxBytes: number;
  minBytes: number;
}> = {
  land: {
    maxBytes: 10,
    minBytes: 3,
  },
  plant: {
    maxBytes: 10,
    minBytes: 2,
  },
};

export const DEFAULT_PLANT_NAME_CHANGE_COST_SEED = 350;

const textEncoder = typeof TextEncoder !== 'undefined' ? new TextEncoder() : null;

export function getUtf8ByteLength(value: string): number {
  if (textEncoder) return textEncoder.encode(value).length;
  return unescape(encodeURIComponent(value)).length;
}

export function truncateUtf8ToMaxBytes(value: string, maxBytes: number): string {
  let output = '';
  let bytes = 0;

  for (const character of Array.from(value)) {
    const characterBytes = getUtf8ByteLength(character);
    if (bytes + characterBytes > maxBytes) break;
    output += character;
    bytes += characterBytes;
  }

  return output;
}

export function getAssetNameValidation(assetType: RenameAssetType, value: string) {
  const rule = ASSET_NAME_RULES[assetType];
  const trimmed = value.trim();
  const rawByteLength = getUtf8ByteLength(value);
  const byteLength = getUtf8ByteLength(trimmed);
  const isBlank = trimmed.length === 0;
  const isTooShort = !isBlank && byteLength < rule.minBytes;
  const isTooLong = byteLength > rule.maxBytes;

  return {
    assetType,
    byteLength,
    isBlank,
    isTooLong,
    isTooShort,
    maxBytes: rule.maxBytes,
    minBytes: rule.minBytes,
    rawByteLength,
    remainingBytes: Math.max(0, rule.maxBytes - rawByteLength),
    trimmed,
    validFormat: !isBlank && !isTooShort && !isTooLong,
  };
}

export function getAssetNameInvalidReason(assetType: RenameAssetType, value: string): string | null {
  const validation = getAssetNameValidation(assetType, value);
  if (validation.isBlank) return 'Enter a name';
  if (validation.isTooShort) return `Need at least ${validation.minBytes} bytes`;
  if (validation.isTooLong) return 'Name too long';
  return null;
}
