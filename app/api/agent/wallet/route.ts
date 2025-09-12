import { NextRequest, NextResponse } from 'next/server';
import { CdpClient } from '@coinbase/cdp-sdk';

// Create a single CDP client instance per runtime
let cdp: CdpClient | null = null;
function getClient() {
  if (!cdp) {
    cdp = new CdpClient({
      apiKeyName: process.env.CDP_API_KEY_ID,
      privateKey: process.env.CDP_API_KEY_SECRET,
      wallet: { seed: process.env.CDP_WALLET_SECRET },
    } as any);
  }
  return cdp;
}

// In-memory cache of the agent smart account address
let agentSmartAddress: string | null = null;

export async function POST(_req: NextRequest) {
  try {
    const client = getClient();
    // Ensure an EOA exists for the agent
    const account = await client.evm.getOrCreateAccount({ name: 'pixotchi-agent' });
    // Ensure a smart account exists (needed for paymaster + spend permissions usage)
    // IMPORTANT: Spend permissions must be enabled at the time of creation per CDP docs
    const smart = await client.evm.getOrCreateSmartAccount({
      name: 'pixotchi-agent-sa-sp',
      owner: account,
      enableSpendPermissions: true,
    });
    agentSmartAddress = smart.address;
    return NextResponse.json({ success: true, smartAccountAddress: smart.address, accountAddress: account.address });
  } catch (e: any) {
    console.error('Agent wallet POST error', e?.message || e);
    return NextResponse.json({ success: false, error: e?.message || 'Failed to init agent wallet' }, { status: 500 });
  }
}

export async function GET() {
  try {
    if (agentSmartAddress) return NextResponse.json({ success: true, smartAccountAddress: agentSmartAddress });
    const client = getClient();
    const owner = await client.evm.getOrCreateAccount({ name: 'pixotchi-agent' });
    const smart = await client.evm.getOrCreateSmartAccount({
      name: 'pixotchi-agent-sa-sp',
      owner,
      enableSpendPermissions: true,
    });
    agentSmartAddress = smart.address;
    return NextResponse.json({ success: true, smartAccountAddress: smart.address });
  } catch (e: any) {
    console.error('Agent wallet GET error', e?.message || e);
    return NextResponse.json({ success: false, error: e?.message || 'Failed to fetch agent wallet' }, { status: 500 });
  }
}


