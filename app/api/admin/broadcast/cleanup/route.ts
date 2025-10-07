import { NextRequest, NextResponse } from 'next/server';
import { validateAdminKey, logAdminAction } from '@/lib/auth-utils';
import { cleanupOrphanedDismissals, nukeAllBroadcastData } from '@/lib/broadcast-service';

/**
 * POST /api/admin/broadcast/cleanup - Clean up orphaned dismissal records
 */
export async function POST(req: NextRequest) {
  // Validate admin access
  if (!validateAdminKey(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await cleanupOrphanedDismissals();

    if (result.success) {
      await logAdminAction('broadcast_cleanup_orphans', 'system', {
        cleanedRecords: result.cleaned,
      });

      return NextResponse.json({
        success: true,
        cleaned: result.cleaned,
        message: `Cleaned up ${result.cleaned} orphaned dismissal records`,
      });
    } else {
      return NextResponse.json(
        { error: result.error || 'Cleanup failed' },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('Broadcast cleanup error:', error);
    return NextResponse.json(
      { error: 'Cleanup operation failed' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/admin/broadcast/cleanup - NUKE all broadcast data
 * Query param: ?confirm=true (required for safety)
 */
export async function DELETE(req: NextRequest) {
  // Validate admin access
  if (!validateAdminKey(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const confirm = searchParams.get('confirm');

    // Safety check - require explicit confirmation
    if (confirm !== 'true') {
      return NextResponse.json(
        { 
          error: 'Confirmation required',
          message: 'Add ?confirm=true to the request to proceed with data deletion' 
        },
        { status: 400 }
      );
    }

    const result = await nukeAllBroadcastData();

    if (result.success) {
      await logAdminAction('broadcast_nuke_all', 'system', {
        deletedKeys: result.deletedKeys,
      });

      return NextResponse.json({
        success: true,
        deletedKeys: result.deletedKeys,
        message: `🧹 Successfully deleted ${result.deletedKeys} broadcast-related keys`,
      });
    } else {
      return NextResponse.json(
        { error: result.error || 'Nuke operation failed' },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('Broadcast nuke error:', error);
    return NextResponse.json(
      { error: 'Nuke operation failed' },
      { status: 500 }
    );
  }
}

