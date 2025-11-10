import { SERVER_ENV } from '@/lib/env-config';

const DEFAULT_BASE_URL = 'https://api.memoryproto.co';
const DEFAULT_PERSONALITY_PATH = '/wallets/:identifier/personality';
const DEFAULT_IDENTITY_PATH = '/identities/wallet/:identifier';

export interface MemoryArchetype {
  id: string;
  label: string;
  confidence?: number;
  description?: string;
}

export interface MemoryTrait {
  id: string;
  label: string;
  score?: number;
  category?: string;
}

export type MemorySentimentLabel = 'positive' | 'neutral' | 'negative' | string;

export interface MemorySentiment {
  label: MemorySentimentLabel;
  score?: number;
}

export interface MemoryIdentityHandle {
  platform: string;
  value: string;
  url?: string;
  verified?: boolean;
}

export interface MemoryWalletProfile {
  archetype?: MemoryArchetype;
  traits: MemoryTrait[];
  sentiment?: MemorySentiment;
  handles: MemoryIdentityHandle[];
  raw?: unknown;
}

export class MemoryServiceError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'MemoryServiceError';
    this.status = status;
  }
}

function buildEndpoint(template: string, identifier: string): string {
  const encoded = encodeURIComponent(identifier);
  if (template.includes(':identifier')) {
    return template.replace(':identifier', encoded);
  }
  const normalized = template.endsWith('/') ? template.slice(0, -1) : template;
  return `${normalized}/${encoded}`;
}

function getMemoryConfig() {
  const apiKey = process.env.MEMORY_API_KEY || SERVER_ENV.MEMORY_API_KEY;
  const baseUrl = process.env.MEMORY_API_BASE_URL || DEFAULT_BASE_URL;
  const personalityPath = process.env.MEMORY_PERSONALITY_PATH || DEFAULT_PERSONALITY_PATH;
  const identityPath = process.env.MEMORY_IDENTITY_PATH || DEFAULT_IDENTITY_PATH;
  return { apiKey, baseUrl, personalityPath, identityPath };
}

function normalizeArchetype(payload: any): MemoryArchetype | undefined {
  if (!payload) return undefined;
  if (typeof payload === 'string') {
    return { id: payload, label: payload };
  }
  const id = payload.id || payload.key || payload.slug || payload.type;
  const label = payload.label || payload.name || id;
  if (!id && !label) return undefined;
  return {
    id: id ?? label,
    label: label ?? id ?? 'Unknown',
    confidence: typeof payload.confidence === 'number' ? payload.confidence : payload.probability,
    description: payload.description || payload.summary,
  };
}

function normalizeTraits(payload: any): MemoryTrait[] {
  if (!Array.isArray(payload)) return [];
  return payload
    .map((trait) => {
      if (!trait) return null;
      if (typeof trait === 'string') {
        return { id: trait, label: trait } satisfies MemoryTrait;
      }
      const id = trait.id || trait.key || trait.slug || trait.tag;
      const label = trait.label || trait.name || trait.display || id;
      if (!id && !label) return null;
      return {
        id: id ?? label,
        label: label ?? id ?? 'Unknown',
        score: typeof trait.score === 'number' ? trait.score : trait.weight,
        category: trait.category || trait.group,
      } satisfies MemoryTrait;
    })
    .filter((trait): trait is MemoryTrait => Boolean(trait));
}

function normalizeSentiment(payload: any): MemorySentiment | undefined {
  if (!payload) return undefined;
  if (typeof payload === 'string') {
    return { label: payload };
  }
  const label = payload.label || payload.sentiment || payload.state;
  const score = typeof payload.score === 'number' ? payload.score : payload.value;
  if (!label && typeof score !== 'number') return undefined;
  return { label: label ?? 'neutral', score };
}

function normalizeHandles(payload: any): MemoryIdentityHandle[] {
  if (!Array.isArray(payload)) return [];
  return payload
    .flatMap((entry) => {
      if (!entry) return [];
      const platformRaw = entry.platform ?? entry.type ?? entry.source?.platform ?? entry.platform_name;
      const platformValue = typeof platformRaw === 'string'
        ? platformRaw
        : platformRaw?.id ?? platformRaw?.name ?? platformRaw?.type ?? platformRaw;
      const valueRaw = entry.handle
        ?? entry.username
        ?? entry.name
        ?? entry.value
        ?? entry.id
        ?? entry.address
        ?? entry.href;
      if (!platformValue || !valueRaw) return [];
      return [{
        platform: platformValue.toString(),
        value: valueRaw.toString(),
        url: entry.url || entry.link,
        verified: Boolean(entry.verified || entry.is_verified || entry.isVerified),
      } satisfies MemoryIdentityHandle];
    });
}

export function deriveHandlesFromRaw(raw: unknown): MemoryIdentityHandle[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return normalizeHandles(raw);
  }
  if (typeof raw === 'object') {
    const handles = (raw as any).handles || (raw as any).identities;
    if (Array.isArray(handles)) {
      return normalizeHandles(handles);
    }
  }
  return [];
}

