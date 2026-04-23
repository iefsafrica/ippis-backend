import { NextResponse } from 'next/server'
import { prisma } from '../../../lib/prisma'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  const email = searchParams.get('email')

  if (!id && !email) {
    return NextResponse.json({ error: 'IPPIS Number or Email is required' }, { status: 400 })
  }

  try {
    const orConditions: any[] = []
    if (id) orConditions.push({ id })
    if (email) orConditions.push({ email })

    if (orConditions.length === 0) {
       return NextResponse.json({ error: 'Invalid search criteria' }, { status: 400 })
    }

    // 1. Search in employees (Approved)
    let record = await prisma.employees.findFirst({
      where: {
        OR: orConditions
      }
    })

    if (record) {
      return NextResponse.json({
        success: true,
        type: 'employee',
        status: record.status,
        data: record
      })
    }

    // 2. Search in pending_employees (Pending)
    const pendingOrConditions: any[] = []
    if (id) pendingOrConditions.push({ registration_id: id })
    if (email) pendingOrConditions.push({ email })

    let pendingRecord = await prisma.pending_employees.findFirst({
      where: {
        OR: pendingOrConditions
      }
    })

    if (pendingRecord) {
      return NextResponse.json({
        success: true,
        type: 'pending_employee',
        status: pendingRecord.status,
        data: pendingRecord
      })
    }

    return NextResponse.json({ error: 'Application not found' }, { status: 404 })
  } catch (error: any) {
    console.error('TRACKING GET ERROR:', error)
    return NextResponse.json({ 
      error: 'Internal Server Error', 
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined 
    }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as any
    const { registrationId, email } = body
    const id = registrationId // IPPIS number or Reg ID

    if (!id && !email) {
      return NextResponse.json({ error: 'IPPIS Number or Email is required' }, { status: 400 })
    }

    const orConditions: any[] = []
    if (id) orConditions.push({ id })
    if (email) orConditions.push({ email })

    if (orConditions.length === 0) {
       return NextResponse.json({ error: 'Invalid search criteria' }, { status: 400 })
    }

    // 1. Search in employees (Approved)
    let record = await prisma.employees.findFirst({
      where: {
        OR: orConditions
      }
    })

    if (record) {
      return NextResponse.json({
        success: true,
        type: 'employee',
        status: record.status,
        data: record
      })
    }

    // 2. Search in pending_employees (Pending)
    const pendingOrConditions: any[] = []
    if (id) pendingOrConditions.push({ registration_id: id })
    if (email) pendingOrConditions.push({ email })

    let pendingRecord = await prisma.pending_employees.findFirst({
      where: {
        OR: pendingOrConditions
      }
    })

    if (pendingRecord) {
      return NextResponse.json({
        success: true,
        type: 'pending_employee',
        status: pendingRecord.status,
        data: pendingRecord
      })
    }

    return NextResponse.json({ error: 'Application not found' }, { status: 404 })
  } catch (error: any) {
    console.error('TRACKING POST ERROR:', error)
    return NextResponse.json({ 
      error: 'Internal Server Error', 
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined 
    }, { status: 500 })
  }
}
