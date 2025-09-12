import { NextRequest, NextResponse } from 'next/server';
import { getStakeComposite } from '@/lib/contracts';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const address = searchParams.get('address');

    if (!address) {
      return NextResponse.json(
        { success: false, error: 'Address parameter is required' },
        { status: 400 }
      );
    }

    // Validate address format
    if (!address.startsWith('0x') || address.length !== 42) {
      return NextResponse.json(
        { success: false, error: 'Invalid address format' },
        { status: 400 }
      );
    }

    console.log('🔍 Fetching staking info for:', address);

    const stakingData = await getStakeComposite(address);

    // Convert bigint values to strings for JSON serialization
    const responseData = {
      success: true,
      stake: stakingData.stake ? {
        staked: stakingData.stake.staked.toString(),
        rewards: stakingData.stake.rewards.toString()
      } : null,
      approved: stakingData.approved
    };

    return NextResponse.json(responseData);

  } catch (error) {
    console.error('❌ Error fetching staking info:', error);
    
    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to fetch staking info',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
