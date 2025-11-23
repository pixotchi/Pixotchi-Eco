import { NextRequest, NextResponse } from 'next/server';
import { getStrainInfo } from '@/lib/contracts';
import { formatUnits } from 'viem';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const mintsPerDay = parseInt(searchParams.get('mintsPerDay') || '10');
    const strainId = parseInt(searchParams.get('strainId') || '1');
    
    const strains = await getStrainInfo();
    const strain = strains.find(s => s.id === strainId) || strains[0];

    if (!strain) {
      return NextResponse.json({ error: 'Strain not found' }, { status: 404 });
    }

    const unitPriceWei = strain.mintPriceWei || BigInt(0);
    const decimals = strain.tokenDecimals ?? 18;
    const symbol = strain.tokenSymbol || 'TOKEN';

    const dailyMintCostWei = unitPriceWei * BigInt(Math.max(0, mintsPerDay));
    const bufferPercentage = 20;
    const recommendedAllowanceWei = dailyMintCostWei * BigInt(100 + bufferPercentage) / BigInt(100);

    const conservativeAllowanceWei = dailyMintCostWei * BigInt(150) / BigInt(100);
    const aggressiveAllowanceWei = dailyMintCostWei * BigInt(110) / BigInt(100);

    const unitPriceFormatted = formatUnits(unitPriceWei, decimals);
    const dailyMintCostFormatted = formatUnits(dailyMintCostWei, decimals);
    const allowanceFormatted = formatUnits(recommendedAllowanceWei, decimals);

    return NextResponse.json({
      success: true,
      strain: {
        id: strain.id,
        name: strain.name,
        tokenSymbol: symbol,
        paymentToken: strain.paymentToken,
        unitPriceFormatted,
      },
      calculations: {
        mintsPerDay,
        unitPriceFormatted,
        dailyMintCostFormatted,
        bufferPercentage,
        recommendedAllowanceFormatted: allowanceFormatted,
      },
      allowanceInWei: recommendedAllowanceWei.toString(),
      allowanceFormatted,
      recommendation: {
        message: `For ${mintsPerDay} mints per day of ${strain.name}, we recommend ${allowanceFormatted} ${symbol} allowance (includes ${bufferPercentage}% buffer).`,
        conservative: formatUnits(conservativeAllowanceWei, decimals),
        aggressive: formatUnits(aggressiveAllowanceWei, decimals),
      }
    });

  } catch (error: any) {
    console.error('Allowance suggestion error:', error);
    return NextResponse.json({ 
      error: error.message || 'Failed to calculate allowance suggestion' 
    }, { status: 500 });
  }
}