function normalizeWalletProfile(payload: any): MemoryWalletProfile {
  if (Array.isArray(payload)) {
    const handles = normalizeHandles(payload);
    return {
      archetype: undefined,
      traits: [],
      sentiment: undefined,
      handles,
      raw: payload,
    } satisfies MemoryWalletProfile;
  }

  if (!payload || typeof payload !== 'object') {
    return { traits: [], handles: [], raw: payload };
  }

  // attempt to locate personality-related payloads in different shapes
  const archetypeSource = payload.archetype || payload.primary_archetype || payload.personality?.archetype || payload.profile?.archetype;
  const traitSource = payload.traits || payload.tags || payload.personality?.traits || payload.profile?.traits;
  const sentimentSource = payload.sentiment || payload.personality?.sentiment || payload.tone;
  const handlesSource = payload.identities || payload.handles || payload.profile?.identities;
  const normalizedHandles = normalizeHandles(handlesSource);
  const derivedHandles = normalizedHandles.length > 0 ? normalizedHandles : deriveHandlesFromRaw(payload.raw ?? payload);

  return {
    archetype: normalizeArchetype(archetypeSource),
    traits: normalizeTraits(traitSource),
    sentiment: normalizeSentiment(sentimentSource),
    handles: derivedHandles,
    raw: payload,
  } satisfies MemoryWalletProfile;
}

async function performMemoryRequest(endpoint: string, apiKey: string, signal?: AbortSignal) {
  const res = await fetch(endpoint, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    signal,
  });

  if (res.status === 204) {
    return null;
  }

  if (!res.ok) {
    const message = await res.text().catch(() => res.statusText || 'Memory request failed');
    throw new MemoryServiceError(message || 'Memory request failed', res.status);
  }

  return res.json();
}

export async function fetchMemoryWalletProfile(
  identifier: string,
  options?: { signal?: AbortSignal },
): Promise<MemoryWalletProfile | null> {
  const { apiKey, baseUrl, personalityPath, identityPath } = getMemoryConfig();

  if (!apiKey) {
    console.warn('[Memory] Missing MEMORY_API_KEY; returning null');
    return null;
  }

  const searchPath = buildEndpoint(personalityPath, identifier);
  const personalityUrl = new URL(searchPath, baseUrl).toString();

  try {
    const payload = await performMemoryRequest(personalityUrl, apiKey, options?.signal);
    if (!payload) return null;
    return normalizeWalletProfile(payload);
  } catch (error) {
    if (error instanceof MemoryServiceError) {
      if (error.status === 404) {
        // Fallback to identity endpoint to at least retrieve handles
        try {
          const identityPathBuilt = buildEndpoint(identityPath, identifier);
          const identityUrl = new URL(identityPathBuilt, baseUrl).toString();
          const identityPayload = await performMemoryRequest(identityUrl, apiKey, options?.signal);
          if (!identityPayload) return null;
          return normalizeWalletProfile(identityPayload);
        } catch (fallbackError) {
          if (fallbackError instanceof MemoryServiceError && fallbackError.status === 404) {
            return null;
          }
          throw fallbackError;
        }
      }
    }
    throw error;
  }
}

export interface MemoryTwitterPostsResult {
  status: string;
  timestamp?: string | null;
  posts: any[];
  profile?: any;
}

export async function fetchMemoryTwitterPosts(
  username: string,
  options?: { limit?: number; signal?: AbortSignal },
): Promise<MemoryTwitterPostsResult | null> {
  const { apiKey, baseUrl } = getMemoryConfig();

  if (!apiKey) {
    console.warn('[Memory] Missing MEMORY_API_KEY; skipping twitter posts fetch');
    return null;
  }

  if (!username) {
    return null;
  }

  const limit = Math.min(Math.max(options?.limit ?? 6, 1), 100);
  const endpoint = new URL('/twitter/posts', baseUrl);
  endpoint.searchParams.set('username', username);
  endpoint.searchParams.set('limit', String(limit));

  const response = await fetch(endpoint.toString(), {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    signal: options?.signal,
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    const message = await response.text().catch(() => response.statusText || 'Memory twitter posts request failed');
    const normalizedMessage = (message || '').toString();

    // Treat common recoverable errors (queued jobs, invalid identifiers, rate limits) as soft failures.
    const isRecoverable =
      response.status === 429 ||
      (response.status >= 400 && response.status < 500) ||
      normalizedMessage.toLowerCase().includes('custom ids cannot be integers');

    if (isRecoverable) {
      console.warn('[Memory] twitter posts fetch returned recoverable error', {
        username,
        status: response.status,
        message: normalizedMessage,
      });
      return null;
    }

    throw new MemoryServiceError(normalizedMessage || 'Memory twitter posts request failed', response.status);
  }

  const json = await response.json();

  return {
    status: json?.status ?? 'unknown',
    timestamp: json?.timestamp ?? null,
    posts: json?.data?.posts ?? [],
    profile: json?.data?.profile ?? null,
  };
}

