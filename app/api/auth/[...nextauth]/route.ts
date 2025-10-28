import { NextResponse } from 'next/server'

const corsHeaders = {
  "Access-Control-Allow-Origin": "http://localhost:3000", // your frontend URL
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Credentials": "true",
}

export async function GET() {
  return NextResponse.json(
    {
      endpoint: '/auth/[...nextauth]',
      status: 'active',
      message: 'IPPIS HR API',
      timestamp: new Date().toISOString(),
    },
    { headers: corsHeaders }
  )
}

export async function POST() {
  return NextResponse.json(
    {
      endpoint: '/auth/[...nextauth]',
      status: 'active',
      message: 'IPPIS HR API',
      timestamp: new Date().toISOString(),
    },
    { headers: corsHeaders }
  )
}

export async function PUT() {
  return NextResponse.json(
    {
      endpoint: '/auth/[...nextauth]',
      status: 'active',
      message: 'IPPIS HR API',
      timestamp: new Date().toISOString(),
    },
    { headers: corsHeaders }
  )
}

export async function DELETE() {
  return NextResponse.json(
    {
      endpoint: '/auth/[...nextauth]',
      status: 'active',
      message: 'IPPIS HR API',
      timestamp: new Date().toISOString(),
    },
    { headers: corsHeaders }
  )
}

// ✅ Important: handle preflight requests
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders,
  })
}
