import { NextResponse, NextRequest } from "next/server";


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

// ✅ Generate CORS headers dynamically
function getCorsHeaders(origin?: string) {
  // An origin that is not allowed gets the main frontend's origin back, which the
  // browser treats as a mismatch, so other sites cannot read API responses
  const allowOrigin = origin && isOriginAllowed(origin) ? origin : "https://ippis-frontend.vercel.app";
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, PATCH, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-registration-id, Accept",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "86400",
  };
}

// ✅ Handle normal JSON response with CORS
export function withCors(req: NextRequest, json: any, status = 200) {
  const origin = req.headers.get("origin") || "";
  return NextResponse.json(json, {
    status,
    headers: getCorsHeaders(origin),
  });
}

// ✅ Handle preflight OPTIONS request
export function handleOptions(req: NextRequest) {
  const origin = req.headers.get("origin") || "";
  return new NextResponse(null, {
    status: 204,
    headers: getCorsHeaders(origin),
  });
}
