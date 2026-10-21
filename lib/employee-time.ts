/**
 * Dates and times for the employee portal, in Nigerian time. Dates travel as
 * "YYYY-MM-DD" strings and times as "HH:MM:SS", which work whether the
 * database column is DATE/TIME or text.
 */

export const TIME_ZONE = "Africa/Lagos";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Today's date in Lagos. */
export function todayLagos(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** The current time in Lagos, HH:MM:SS. */
export function nowTimeLagos(now = new Date()): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).format(now);
}

/** True for a real calendar date written as YYYY-MM-DD. */
export function isDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Accepts HH:MM or HH:MM:SS and returns HH:MM:SS, or null when invalid. */
export function normaliseTime(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const m = value.trim().match(/^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/);
  return m ? `${m[1]}:${m[2]}:${m[3] ?? "00"}` : null;
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 1 = Monday ... 7 = Sunday */
export function isoWeekday(date: string): number {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

export function mondayOf(date: string): string {
  return addDays(date, 1 - isoWeekday(date));
}

/** Every date from `from` to `to`, inclusive. */
export function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 1000; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Minutes between two HH:MM:SS times on the same day (0 when either is missing or out of order). */
export function minutesBetween(start: string | null, end: string | null): number {
  if (!start || !end) return 0;
  const toMin = (t: string) => {
    const [h = 0, m = 0, s = 0] = t.split(":").map(Number);
    return h * 60 + m + s / 60;
  };
  return Math.max(0, toMin(end) - toMin(start));
}

/** A database DATE/TIMESTAMP or text value as YYYY-MM-DD (select it with ::text to avoid time zone shifts). */
export function dateText(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value);
  return DATE.test(text.slice(0, 10)) ? text.slice(0, 10) : null;
}
