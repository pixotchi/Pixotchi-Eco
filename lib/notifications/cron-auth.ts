import type { NextRequest } from 'next/server';

export function verifyVercelCron(req: Pick<NextRequest, 'headers'>): boolean {
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET?.trim();

  if (!cronSecret) {
    return process.env.NODE_ENV !== 'production';
  }

  return authHeader === `Bearer ${cronSecret}`;
}
