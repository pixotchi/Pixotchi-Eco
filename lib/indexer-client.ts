import 'server-only';

const DEFAULT_INDEXER_URL = 'https://api.mini.pixotchi.tech/graphql';
const INDEXER_SHARED_SECRET_HEADER = 'x-indexer-secret';
const DEFAULT_MAX_REQUEST_BYTES = 32 * 1024;

type IndexerFetchOptions = {
  revalidate?: number;
  signal?: AbortSignal;
  tags?: string[];
};

function getMaxRequestBytes(): number {
  const parsed = Number(process.env.INDEXER_MAX_REQUEST_BYTES || DEFAULT_MAX_REQUEST_BYTES);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_REQUEST_BYTES;
}

export function getIndexerUpstreamUrl(): string {
  return process.env.INDEXER_UPSTREAM_URL
    || process.env.NEXT_PUBLIC_PONDER_API_URL
    || DEFAULT_INDEXER_URL;
}

function buildIndexerHeaders(): HeadersInit {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  const sharedSecret = process.env.INDEXER_SHARED_SECRET?.trim();
  if (sharedSecret) {
    headers[INDEXER_SHARED_SECRET_HEADER] = sharedSecret;
  }

  return headers;
}

export async function fetchIndexerGraphQL<T>(
  query: string,
  variables?: Record<string, UntypedValue>,
  options: IndexerFetchOptions = {},
): Promise<T> {
  const body = JSON.stringify({ query, variables });

  if (Buffer.byteLength(body, 'utf8') > getMaxRequestBytes()) {
    throw new Error('Indexer request exceeds configured size limit');
  }

  const response = await fetch(getIndexerUpstreamUrl(), {
    method: 'POST',
    headers: buildIndexerHeaders(),
    body,
    signal: options.signal,
    ...(options.revalidate
      ? { next: { revalidate: options.revalidate, tags: options.tags } }
      : { cache: 'no-store' }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Indexer request failed (${response.status}): ${text || response.statusText}`);
  }

  const json = await response.json();

  if (json?.errors) {
    console.error('Indexer GraphQL errors:', json.errors);
    throw new Error('Indexer returned GraphQL errors');
  }

  return json.data as T;
}
