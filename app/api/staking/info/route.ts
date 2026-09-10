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

    const stakingData = await getStakeComposite(address);

    // Convert bigint values to strings for JSON serialization
    const responseData = {
      success: true,
      stake: stakingData.stake ? {
        staked: stakingData.stake.staked.toString(),
        rewards: stakingData.stake.rewards.toString()
      } : null,
      allowance: stakingData.allowance?.toString() ?? null,
      approved: stakingData.approved,
      rewardRatio: stakingData.rewardRatio ? {
        numerator: stakingData.rewardRatio.numerator.toString(),
        denominator: stakingData.rewardRatio.denominator.toString()
      } : null,
      timeUnit: stakingData.timeUnit ? stakingData.timeUnit.toString() : null,
      totalStaked: stakingData.totalStaked ? stakingData.totalStaked.toString() : null
    };

    return NextResponse.json(responseData);

  } catch {
    console.error('❌ Error fetching staking info');
    
    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to fetch staking info'
      },
      { status: 500 }
    );
  }
}
