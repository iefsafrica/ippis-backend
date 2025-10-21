import { NextResponse } from "next/server"

// Make this route dynamic to avoid caching
export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  try {
    // For demo purposes, always return a mock user
    // In a real app, you would verify the token and get the real user
    const mockUser = {
      id: "1",
      name: "Admin User",
      username: "admin",
      email: "admin@example.com",
      role: "admin",
      fullName: "Admin User",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    return NextResponse.json({ user: mockUser })
  } catch (error) {
    console.error("Error fetching current user:", error)

    // Return a mock user even if there's an error
    const mockUser = {
      id: "1",
      name: "Admin User",
      username: "admin",
      email: "admin@example.com",
      role: "admin",
      fullName: "Admin User",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    return NextResponse.json({ user: mockUser })
  }
}
