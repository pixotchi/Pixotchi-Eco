import { NextRequest, NextResponse } from 'next/server';
import { getStrainInfo } from '@/lib/contracts';
import { parseUnits } from 'viem';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const mintsPerDay = parseInt(searchParams.get('mintsPerDay') || '10');
    const strainId = parseInt(searchParams.get('strainId') || '1');
    
    // Get strain information to calculate costs
    const strains = await getStrainInfo();
    const strain = strains.find(s => s.id === strainId) || strains[0];
    
    if (!strain) {
      return NextResponse.json({ error: 'Strain not found' }, { status: 404 });
    }

    // Calculate recommended allowance
    const unitPrice = strain.mintPrice || 0;
    const dailyMintCost = unitPrice * mintsPerDay;
    
    // Add 20% buffer for safety
    const recommendedAllowance = Math.ceil(dailyMintCost * 1.2);
    
    // Parse to proper units (18 decimals for SEED)
    const allowanceInWei = parseUnits(recommendedAllowance.toString(), 18);

    return NextResponse.json({
      success: true,
      strain: {
        id: strain.id,
        name: strain.name,
        unitPrice: unitPrice,
      },
      calculations: {
        mintsPerDay,
        unitPrice,
        dailyMintCost,
        bufferPercentage: 20,
        recommendedAllowance,
      },
      allowanceInWei: allowanceInWei.toString(),
      allowanceFormatted: recommendedAllowance.toString(),
      recommendation: {
        message: `For ${mintsPerDay} mints per day of ${strain.name}, we recommend ${recommendedAllowance} SEED allowance (includes 20% buffer).`,
        conservative: Math.ceil(dailyMintCost * 1.5), // 50% buffer
        aggressive: Math.ceil(dailyMintCost * 1.1),   // 10% buffer
      }
    });

  } catch (error: any) {
    console.error('Allowance suggestion error:', error);
    return NextResponse.json({ 
      error: error.message || 'Failed to calculate allowance suggestion' 
    }, { status: 500 });
  }
}
