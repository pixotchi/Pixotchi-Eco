import { requireAdmin } from '@/lib/auth-utils';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const adminDenied = await requireAdmin(request);
  if (adminDenied) {
    return adminDenied;
  }

  return NextResponse.json(
    {
      success: true,
    },
    {
      headers: {
        'Cache-Control': 'private, no-store',
      },
    },
  );
}
