import { NextResponse } from 'next/server'

export async function GET() {
  return NextResponse.json({
    status: 'healthy',
    service: 'IPPIS HR Backend',
    timestamp: new Date().toISOString()
  })
}
