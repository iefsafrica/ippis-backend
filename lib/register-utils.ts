import { neon } from "@neondatabase/serverless";
import { buildRegistrationIdVariants, canonicalizeRegistrationId } from "./registration-id";

const sql = neon(process.env.DATABASE_URL!);

export { sql as registrationSql };

export async function generateRegistrationId(): Promise<string> {
  let nextIdNum = 1;

  while (true) {
    const candidate = canonicalizeRegistrationId(`IPPIS-${String(nextIdNum).padStart(4, "0")}`);
    let existing: unknown[] = [];
    for (const variant of buildRegistrationIdVariants(candidate)) {
      existing = await sql`
        SELECT 1 FROM registrations WHERE registration_id = ${variant}
        LIMIT 1
      `;
      if (existing.length > 0) break;
    }

    if (!existing || existing.length === 0) {
      return candidate;
    }

    nextIdNum++;
  }
}
