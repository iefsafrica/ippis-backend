import { neon } from "@neondatabase/serverless";
import { minutesBetween } from "@/lib/employee-time";

const sql = neon(process.env.DATABASE_URL!);

// Used when no office shift applies to the employee's department
export const DEFAULT_SHIFT = { name: "Standard hours", start: "08:00:00", end: "16:00:00", lateAfter: "09:00:00" };

export type Shift = { name: string; start: string; end: string; lateAfter: string; isDefault: boolean };

/** The active shift for a department: an exact match first, then one for everyone. */
export async function shiftFor(department: string | null): Promise<Shift> {
  try {
    const rows = await sql`
      SELECT shift_name, start_time::text AS start_time, end_time::text AS end_time, late_mark_time::text AS late_mark_time,
             department
      FROM office_shifts
      WHERE LOWER(COALESCE(status, 'active')) IN ('active', 'enabled')
        AND (department IS NULL OR department = '' OR LOWER(department) IN (LOWER(${department ?? ""}), 'all'))
      ORDER BY (LOWER(COALESCE(department, '')) = LOWER(${department ?? ""})) DESC, shift_name
      LIMIT 1
    `;
    const s = rows[0];
    if (s?.start_time && s?.end_time) {
      const start = String(s.start_time).slice(0, 8);
      return {
        name: String(s.shift_name),
        start,
        end: String(s.end_time).slice(0, 8),
        lateAfter: String(s.late_mark_time || s.start_time).slice(0, 8),
        isDefault: false,
      };
    }
  } catch (error) {
    console.error("SHIFT LOOKUP:", error);
  }
  return { ...DEFAULT_SHIFT, isDefault: true };
}

export function shiftMinutes(shift: Shift) {
  return minutesBetween(shift.start, shift.end) || 480;
}

/** "late" when clocked in after the shift's late mark, otherwise "present". */
export function arrivalStatus(clockIn: string, shift: Shift) {
  return clockIn > shift.lateAfter ? "late" : "present";
}
