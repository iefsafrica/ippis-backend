import { NextRequest } from "next/server";
import { withCors, handleOptions } from "@/lib/cors";

export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

export async function GET(req: NextRequest) {
  return withCors(req, {
    endpoint: "/accounts/index",
    status: "active",
    message: "IPPIS HR API",
    timestamp: new Date().toISOString(),
  });
}

export async function POST(req: NextRequest) {
  return withCors(req, {
    endpoint: "/accounts/index",
    status: "active",
    message: "IPPIS HR API",
    timestamp: new Date().toISOString(),
  });
}

export async function PUT(req: NextRequest) {
  return withCors(req, {
    endpoint: "/accounts/index",
    status: "active",
    message: "IPPIS HR API",
    timestamp: new Date().toISOString(),
  });
}

export async function DELETE(req: NextRequest) {
  return withCors(req, {
    endpoint: "/accounts/index",
    status: "active",
    message: "IPPIS HR API",
    timestamp: new Date().toISOString(),
  });
}
