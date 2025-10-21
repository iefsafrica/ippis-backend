import { NextResponse } from 'next/server'

export async function GET() {
  return NextResponse.json({
    message: 'IPPIS HR Backend API',
    status: 'running',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    note: 'All endpoints are active and ready for database integration'
  })
}
