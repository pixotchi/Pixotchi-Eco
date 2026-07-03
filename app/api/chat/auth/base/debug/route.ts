import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const DIAGNOSTIC_LOGGING_ENABLED = process.env.BASE_AUTH_DEBUG_LOGS_ENABLED === 'true';
const DIAGNOSTIC_FIELD_LIMIT = 500;
const DIAGNOSTIC_ARRAY_LIMIT = 12;
const DIAGNOSTIC_OBJECT_KEY_LIMIT = 20;
const ALLOWED_DIAGNOSTIC_FIELDS = new Set([
  'baseConnectorId',
  'connectorId',
  'connectorName',
  'errorCode',
  'fallbackPayloadSummary',
  'legacyConnectorId',
  'message',
  'normalizedAddress',
  'payloadSource',
  'payloadSummary',
  'providerFlags',
  'reason',
  'resultAccountSummary',
  'resultKeys',
  'retry',
  'stage',
  'surface',
]);

function isSameOriginDiagnosticRequest(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  if (!origin || !host) {
    return false;
  }

  try {
    return new URL(origin).host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}

async function getDiagnosticsGateResponse(request: NextRequest): Promise<NextResponse | null> {
  if (process.env.NODE_ENV !== 'production') {
    return null;
  }

  if (!DIAGNOSTIC_LOGGING_ENABLED) {
    return NextResponse.json(
      { disabled: true, ok: true },
      {
        headers: {
          'Cache-Control': 'private, no-store',
        },
      },
    );
  }

  if (!isSameOriginDiagnosticRequest(request)) {
    return NextResponse.json(
      { ok: false },
      {
        headers: {
          'Cache-Control': 'private, no-store',
        },
        status: 403,
      },
    );
  }

  return null;
}

function sanitizeDiagnosticValue(value: UntypedValue, depth: number = 0): UntypedValue {
  if (typeof value === 'string') {
    return value.slice(0, DIAGNOSTIC_FIELD_LIMIT);
  }

  if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return value;
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, DIAGNOSTIC_ARRAY_LIMIT)
      .map((entry) => sanitizeDiagnosticValue(entry, depth + 1));
  }

  if (value && typeof value === 'object' && depth < 2) {
    const sanitized: Record<string, UntypedValue> = {};
    Object.entries(value as Record<string, UntypedValue>)
      .slice(0, DIAGNOSTIC_OBJECT_KEY_LIMIT)
      .forEach(([key, entry]) => {
        sanitized[key.slice(0, 80)] = sanitizeDiagnosticValue(entry, depth + 1);
      });
    return sanitized;
  }

  return typeof value;
}

function sanitizeDiagnosticBody(body: UntypedValue): Record<string, UntypedValue> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return {};
  }

  const sanitized: Record<string, UntypedValue> = {};
  Object.entries(body as Record<string, UntypedValue>).forEach(([key, value]) => {
    if (ALLOWED_DIAGNOSTIC_FIELDS.has(key)) {
      sanitized[key] = sanitizeDiagnosticValue(value);
    }
  });

  return sanitized;
}

export async function POST(request: NextRequest) {
  const diagnosticsGateResponse = await getDiagnosticsGateResponse(request);
  if (diagnosticsGateResponse) {
    return diagnosticsGateResponse;
  }

  try {
    const body = await request.json();

    console.warn('[chat-auth] Base client diagnostic:', {
      host: request.headers.get('host'),
      origin: request.headers.get('origin'),
      secFetchSite: request.headers.get('sec-fetch-site'),
      userAgent: request.headers.get('user-agent')?.slice(0, 240) ?? null,
      ...sanitizeDiagnosticBody(body),
    });

    return NextResponse.json(
      { ok: true },
      {
        headers: {
          'Cache-Control': 'private, no-store',
        },
      },
    );
  } catch {
    return NextResponse.json(
      { ok: false },
      {
        headers: {
          'Cache-Control': 'private, no-store',
        },
        status: 400,
      },
    );
  }
}
