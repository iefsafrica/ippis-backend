import { neon } from "@neondatabase/serverless";
import { NextRequest } from "next/server";
import { withCors, handleOptions } from "@/lib/cors";
import { authenticate, can } from "@/lib/rbac";
import { OUT_OF_SCOPE } from "@/lib/mda-scope";
import { SECTIONS, reaches, buildOverview, buildSummary, unlinkedEmployees, type Section } from "@/lib/mda-overview";

export const dynamic = "force-dynamic";

const sql = neon(process.env.DATABASE_URL!);

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// GET                 every MDA the caller is responsible for, with headline numbers
// GET ?mda_id=<id>    one MDA's overview: workforce, onboarding, requests, documents,
//                     attendance, leave, payroll, movements and access
// Each part needs the permission that governs those records (see lib/mda-overview.ts)
// and counts only what the caller's scope covers.
export async function GET(req: NextRequest) {
  try {
    const auth = await authenticate(req);
    if (!auth.ok) return auth.response;
    const ctx = auth.ctx;

    const sections = (Object.keys(SECTIONS) as Section[]).filter((s) => can(ctx, SECTIONS[s]));
    if (sections.length === 0) {
      return withCors(req, { success: false, error: "You do not have permission to view MDA overviews" }, 403);
    }

    const [mdas, departments] = await Promise.all([
      sql`SELECT id, name, company_code, status FROM companies ORDER BY name`,
      sql`SELECT id, company_id FROM departments`,
    ]);
    const departmentsOf = (mda: number) => departments.filter((d: any) => Number(d.company_id) === mda).map((d: any) => Number(d.id));
    const reachable = mdas.filter((m: any) =>
      sections.some((s) => reaches(ctx, SECTIONS[s], Number(m.id), departmentsOf(Number(m.id))))
    );

    const rawId = new URL(req.url).searchParams.get("mda_id") ?? new URL(req.url).searchParams.get("company_id");
    if (rawId !== null && rawId !== "") {
      const mdaId = Number(rawId);
      const mda = Number.isInteger(mdaId) ? reachable.find((m: any) => Number(m.id) === mdaId) : undefined;
      if (!mda) return withCors(req, { success: false, error: OUT_OF_SCOPE }, 404);

      const overview = await buildOverview(ctx, mdaId, departmentsOf(mdaId));
      return withCors(req, {
        success: true,
        data: {
          mda: { id: Number(mda.id), name: mda.name, code: mda.company_code, status: mda.status },
          generated_at: new Date().toISOString(),
          ...overview,
        },
      });
    }

    const summary = await buildSummary(ctx, reachable.map((m: any) => Number(m.id)));
    return withCors(req, {
      success: true,
      data: {
        mdas: reachable.map((m: any) => ({
          id: Number(m.id),
          name: m.name,
          code: m.company_code,
          status: m.status,
          ...summary.get(Number(m.id)),
        })),
        // Employees not yet linked to any MDA (only for those with rights across all MDAs)
        unlinked_employees: await unlinkedEmployees(ctx),
        sections,
      },
    });
  } catch (error) {
    console.error("MDA OVERVIEW ERROR:", error);
    return withCors(req, { success: false, error: "Failed to build the MDA overview" }, 500);
  }
}
