import { NextRequest } from "next/server";
import { withCors, handleOptions } from "../../../../lib/cors"; 

// ✅ Handle CORS preflight requests
export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// ✅ GET request handler
export async function GET(req: NextRequest) {
  return withCors(req, {
    endpoint: '/admin/employees',
    method: 'GET',
    status: 'active',
    message: 'IPPIS HR API',
    timestamp: new Date().toISOString()
  });
}

// ✅ POST request handler
export async function POST(req: NextRequest) {
  return withCors(req, {
    endpoint: '/admin/employees',
    method: 'POST',
    status: 'active',
    message: 'IPPIS HR API',
    timestamp: new Date().toISOString()
  });
}

// ✅ PUT request handler
export async function PUT(req: NextRequest) {
  return withCors(req, {
    endpoint: '/admin/employees',
    method: 'PUT',
    status: 'active',
    message: 'IPPIS HR API',
    timestamp: new Date().toISOString()
  });
}

// ✅ DELETE request handler
export async function DELETE(req: NextRequest) {
  return withCors(req, {
    endpoint: '/admin/employees',
    method: 'DELETE',
    status: 'active',
    message: 'IPPIS HR API',
    timestamp: new Date().toISOString()
  });
}
