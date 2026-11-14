import { neon } from "@neondatabase/serverless";
import { NextRequest } from "next/server";
import { withCors, handleOptions } from "@/lib/cors";
import { authenticate } from "@/lib/rbac";

export const dynamic = "force-dynamic";

const sql = neon(process.env.DATABASE_URL!);

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

export async function GET(req: NextRequest) {
  try {
    const authResult = await authenticate(req);
    const userId = authResult.ok ? authResult.ctx.user.id : null;

    const { searchParams } = new URL(req.url);
    const limitParam = parseInt(searchParams.get("limit") || "20", 10);
    const limit = Math.min(Math.max(limitParam, 1), 100);
    const unreadOnly = searchParams.get("unread") === "true";

    // Determine MDA scoping if user is authenticated
    const isGlobal =
      !authResult.ok ||
      authResult.ctx.grants.some((g: any) => g.level === "global") ||
      authResult.ctx.grants.length === 0;

    const companyIds: number[] = authResult.ok
      ? authResult.ctx.grants
          .map((g: any) => g.companyId)
          .filter((c: any): c is number => c !== null && Number.isInteger(c))
      : [];

    let rows: any[] = [];
    let countRows: any[] = [];

    if (userId) {
      if (isGlobal || companyIds.length === 0) {
        rows = await sql`
          SELECT id, title, message, type, is_read, recipient_id, mda_id, created_at, expires_at, action_url
          FROM dashboard_notifications
          WHERE (recipient_id IS NULL OR recipient_id = ${userId})
            AND (expires_at IS NULL OR expires_at > NOW())
            ${unreadOnly ? sql`AND is_read = false` : sql``}
          ORDER BY created_at DESC
          LIMIT ${limit}
        `;

        countRows = await sql`
          SELECT count(*)::int as unread_count
          FROM dashboard_notifications
          WHERE is_read = false
            AND (recipient_id IS NULL OR recipient_id = ${userId})
            AND (expires_at IS NULL OR expires_at > NOW())
        `;
      } else {
        rows = await sql`
          SELECT id, title, message, type, is_read, recipient_id, mda_id, created_at, expires_at, action_url
          FROM dashboard_notifications
          WHERE (recipient_id IS NULL OR recipient_id = ${userId})
            AND (mda_id IS NULL OR mda_id = ANY(${companyIds}))
            AND (expires_at IS NULL OR expires_at > NOW())
            ${unreadOnly ? sql`AND is_read = false` : sql``}
          ORDER BY created_at DESC
          LIMIT ${limit}
        `;

        countRows = await sql`
          SELECT count(*)::int as unread_count
          FROM dashboard_notifications
          WHERE is_read = false
            AND (recipient_id IS NULL OR recipient_id = ${userId})
            AND (mda_id IS NULL OR mda_id = ANY(${companyIds}))
            AND (expires_at IS NULL OR expires_at > NOW())
        `;
      }
    } else {
      rows = await sql`
        SELECT id, title, message, type, is_read, recipient_id, mda_id, created_at, expires_at, action_url
        FROM dashboard_notifications
        WHERE (expires_at IS NULL OR expires_at > NOW())
          ${unreadOnly ? sql`AND is_read = false` : sql``}
        ORDER BY created_at DESC
        LIMIT ${limit}
      `;

      countRows = await sql`
        SELECT count(*)::int as unread_count
        FROM dashboard_notifications
        WHERE is_read = false
          AND (expires_at IS NULL OR expires_at > NOW())
      `;
    }

    const unreadCount = (countRows[0] as any)?.unread_count ?? 0;

    const notifications = rows.map((r: any) => ({
      id: String(r.id),
      title: r.title,
      message: r.message,
      type: r.type || "info",
      read: Boolean(r.is_read),
      is_read: Boolean(r.is_read),
      createdAt: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString(),
      created_at: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString(),
      recipientId: r.recipient_id,
      recipient_id: r.recipient_id,
      mdaId: r.mda_id,
      mda_id: r.mda_id,
      expiresAt: r.expires_at,
      actionUrl: r.action_url,
      action_url: r.action_url,
    }));

    return withCors(req, {
      success: true,
      unreadCount,
      notifications,
      total: notifications.length,
    });
  } catch (err: any) {
    console.error("GET /api/admin/notifications error:", err);
    return withCors(req, { success: false, error: err?.message || "Failed to fetch notifications" }, 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const authResult = await authenticate(req);
    if (!authResult.ok) {
      return withCors(req, { success: false, error: "Unauthorized" }, 401);
    }
    const body = (await req.json().catch(() => ({}))) as any;

    // Check if this is a markAll call posted to /api/admin/notifications
    if (body.markAll) {
      const userId = authResult.ctx.user.id;
      await sql`
        UPDATE dashboard_notifications
        SET is_read = true
        WHERE is_read = false
          AND (recipient_id IS NULL OR recipient_id = ${userId})
      `;
      return withCors(req, { success: true, message: "All notifications marked as read" });
    }

    const {
      title,
      message,
      type = "info",
      recipient_id = null,
      mda_id = null,
      action_url = null,
      actionUrl = null,
      expires_at = null,
    } = body;

    const finalActionUrl = actionUrl || action_url;

    if (!title || !message) {
      return withCors(req, { success: false, error: "Title and message are required" }, 400);
    }

    const inserted = await sql`
      INSERT INTO dashboard_notifications (title, message, type, recipient_id, mda_id, action_url, expires_at)
      VALUES (${title}, ${message}, ${type}, ${recipient_id}, ${mda_id}, ${finalActionUrl}, ${expires_at})
      RETURNING id, title, message, type, is_read, recipient_id, mda_id, created_at, action_url
    `;

    const r = inserted[0] as any;
    if (!r) {
      return withCors(req, { success: false, error: "Failed to create notification" }, 500);
    }
    const notification = {
      id: String(r.id),
      title: r.title,
      message: r.message,
      type: r.type,
      read: Boolean(r.is_read),
      is_read: Boolean(r.is_read),
      createdAt: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString(),
      created_at: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString(),
      recipientId: r.recipient_id,
      mdaId: r.mda_id,
      actionUrl: r.action_url,
    };

    return withCors(req, { success: true, notification }, 201);
  } catch (err: any) {
    console.error("POST /api/admin/notifications error:", err);
    return withCors(req, { success: false, error: err?.message || "Failed to create notification" }, 500);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const authResult = await authenticate(req);
    if (!authResult.ok) {
      return withCors(req, { success: false, error: "Unauthorized" }, 401);
    }
    const body = (await req.json().catch(() => ({}))) as any;
    const { id, markAll, read = true } = body;
    const userId = authResult.ctx.user.id;

    if (markAll) {
      await sql`
        UPDATE dashboard_notifications
        SET is_read = true
        WHERE is_read = false
          AND (recipient_id IS NULL OR recipient_id = ${userId})
      `;
      return withCors(req, { success: true, message: "All notifications marked as read" });
    }

    if (id) {
      const cleanId = String(id).replace(/^notif_/, "");
      const numId = parseInt(cleanId, 10);
      if (isNaN(numId)) {
        return withCors(req, { success: false, error: "Invalid notification ID" }, 400);
      }
      await sql`
        UPDATE dashboard_notifications
        SET is_read = ${Boolean(read)}
        WHERE id = ${numId}
      `;
      return withCors(req, { success: true, message: `Notification ${id} updated` });
    }

    return withCors(req, { success: false, error: "Missing notification id or markAll parameter" }, 400);
  } catch (err: any) {
    console.error("PATCH /api/admin/notifications error:", err);
    return withCors(req, { success: false, error: err?.message || "Failed to update notifications" }, 500);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const authResult = await authenticate(req);
    if (!authResult.ok) {
      return withCors(req, { success: false, error: "Unauthorized" }, 401);
    }
    const { searchParams } = new URL(req.url);
    const idParam = searchParams.get("id");
    if (!idParam) {
      return withCors(req, { success: false, error: "Missing id parameter" }, 400);
    }
    const cleanId = idParam.replace(/^notif_/, "");
    const numId = parseInt(cleanId, 10);
    if (isNaN(numId)) {
      return withCors(req, { success: false, error: "Invalid id parameter" }, 400);
    }

    await sql`
      DELETE FROM dashboard_notifications
      WHERE id = ${numId}
    `;

    return withCors(req, { success: true, message: `Notification ${idParam} deleted` });
  } catch (err: any) {
    console.error("DELETE /api/admin/notifications error:", err);
    return withCors(req, { success: false, error: err?.message || "Failed to delete notification" }, 500);
  }
}
