import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_URL || '';
    // Placeholder values; client can override via contracts/constants
    const agentConfigured = Boolean(process.env.CDP_API_KEY_ID && process.env.CDP_API_KEY_SECRET && process.env.CDP_WALLET_SECRET);

    return NextResponse.json({
      success: true,
      agentConfigured,
      // Client can display these to the user in the Spend Permissions panel
      networkId: process.env.NETWORK_ID || 'base',
      // For v1 we don’t expose the agent address here (requires CDP init). We’ll reveal it when wiring CDP on the chat route.
      defaults: {
        dailyLimitSeed: '200',
        periodInDays: 1,
      }
    });
  } catch (e) {
    return NextResponse.json({ success: false, error: 'Failed to load agent config' }, { status: 500 });
  }
}


