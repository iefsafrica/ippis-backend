import { neon } from "@neondatabase/serverless";
import { sendEmployeeNotificationEmail } from "@lib/email";
import { todayLagos, addDays } from "@/lib/employee-time";

const sql = neon(process.env.DATABASE_URL!);

/**
 * Employee notifications. Sending never throws: a failed notification is
 * logged and the action that caused it still succeeds.
 */

export const CATEGORIES = [
  "leave", "attendance", "payroll", "task", "document", "announcement", "training", "profile", "system",
] as const;
export type Category = (typeof CATEGORIES)[number];

// System messages cannot be switched off in the app
export const ALWAYS_IN_APP: Category[] = ["system"];

export type Notice = {
  title: string;
  message: string;
  link?: string | null;
  /** Reminders pass a key so the same reminder is created only once. */
  dedupeKey?: string | null;
};

export async function notify(employeeId: string, category: Category, notice: Notice) {
  try {
    const prefs = await sql`
      SELECT in_app, email FROM employee_notification_preferences
      WHERE employee_id = ${employeeId} AND category = ${category}
    `;
    const inApp = ALWAYS_IN_APP.includes(category) || (prefs[0]?.in_app ?? true);
    const byEmail = prefs[0]?.email ?? false;

    let created = false;
    if (inApp) {
      const rows = await sql`
        INSERT INTO employee_notifications (employee_id, category, title, message, link, dedupe_key)
        VALUES (${employeeId}, ${category}, ${notice.title}, ${notice.message}, ${notice.link ?? null}, ${notice.dedupeKey ?? null})
        ON CONFLICT (employee_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
        RETURNING id
      `;
      created = rows.length > 0;
    }

    // A reminder that already existed is not emailed again
    if (byEmail && (created || !notice.dedupeKey)) {
      const emp = await sql`SELECT email, name FROM employees WHERE id = ${employeeId}`;
      if (emp[0]?.email) {
        await sendEmployeeNotificationEmail(String(emp[0].email), String(emp[0].name), notice.title, notice.message);
      }
    }
  } catch (error) {
    console.error(`NOTIFY ${employeeId} (${category}) failed:`, error);
  }
}

/** Runs one reminder check; a missing table or bad row skips that check only. */
async function guarded(name: string, run: () => Promise<void>) {
  try {
    await run();
  } catch (error) {
    console.error(`REMINDERS ${name}:`, error);
  }
}

/**
 * Creates reminders that depend on dates: tasks due soon or overdue, documents
 * expiring, open document requests and upcoming training. Called when the
 * employee opens their notifications or dashboard, so no scheduler is needed.
 */
export async function syncReminders(employeeId: string) {
  const today = todayLagos();

  await guarded("tasks", async () => {
    const tasks = await sql`
      SELECT id, name, due_date::date::text AS due
      FROM tasks
      WHERE assigned_to = ${employeeId}
        AND LOWER(COALESCE(status, '')) NOT IN ('completed', 'done', 'cancelled')
        AND due_date IS NOT NULL
        AND due_date::date <= ${addDays(today, 2)}::date
    `;
    for (const t of tasks) {
      const overdue = String(t.due) < today;
      await notify(employeeId, "task", {
        title: overdue ? "Task overdue" : "Task due soon",
        message: overdue ? `"${t.name}" was due on ${t.due}.` : `"${t.name}" is due on ${t.due}.`,
        link: `/employee/tasks/${t.id}`,
        dedupeKey: `task-${overdue ? "overdue" : "due"}:${t.id}:${t.due}`,
      });
    }
  });

  await guarded("documents", async () => {
    const docs = await sql`
      SELECT id, title, expires_at::text AS expires
      FROM employee_documents
      WHERE employee_id = ${employeeId}
        AND expires_at IS NOT NULL
        AND expires_at <= ${addDays(today, 30)}::date
        AND status IN ('issued', 'verified')
    `;
    for (const d of docs) {
      const expired = String(d.expires) < today;
      await notify(employeeId, "document", {
        title: expired ? "Document expired" : "Document expiring soon",
        message: expired ? `"${d.title}" expired on ${d.expires}. Upload a current copy.` : `"${d.title}" expires on ${d.expires}.`,
        link: "/employee/documents",
        dedupeKey: `doc-${expired ? "expired" : "expiring"}:${d.id}`,
      });
    }

    const requests = await sql`
      SELECT id, title, due_date::text AS due
      FROM document_requests
      WHERE employee_id = ${employeeId} AND status = 'open'
    `;
    for (const r of requests) {
      const late = r.due && String(r.due) < today;
      await notify(employeeId, "document", {
        title: late ? "Requested document is overdue" : "Document requested",
        message: r.due ? `HR needs "${r.title}" by ${r.due}.` : `HR needs "${r.title}".`,
        link: "/employee/documents",
        dedupeKey: `doc-request${late ? "-late" : ""}:${r.id}`,
      });
    }
  });

  await guarded("training", async () => {
    const trainings = await sql`
      SELECT t.id, t.training_title, t.start_date::date::text AS start
      FROM training_enrollments en
      JOIN training_programs t ON t.id = en.training_id
      WHERE en.employee_id = ${employeeId}
        AND en.status = 'enrolled'
        AND t.start_date::date BETWEEN ${today}::date AND ${addDays(today, 3)}::date
    `;
    for (const t of trainings) {
      await notify(employeeId, "training", {
        title: "Training starts soon",
        message: `"${t.training_title}" starts on ${t.start}.`,
        link: "/employee/trainings",
        dedupeKey: `training:${t.id}:${t.start}`,
      });
    }
  });
}

