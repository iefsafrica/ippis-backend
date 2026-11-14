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
  const authResult = await authenticate(req);
  if (!authResult.ok) return withCors(req, { success: false, error: "Unauthorized" }, 401);
  return handleMarkAll(req, authResult.ctx.user.id);
}

export async function PATCH(req: NextRequest) {
  const authResult = await authenticate(req);
  if (!authResult.ok) return withCors(req, { success: false, error: "Unauthorized" }, 401);
  return handleMarkAll(req, authResult.ctx.user.id);
}

export async function PUT(req: NextRequest) {
  const authResult = await authenticate(req);
  if (!authResult.ok) return withCors(req, { success: false, error: "Unauthorized" }, 401);
  return handleMarkAll(req, authResult.ctx.user.id);
}

async function handleMarkAll(req: NextRequest, userId: number) {
  try {
    await sql`
      UPDATE dashboard_notifications
      SET is_read = true
      WHERE is_read = false
        AND (recipient_id IS NULL OR recipient_id = ${userId})
    `;

    return withCors(req, {
      success: true,
      message: "All notifications marked as read",
    });
  } catch (err: any) {
    console.error("POST /api/admin/notifications/read error:", err);
    return withCors(
      req,
      { success: false, error: err?.message || "Failed to mark all as read" },
      500
    );
  }
}
