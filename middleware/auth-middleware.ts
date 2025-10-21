import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  // Temporary middleware - always allow requests
  return NextResponse.next()
}

export const config = {
  matcher: '/api/:path*',
}
