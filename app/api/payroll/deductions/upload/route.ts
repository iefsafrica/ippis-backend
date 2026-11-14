import { NextRequest } from "next/server";
import { GET as getHandler, POST as postHandler, OPTIONS as optionsHandler } from "../import/route";
import { requirePermission } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export async function OPTIONS(req: NextRequest) {
  return optionsHandler(req);
}

export async function GET(req: NextRequest) {
  const auth = await requirePermission(req, "payroll.cycles.view");
  if (!auth.ok) return auth.response;
  return getHandler(req);
}

export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "payroll.cycles.prepare");
  if (!auth.ok) return auth.response;
  return postHandler(req);
}

