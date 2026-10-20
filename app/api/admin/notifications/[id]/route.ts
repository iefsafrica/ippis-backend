import { neon } from "@neondatabase/serverless";
import { NextRequest } from "next/server";
import { withCors, handleOptions } from "@/lib/cors";

export const dynamic = "force-dynamic";

const sql = neon(process.env.DATABASE_URL!);

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const resolvedParams = await params;
    const numId = parseInt(resolvedParams.id, 10);
    if (isNaN(numId)) {
      return withCors(req, { success: false, error: "Invalid notification ID" }, 400);
    }

    const body = await req.json().catch(() => ({}));
    const read = body.read !== undefined ? Boolean(body.read) : true;

    await sql`
      UPDATE dashboard_notifications
      SET is_read = ${read}
      WHERE id = ${numId}
    `;

    return withCors(req, {
      success: true,
      message: `Notification ${numId} marked as ${read ? "read" : "unread"}`,
    });
  } catch (err) {
    console.error("PATCH /api/admin/notifications/[id] error:", err);
    return withCors(req, { success: false, error: err.message || "Failed to update notification" }, 500);
  }
}

export async function PUT(
  req: NextRequest,
  context: { params: Promise<{ id: string }> | { id: string } }
) {
  return PATCH(req, context);
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const resolvedParams = await params;
    const numId = parseInt(resolvedParams.id, 10);
    if (isNaN(numId)) {
      return withCors(req, { success: false, error: "Invalid notification ID" }, 400);
    }

    await sql`
      DELETE FROM dashboard_notifications
      WHERE id = ${numId}
    `;

    return withCors(req, {
      success: true,
      message: `Notification ${numId} deleted`,
    });
  } catch (err) {
    console.error("DELETE /api/admin/notifications/[id] error:", err);
    return withCors(req, { success: false, error: err.message || "Failed to delete notification" }, 500);
  }
}
