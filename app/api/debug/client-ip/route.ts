import { NextRequest } from "next/server";
import { withCors, handleOptions } from "@/lib/cors";
import { requirePermission } from "@/lib/rbac";
import { clientIp } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// Shows the address headers a request arrives with and the address the
// rate limits and audit log use, to confirm the hosting's behaviour. Send it
// once with a made-up X-Forwarded-For: "resolved" must still be your real IP.
export async function GET(req: NextRequest) {
  const auth = await requirePermission(req, "system.database.manage");
  if (!auth.ok) return auth.response;

  const names = ["cf-connecting-ip", "true-client-ip", "x-real-ip", "x-forwarded-for", "forwarded"];
  const configured = (process.env.CLIENT_IP_HEADER || "cf-connecting-ip").toLowerCase();
  return withCors(req, {
    success: true,
    data: {
      resolved: clientIp(req),
      trusted_header: configured,
      headers: Object.fromEntries([...new Set([...names, configured])].map((n) => [n, req.headers.get(n)])),
    },
  });
}
