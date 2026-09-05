/** Narrow untrusted ABI/API values before they can enable a game action. */
export function readRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid response object');
  return value as Record<string, unknown>;
}

export function readTupleField(value: unknown, name: string, index: number): unknown {
  return Array.isArray(value) ? value[index] : readRecord(value)[name];
}

export function readInteger(value: unknown): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === 'string' && /^-?(0|[1-9]\d*)$/.test(value) && value.length <= 79) return BigInt(value);
  throw new Error('Invalid integer in response');
}

export function readUint(value: unknown, bits = 256): bigint {
  const result = readInteger(value);
  if (result < BigInt(0) || result >= (BigInt(1) << BigInt(bits))) throw new Error('Unsigned integer out of range');
  return result;
}

export function readInt256(value: unknown): bigint {
  const result = readInteger(value);
  const limit = BigInt(1) << BigInt(255);
  if (result < -limit || result >= limit) throw new Error('Signed integer out of range');
  return result;
}

export function readSafeUint(value: unknown, max = Number.MAX_SAFE_INTEGER): number {
  const result = readUint(value);
  if (result > BigInt(max)) throw new Error('Integer exceeds supported range');
  return Number(result);
}

export function readBoolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('Invalid boolean in response');
  return value;
}

export function readAddress(value: unknown): `0x${string}` {
  if (typeof value !== 'string' || !/^0x[\da-fA-F]{40}$/.test(value)) throw new Error('Invalid address in response');
  return value as `0x${string}`;
}
