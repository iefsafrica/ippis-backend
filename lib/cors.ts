import { NextResponse, NextRequest } from "next/server";


const allowedOrigins = [
  "http://localhost:3000",                   
  "https://ippis-frontend.vercel.app",      
];

// ✅ Generate CORS headers dynamically
function getCorsHeaders(origin?: string) {
  return {
    "Access-Control-Allow-Origin": origin || "",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, PATCH, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Credentials": "true",
  };
}

// ✅ Handle normal JSON response with CORS
export function withCors(req: NextRequest, json: any, status = 200) {
  const origin = req.headers.get("origin") || "";
  const allowed = allowedOrigins.includes(origin) ? origin : "";
  return NextResponse.json(json, {
    status,
    headers: getCorsHeaders(allowed),
  });
}

// ✅ Handle preflight OPTIONS request
export function handleOptions(req: NextRequest) {
  const origin = req.headers.get("origin") || "";
  const allowed = allowedOrigins.includes(origin) ? origin : "";
  return new NextResponse(null, {
    status: 204,
    headers: getCorsHeaders(allowed),
  });
}