/** Unread notifications and unread announcements, for badges. */
export async function unreadCounts(employeeId: string) {
  const rows = await sql`
    SELECT COUNT(*)::int AS n FROM employee_notifications WHERE employee_id = ${employeeId} AND NOT is_read
  `;
  let announcements = 0;
  try {
    const a = await sql`
      SELECT COUNT(*)::int AS n
      FROM announcements a
      WHERE LOWER(COALESCE(a.status, '')) = 'published'
        AND LOWER(COALESCE(a.audience, 'all')) IN ('all', 'employees', 'employee', 'staff', 'all staff')
        AND (a.publish_date IS NULL OR a.publish_date <= NOW())
        AND (a.expiry_date IS NULL OR a.expiry_date >= NOW())
        AND NOT EXISTS (SELECT 1 FROM announcement_reads r WHERE r.announcement_id = a.id AND r.employee_id = ${employeeId})
    `;
    announcements = a[0]?.n ?? 0;
  } catch (error) {
    console.error("UNREAD ANNOUNCEMENTS:", error);
  }
  return { notifications: rows[0]?.n ?? 0, announcements };
}

/**
 * The same kind of notification for many employees in one statement, e.g.
 * payslips for a whole payroll run. Respects in-app preferences; emails go
 * only to employees who asked for them.
 */
export async function notifyMany(category: Category, items: ({ employeeId: string } & Notice)[]) {
  if (items.length === 0) return;
  try {
    const rows = JSON.stringify(
      items.map((i) => ({ employee_id: i.employeeId, title: i.title, message: i.message, link: i.link ?? null, dedupe_key: i.dedupeKey ?? null }))
    );
    await sql`
      INSERT INTO employee_notifications (employee_id, category, title, message, link, dedupe_key)
      SELECT x.employee_id, ${category}, x.title, x.message, x.link, x.dedupe_key
      FROM jsonb_to_recordset(${rows}::jsonb) AS x(employee_id text, title text, message text, link text, dedupe_key text)
      JOIN employees e ON e.id = x.employee_id
      WHERE NOT EXISTS (
        SELECT 1 FROM employee_notification_preferences p
        WHERE p.employee_id = x.employee_id AND p.category = ${category} AND NOT p.in_app
      )
      ON CONFLICT (employee_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
    `;

    const wantEmail = await sql`
      SELECT p.employee_id, e.email, e.name
      FROM employee_notification_preferences p JOIN employees e ON e.id = p.employee_id
      WHERE p.category = ${category} AND p.email AND p.employee_id = ANY(${items.map((i) => i.employeeId)})
    `;
    for (const w of wantEmail) {
      const item = items.find((i) => i.employeeId === w.employee_id);
      if (item && w.email) await sendEmployeeNotificationEmail(String(w.email), String(w.name), item.title, item.message);
    }
  } catch (error) {
    console.error(`NOTIFY MANY (${category}) failed:`, error);
  }
}
