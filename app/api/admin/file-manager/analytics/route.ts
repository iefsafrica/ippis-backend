import { NextRequest } from "next/server";
import { GET as getAnalytics, OPTIONS as optionsAnalytics } from "@/app/api/file-manager/analytics/route";
import { requirePermission } from "@/lib/rbac";

export const dynamic = "force-dynamic";

export async function OPTIONS(req: NextRequest) {
  return optionsAnalytics(req);
}

export async function GET(req: NextRequest) {
  const auth = await requirePermission(req, "files.records.view");
  if (!auth.ok) return auth.response;
  return getAnalytics(req);
}

