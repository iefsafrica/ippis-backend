import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import nodemailer from "nodemailer";

// Reusable Neon client
const sql = neon(process.env.DATABASE_URL!);

// Configure nodemailer transporter for Gmail
const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 587,
  secure: false, // TLS
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// Send welcome email with registration instructions
async function sendWelcomeEmail(email: string, name: string) {
  const registrationLink = "https://ippishr.vercel.app/register";

  try {
    await transporter.sendMail({
      from: `"HR Admin" <${process.env.SMTP_USER}>`,
      to: email,
      subject: "Welcome to the IPPIS! Complete Your Registration",
      text: `
Hi ${name},

Welcome to the team! We're excited to have you join us.

To complete your registration, please verify your NIN and upload the relevant documents by following the link below:

${registrationLink}

If you have any questions, feel free to reach out.

Best regards,
HR Team
      `,
      html: `
        <p>Hi <strong>${name}</strong>,</p>
        <p>Welcome to the IPPIS! We're excited to have you join us.</p>
        <p>To complete your registration, please:</p>
        <ul>
          <li>Verify your <strong>NIN</strong></li>
          <li>Upload the relevant documents</li>
        </ul>
        <p>Please click the link below to continue your registration:</p>
        <p><a href="${registrationLink}" target="_blank" style="color: #1a73e8;">Complete Your Registration</a></p>
        <p>If you have any questions, feel free to reach out.</p>
        <p>Best regards,<br>HR Team</p>
      `,
    });
    console.log(` Email sent to ${email}`);
  } catch (error) {
    console.error(" Email sending failed:", error);
  }
}

// Utility: Check if table exists
async function tableExists(tableName: string): Promise<boolean> {
  try {
    const result = await sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public'
        AND table_name = ${tableName}
      );
    `;
    return result[0]?.exists;
  } catch (error) {
    console.error(`Error checking table ${tableName}:`, error);
    return false;
  }
}

// Ensure employees table exists
async function ensureEmployeesTable(): Promise<boolean> {
  try {
    const exists = await tableExists("employees");

    if (!exists) {
      await sql`
        CREATE TABLE employees (
          id VARCHAR(20) PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          email VARCHAR(255) UNIQUE NOT NULL,
          department VARCHAR(100) NOT NULL,
          position VARCHAR(100) NOT NULL,
          status VARCHAR(20) NOT NULL DEFAULT 'active',
          join_date DATE NOT NULL DEFAULT CURRENT_DATE,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
      `;
      console.log(" Created employees table");
    }

    return true;
  } catch (error) {
    console.error("Error ensuring employees table:", error);
    return false;
  }
}

// Ensure registration_history table exists
async function ensureHistoryTable(): Promise<void> {
  const exists = await tableExists("registration_history");

  if (!exists) {
    await sql`
      CREATE TABLE registration_history (
        id SERIAL PRIMARY KEY,
        registration_id VARCHAR(20) NOT NULL,
        action VARCHAR(50) NOT NULL,
        details TEXT,
        performed_by VARCHAR(100),
        performed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `;
    console.log(" Created registration_history table");
  }
}

// Helper: Generate unique employee ID like EMP00001
async function generateUniqueEmployeeId(): Promise<string> {
  const result = await sql`
    SELECT MAX(CAST(SUBSTRING(id FROM 4) AS INTEGER)) AS max_num
    FROM employees
    WHERE id LIKE 'EMP%';
  `;

  const maxNum = result[0]?.max_num || 0;
  const newNum = maxNum + 1;
  return `EMP${newNum.toString().padStart(5, '0')}`; // e.g. EMP00001
}

// POST /api/admin/employees — Add Employee
export async function POST(request: Request) {
  try {
    const tableReady = await ensureEmployeesTable();
    if (!tableReady) {
      return NextResponse.json({ error: "Database not ready." }, { status: 500 });
    }

    const data = await request.json();
    const { name, email, department, position, status = "active" } = data;

    if (!name || !email || !department || !position) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const id = await generateUniqueEmployeeId();

    const result = await sql`
      INSERT INTO employees (
        id, name, email, department, position, status, join_date
      )
      VALUES (
        ${id}, ${name}, ${email}, ${department}, ${position}, ${status}, CURRENT_DATE
      )
      RETURNING id, name, email, department, position, status, join_date;
    `;

    // Send welcome email after adding employee
    await sendWelcomeEmail(email, name);

    return NextResponse.json({ success: true, data: result[0] });

  } catch (error) {
    console.error("Add employee error:", error);
    return NextResponse.json(
      {
        error: "Failed to add employee",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

// GET /api/admin/employees — List Employees
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const search = searchParams.get("search") || "";
    const status = searchParams.get("status") || "active";
    const department = searchParams.get("department") || "all";
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "10");
    const offset = (page - 1) * limit;

    const conditions: string[] = ["status != 'deleted'"];
    const params: any[] = [];

    if (search) {
      conditions.push(`(name ILIKE $${params.length + 1} OR email ILIKE $${params.length + 1} OR id ILIKE $${params.length + 1})`);
      params.push(`%${search}%`);
    }

    if (status !== "all") {
      conditions.push(`status = $${params.length + 1}`);
      params.push(status);
    }

    if (department !== "all") {
      conditions.push(`department = $${params.length + 1}`);
      params.push(department);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const employeesQuery = `
      SELECT id, name, email, department, position, status, join_date
      FROM employees
      ${whereClause}
      ORDER BY join_date DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2};
    `;
    params.push(limit, offset);
    const employees = await sql.query(employeesQuery, params);

    const countQuery = `
      SELECT COUNT(*)::int AS total
      FROM employees
      ${whereClause};
    `;
    const countParams = params.slice(0, -2);
    const countResult = await sql.query(countQuery, countParams);
    const total = countResult[0]?.total || 0;
    const totalPages = Math.ceil(total / limit);

    return NextResponse.json({
      success: true,
      data: {
        employees,
        pagination: {
          page,
          limit,
          total,
          totalPages,
        },
      },
    });

  } catch (error) {
    console.error("Employees list error:", error);
    return NextResponse.json(
      { error: "Failed to fetch employees", details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

// PATCH /api/admin/employees/:id — Update Status
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const { status } = await request.json();
    const { id } = params;

    await sql`
      UPDATE employees
      SET status = ${status}, updated_at = CURRENT_TIMESTAMP
      WHERE id = ${id};
    `;

    return NextResponse.json({ success: true, message: `Employee status updated to ${status}` });
  } catch (error) {
    console.error("Update status error:", error);
    return NextResponse.json({ error: "Failed to update status" }, { status: 500 });
  }
}

// DELETE /api/admin/employees/:id — Soft Delete
export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  try {
    const { id } = params;

    await sql`
      UPDATE employees
      SET status = 'deleted', updated_at = CURRENT_TIMESTAMP
      WHERE id = ${id};
    `;

    return NextResponse.json({ success: true, message: "Employee deleted" });
  } catch (error) {
    console.error("Delete employee error:", error);
    return NextResponse.json({ error: "Failed to delete employee" }, { status: 500 });
  }
}
