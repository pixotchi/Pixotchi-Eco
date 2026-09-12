import { resolvePrimaryNames } from '@/lib/ens-resolver';
import { createEnsLookupHandler } from '@/lib/ens-request';

export const runtime = 'nodejs';

export const POST = createEnsLookupHandler('names', async (addresses, signal) =>
  Object.fromEntries(await resolvePrimaryNames(addresses, { signal })),
);
