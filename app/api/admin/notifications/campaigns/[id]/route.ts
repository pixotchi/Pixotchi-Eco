import { NextRequest, NextResponse } from 'next/server';
import { validateAdminKey, createErrorResponse } from '@/lib/auth-utils';
import { getCampaignMeta, getCampaignProgress, getCampaignResults } from '@/lib/notifications/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = {
  params: Promise<{ id: string }>;
};

export async function GET(request: NextRequest, context: Params) {
  if (!validateAdminKey(request)) {
    return NextResponse.json(createErrorResponse('Unauthorized', 401, 'UNAUTHORIZED').body, { status: 401 });
  }

  try {
    const { id } = await context.params;
    const campaign = await getCampaignMeta(id);
    if (!campaign) {
      return NextResponse.json(createErrorResponse('Campaign not found', 404).body, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      campaign,
      progress: await getCampaignProgress(id),
      result: await getCampaignResults(id),
    });
  } catch (error) {
    return NextResponse.json(
      createErrorResponse(error instanceof Error ? error.message : 'Failed to fetch campaign', 500).body,
      { status: 500 },
    );
  }
}
