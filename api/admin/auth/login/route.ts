export async function POST(request: Request) {
  try {
    const { username, password } = await request.json()

    console.log("Login attempt:", username)

    if (!username || !password) {
      console.log("Missing username or password")
      return NextResponse.json(
        { error: "Username and password are required" },
        { status: 400 }
      )
    }

    const result = await pool.query(
      "SELECT * FROM admin_users WHERE username = $1",
      [username]
    )

    const user = result.rows[0]
    console.log("User from DB:", user)

    if (!user) {
      console.log("User not found")
      return NextResponse.json(
        { error: "Invalid username or password" },
        { status: 401 }
      )
    }

    console.log("Comparing password:", password, user.password_hash)

    const passwordMatch = await comparePassword(password, user.password_hash)
    console.log("Password match:", passwordMatch)

    if (!passwordMatch) {
      console.log("Password does not match")
      return NextResponse.json(
        { error: "Invalid username or password" },
        { status: 401 }
      )
    }

    if (!["admin", "viewer"].includes(user.role)) {
      console.log("Role not allowed:", user.role)
      return NextResponse.json(
        { error: "Unauthorized role" },
        { status: 403 }
      )
    }

    // JWT & login logic...
    const token = jwt.sign(
      {
        id: user.id,
        username: user.username,
        role: user.role,
      },
      JWT_SECRET,
      { expiresIn: "8h" }
    )

    await pool.query(
      "UPDATE admin_users SET last_login = CURRENT_TIMESTAMP WHERE id = $1",
      [user.id]
    )

    try {
      await pool.query(
        "INSERT INTO activities (user_id, action_type, description) VALUES ($1, $2, $3)",
        [user.id, "LOGIN", "Admin user logged in"]
      )
    } catch (activityError) {
      console.warn("Activity logging failed:", activityError.message)
    }

    return NextResponse.json({
      success: true,
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        email: user.email,
      },
    })
  } catch (error: any) {
    console.error("Login error:", error.message || error)
    return NextResponse.json(
      { error: "An error occurred during login" },
      { status: 500 }
    )
  }
}
