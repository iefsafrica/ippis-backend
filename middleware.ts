import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const allowedOrigins = [
  "http://localhost:3000",
  "https://ippis-frontend.vercel.app",
  "https://staff-management-and-identity-verif.vercel.app",
  "https://nigeria-police-personnel-database.vercel.app",
];

function isOriginAllowed(origin: string | null): boolean {
  if (!origin) return false;
  if (allowedOrigins.includes(origin)) return true;
  if (/^https:\/\/ippis-frontend.*\.vercel\.app$/.test(origin)) return true;
  return false;
}

export function middleware(request: NextRequest) {
  const origin = request.headers.get("origin");
  const originAllowed = isOriginAllowed(origin);
  // Never echo an origin that is not allowed: credentials are allowed, so that would let any site call the API
  const allowOriginValue = originAllowed ? origin! : "https://ippis-frontend.vercel.app";

  // Handle preflight OPTIONS requests across all /api routes
  if (request.method === "OPTIONS") {
    const headers = new Headers();
    headers.set("Access-Control-Allow-Origin", allowOriginValue);
    headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization, x-registration-id, Accept");
    headers.set("Access-Control-Allow-Credentials", "true");
    headers.set("Access-Control-Max-Age", "86400");
    return new NextResponse(null, { status: 204, headers });
  }

  const response = NextResponse.next();

  if (origin) {
    response.headers.set("Access-Control-Allow-Origin", allowOriginValue);
    response.headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    response.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization, x-registration-id, Accept");
    response.headers.set("Access-Control-Allow-Credentials", "true");
  }

  return response;
}

export const config = {
  matcher: ["/api/:path*"],
};
