import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);

export type NotificationType =
  | "registration"
  | "document"
  | "system"
  | "payroll"
  | "leave"
  | "approval"
  | "warning"
  | "info";

export interface CreateAdminNotificationParams {
  title: string;
  message: string;
  type?: NotificationType | string;
  actionUrl?: string | null;
  recipientId?: number | null;
  mdaId?: number | null;
  expiresInDays?: number | null;
}

/**
 * Creates an admin dashboard notification.
 * Wrapped in try/catch so notification logging failures never break the primary operation.
 */
export async function createAdminNotification(params: CreateAdminNotificationParams) {
  try {
    const {
      title,
      message,
      type = "info",
      actionUrl = null,
      recipientId = null,
      mdaId = null,
      expiresInDays = 30,
    } = params;

    const expiresAt =
      expiresInDays && expiresInDays > 0
        ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
        : null;

    const res = await sql`
      INSERT INTO dashboard_notifications (
        title,
        message,
        type,
        action_url,
        recipient_id,
        mda_id,
        is_read,
        created_at,
        expires_at
      ) VALUES (
        ${title},
        ${message},
        ${type},
        ${actionUrl},
        ${recipientId},
        ${mdaId},
        false,
        NOW(),
        ${expiresAt}
      )
      RETURNING id, title, message, type, is_read, recipient_id, mda_id, action_url, created_at
    `;

    return {
      success: true,
      data: res[0],
    };
  } catch (err: any) {
    console.error("[createAdminNotification] Failed to create notification:", err);
    return {
      success: false,
      error: err?.message || "Failed to create notification",
    };
  }
}

