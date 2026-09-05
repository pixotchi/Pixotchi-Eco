import type { OwnerResourceDomain, OwnerResourceInvalidationRequest } from '@/lib/owner-resource-invalidation';

export type PendingEvmEffects = 'none' | {
  domains: OwnerResourceInvalidationRequest['domains'];
  expected?: OwnerResourceInvalidationRequest['expected'];
};

const domains: readonly OwnerResourceDomain[] = ['allowances', 'arcade', 'balances', 'buildings', 'lands', 'plants', 'rewards'];
const countKeys = ['landCountAtLeast', 'plantCountAtLeast'] as const;
const plantKeys = ['plantIdsAbsent', 'plantIdsPresent'] as const;
const landKeys = ['landIdsAbsent', 'landIdsPresent'] as const;
const expectedKeys: readonly string[] = [...countKeys, ...plantKeys, ...landKeys];
const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const isLandId = (value: unknown): value is number | string => isCount(value) || (typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value));

/** Validate optional reconciliation metadata independently of durable submission proof. */
export function isPendingEvmEffects(value: unknown): value is PendingEvmEffects | undefined {
  if (value === undefined || value === 'none') return true;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (!('domains' in value) || !Array.isArray(value.domains)
    || value.domains.length > domains.length
    || !value.domains.every((domain: unknown) => domains.some(allowed => allowed === domain))) return false;
  if (!('expected' in value) || value.expected === undefined) return true;
  const expected = value.expected;
  if (!expected || typeof expected !== 'object' || Array.isArray(expected)) return false;
  if (Object.keys(expected).some(key => !expectedKeys.includes(key))) return false;
  return countKeys.every(key => !(key in expected) || isCount(Reflect.get(expected, key)))
    && plantKeys.every(key => {
      if (!(key in expected)) return true;
      const ids: unknown = Reflect.get(expected, key);
      return Array.isArray(ids) && ids.every(isCount);
    })
    && landKeys.every(key => {
      if (!(key in expected)) return true;
      const ids: unknown = Reflect.get(expected, key);
      return Array.isArray(ids) && ids.every(isLandId);
    });
}

export function normalizePendingEffects(effects: PendingEvmEffects): PendingEvmEffects {
  if (effects === 'none') return effects;
  const expected = effects.expected;
  return {
    domains: [...new Set(effects.domains)],
    ...(expected ? { expected: {
      ...expected,
      ...(expected.landIdsAbsent ? { landIdsAbsent: expected.landIdsAbsent.map(id => typeof id === 'bigint' ? id.toString() : id) } : {}),
      ...(expected.landIdsPresent ? { landIdsPresent: expected.landIdsPresent.map(id => typeof id === 'bigint' ? id.toString() : id) } : {}),
    } } : {}),
  };
}
