import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin, createErrorResponse } from '@/lib/auth-utils';
import { sendBaseCampaign } from '@/lib/notifications/campaigns';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const CampaignRequestSchema = z.object({
  title: z.string().trim().min(1).max(30),
  message: z.string().trim().min(1).max(200),
  targetPath: z.string().trim().max(500).optional(),
  audienceMode: z.enum(['all', 'selected']),
  walletAddresses: z.array(z.string()).optional(),
  walletAddressInput: z.string().optional(),
  dryRun: z.boolean().optional(),
});

export async function POST(request: NextRequest) {
  const adminDenied = await requireAdmin(request);
  if (adminDenied) return adminDenied;

  try {
    const body = CampaignRequestSchema.parse(await request.json());
    const result = await sendBaseCampaign(body);

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Send failed';
    const status = message.includes('busy') ? 409 : 400;
    return NextResponse.json(createErrorResponse(message, status).body, { status });
  }
}
