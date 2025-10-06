import { NextRequest, NextResponse } from 'next/server';
import { 
  getAllWallets, 
  getWalletStats, 
  searchWallets,
  getWalletDetails 
} from '@/lib/wallet-tracking-service';
import { validateAdminKey } from '@/lib/auth-utils';

/**
 * GET /api/admin/wallets - Get all tracked wallets with stats
 */
export async function GET(req: NextRequest) {
  // Validate admin access
  if (!validateAdminKey(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const action = searchParams.get('action');
    const address = searchParams.get('address');
    const search = searchParams.get('search');
    const limit = parseInt(searchParams.get('limit') || '100');
    const offset = parseInt(searchParams.get('offset') || '0');
    const sortBy = searchParams.get('sortBy') as 'firstSeen' | 'lastSeen' | 'connectionCount' || 'firstSeen';
    const sortOrder = searchParams.get('sortOrder') as 'asc' | 'desc' || 'desc';

    // Handle different actions
    if (action === 'stats') {
      const stats = await getWalletStats();
      return NextResponse.json({ success: true, stats });
    }

    if (action === 'details' && address) {
      const wallet = await getWalletDetails(address);
      if (!wallet) {
        return NextResponse.json(
          { error: 'Wallet not found' },
          { status: 404 }
        );
      }
      return NextResponse.json({ success: true, wallet });
    }

    if (action === 'search' && search) {
      const wallets = await searchWallets(search);
      return NextResponse.json({ 
        success: true, 
        wallets,
        count: wallets.length 
      });
    }

    // Default: list all wallets with pagination
    const wallets = await getAllWallets({
      limit,
      offset,
      sortBy,
      sortOrder,
    });

    const stats = await getWalletStats();

    return NextResponse.json({
      success: true,
      wallets,
      stats,
      pagination: {
        limit,
        offset,
        count: wallets.length,
        total: stats.totalWallets,
      },
    });
  } catch (error) {
    console.error('Get wallets error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch wallets' },
      { status: 500 }
    );
  }
}

