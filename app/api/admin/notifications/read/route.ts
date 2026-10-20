import { neon } from "@neondatabase/serverless";
import { NextRequest } from "next/server";
import { withCors, handleOptions } from "@/lib/cors";
import { authenticate } from "@/lib/rbac";

export const dynamic = "force-dynamic";

const sql = neon(process.env.DATABASE_URL!);

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

export async function POST(req: NextRequest) {
  return handleMarkAll(req);
}

export async function PATCH(req: NextRequest) {
  return handleMarkAll(req);
}

export async function PUT(req: NextRequest) {
  return handleMarkAll(req);
}

async function handleMarkAll(req: NextRequest) {
  try {
    const authResult = await authenticate(req);
    const userId = authResult.ok ? authResult.ctx.user.id : null;

    if (userId) {
      await sql`
        UPDATE dashboard_notifications
        SET is_read = true
        WHERE is_read = false
          AND (recipient_id IS NULL OR recipient_id = ${userId})
      `;
    } else {
      await sql`
        UPDATE dashboard_notifications
        SET is_read = true
        WHERE is_read = false
      `;
    }

    return withCors(req, {
      success: true,
      message: "All notifications marked as read",
    });
  } catch (err) {
    console.error("POST /api/admin/notifications/read error:", err);
    return withCors(
      req,
      { success: false, error: err.message || "Failed to mark all as read" },
      500
    );
  }
}
