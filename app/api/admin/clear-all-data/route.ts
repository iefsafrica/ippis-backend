import { NextResponse } from 'next/server'

export async function GET() {
  return NextResponse.json({
    endpoint: '/admin/clear-all-data',
    status: 'active',
    message: 'IPPIS HR API',
    timestamp: new Date().toISOString()
  })
}

export async function POST() {
  return NextResponse.json({
    endpoint: '/admin/clear-all-data',
    status: 'active',
    message: 'IPPIS HR API',
    timestamp: new Date().toISOString()
  })
}

export async function PUT() {
  return NextResponse.json({
    endpoint: '/admin/clear-all-data',
    status: 'active',
    message: 'IPPIS HR API',
    timestamp: new Date().toISOString()
  })
}

export async function DELETE() {
  return NextResponse.json({
    endpoint: '/admin/clear-all-data',
    status: 'active',
    message: 'IPPIS HR API',
    timestamp: new Date().toISOString()
  })
}
