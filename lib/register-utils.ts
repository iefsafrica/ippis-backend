import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL!);

export { sql as registrationSql };

export async function generateRegistrationId(): Promise<string> {
  let nextIdNum = 1;

  while (true) {
    const candidate = `IPPIS-${String(nextIdNum).padStart(4, "0")}`;
    const existing = await sql`
      SELECT 1 FROM registrations WHERE registration_id = ${candidate}
    `;

    if (!existing || existing.length === 0) {
      return candidate;
    }

    nextIdNum++;
  }
}
