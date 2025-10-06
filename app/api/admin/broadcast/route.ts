import { NextRequest, NextResponse } from 'next/server';
import { validateAdminKey, logAdminAction } from '@/lib/auth-utils';
import {
  createBroadcast,
  getActiveBroadcasts,
  updateBroadcast,
  deleteBroadcast,
  getBroadcastStats,
} from '@/lib/broadcast-service';

/**
 * GET /api/admin/broadcast - List all active broadcasts
 */
export async function GET(req: NextRequest) {
  // Validate admin access
  if (!validateAdminKey(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const [messages, stats] = await Promise.all([
      getActiveBroadcasts(),
      getBroadcastStats(),
    ]);

    await logAdminAction('broadcast_list', 'system', { count: messages.length });

    return NextResponse.json({
      success: true,
      messages,
      stats,
    });
  } catch (error) {
    console.error('Admin broadcast GET error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch broadcasts' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/broadcast - Create a new broadcast
 */
export async function POST(req: NextRequest) {
  // Validate admin access
  if (!validateAdminKey(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const {
      content,
      title,
      expiresIn,
      priority = 'normal',
      type = 'info',
      targeting = 'all',
      action,
      dismissible = true,
    } = body;

    // Validation
    if (!content || content.trim().length === 0) {
      return NextResponse.json(
        { error: 'Content is required' },
        { status: 400 }
      );
    }

    if (content.length > 500) {
      return NextResponse.json(
        { error: 'Content too long (max 500 characters)' },
        { status: 400 }
      );
    }

    const result = await createBroadcast({
      content,
      title,
      expiresIn,
      priority,
      type,
      targeting,
      action,
      dismissible,
      createdBy: 'admin', // Could be extracted from admin key if needed
    });

    if (result.success) {
      await logAdminAction('broadcast_create', 'system', {
        messageId: result.message?.id,
        targeting,
        priority,
        type,
      });

      return NextResponse.json({
        success: true,
        message: result.message,
      });
    } else {
      return NextResponse.json(
        { error: result.error || 'Failed to create broadcast' },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error('Admin broadcast POST error:', error);
    return NextResponse.json(
      { error: 'Failed to create broadcast' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/admin/broadcast - Update an existing broadcast
 */
export async function PUT(req: NextRequest) {
  // Validate admin access
  if (!validateAdminKey(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { id, ...updates } = body;

    if (!id) {
      return NextResponse.json(
        { error: 'Message ID is required' },
        { status: 400 }
      );
    }

    const result = await updateBroadcast(id, updates);

    if (result.success) {
      await logAdminAction('broadcast_update', 'system', {
        messageId: id,
        updates: Object.keys(updates),
      });

      return NextResponse.json({
        success: true,
        message: result.message,
      });
    } else {
      return NextResponse.json(
        { error: result.error || 'Failed to update broadcast' },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error('Admin broadcast PUT error:', error);
    return NextResponse.json(
      { error: 'Failed to update broadcast' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/admin/broadcast - Delete a broadcast
 */
export async function DELETE(req: NextRequest) {
  // Validate admin access
  if (!validateAdminKey(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { error: 'Message ID is required' },
        { status: 400 }
      );
    }

    const result = await deleteBroadcast(id);

    if (result.success) {
      await logAdminAction('broadcast_delete', 'system', { messageId: id });

      return NextResponse.json({ success: true });
    } else {
      return NextResponse.json(
        { error: result.error || 'Failed to delete broadcast' },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error('Admin broadcast DELETE error:', error);
    return NextResponse.json(
      { error: 'Failed to delete broadcast' },
      { status: 500 }
    );
  }
}

