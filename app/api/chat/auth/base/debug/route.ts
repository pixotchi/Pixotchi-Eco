import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    console.warn('[chat-auth] Base client diagnostic:', {
      host: request.headers.get('host'),
      origin: request.headers.get('origin'),
      secFetchSite: request.headers.get('sec-fetch-site'),
      userAgent: request.headers.get('user-agent'),
      ...body,
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
