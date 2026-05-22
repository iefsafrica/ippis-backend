import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "@/lib/cors";
import { NextRequest } from "next/server";
import crypto from "crypto";

export const dynamic = "force-dynamic";

const db = neon(process.env.DATABASE_URL!);

// ---------------- TYPES ----------------
type Payer = {
  payer_id: string;
  payer_name: string;
  contact_person: string;
  email: string;
  phone: string;
  address: string;
  account_number: string;
  bank_name: string;
  tax_id?: string;
  category: string;
  status?: string;
  notes?: string;
  last_payment?: number;
  last_payment_date?: string;
};

// ---------------- CORS ----------------
export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

//
// ---------------- CREATE ----------------
//
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as Partial<Payer>;

    const {
      payer_name,
      contact_person,
      email,
      phone,
      address,
      account_number,
      bank_name,
      tax_id,
      category,
      status,
      notes
    } = body;

    if (
      !payer_name ||
      !contact_person ||
      !email ||
      !phone ||
      !address ||
      !account_number ||
      !bank_name ||
      !category
    ) {
      return withCors(req, {
        success: false,
        error: "Missing required fields"
      }, 400);
    }

    const payerId = `PYR-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;

    const result = await db`
      INSERT INTO finance_payers (
        payer_id, payer_name, contact_person, email, phone,
        address, account_number, bank_name, tax_id,
        category, status, notes,
        last_payment, last_payment_date,
        created_at, updated_at
      )
      VALUES (
        ${payerId}, ${payer_name}, ${contact_person}, ${email}, ${phone},
        ${address}, ${account_number}, ${bank_name}, ${tax_id ?? null},
        ${category}, ${status ?? "Active"}, ${notes ?? null},
        0, NULL,
        NOW(), NOW()
      )
      RETURNING *
    `;

    return withCors(req, {
      success: true,
      message: "Payer created successfully",
      data: result?.[0] ?? null
    });

  } catch (error) {
    return withCors(req, {
      success: false,
      error: String(error)
    }, 500);
  }
}

//
// ---------------- GET ----------------
//
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    const page = Number(searchParams.get("page") || "1");
    const limit = Number(searchParams.get("limit") || "10");
    const offset = (page - 1) * limit;

    const sortBy = searchParams.get("sortBy") || "created_at";
    const order = searchParams.get("order") === "asc";

    const search = searchParams.get("search");

    // ✅ whitelist
    const validSortFields = {
      payer_name: "payer_name",
      contact_person: "contact_person",
      email: "email",
      category: "category",
      status: "status",
      last_payment: "last_payment",
      last_payment_date: "last_payment_date",
      created_at: "created_at"
    };

    const sortField =
      validSortFields[sortBy as keyof typeof validSortFields] ||
      "created_at";

    const searchCondition = search
      ? db`payer_name ILIKE ${"%" + search + "%"}`
      : db`TRUE`;

    const result = await db`
      SELECT * FROM finance_payers
      WHERE ${searchCondition}
      ORDER BY 
        CASE WHEN ${sortField} = 'payer_name' THEN payer_name END ${order ? db`ASC` : db`DESC`},
        CASE WHEN ${sortField} = 'contact_person' THEN contact_person END ${order ? db`ASC` : db`DESC`},
        CASE WHEN ${sortField} = 'email' THEN email END ${order ? db`ASC` : db`DESC`},
        CASE WHEN ${sortField} = 'category' THEN category END ${order ? db`ASC` : db`DESC`},
        CASE WHEN ${sortField} = 'status' THEN status END ${order ? db`ASC` : db`DESC`},
        CASE WHEN ${sortField} = 'last_payment' THEN last_payment END ${order ? db`ASC` : db`DESC`},
        CASE WHEN ${sortField} = 'last_payment_date' THEN last_payment_date END ${order ? db`ASC` : db`DESC`},
        created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const count = await db`
      SELECT COUNT(*) FROM finance_payers
    `;

    return withCors(req, {
      success: true,
      data: {
        payers: result,
        pagination: {
          total: Number((count as any)?.[0]?.count ?? 0),
          page,
          limit
        }
      }
    });

  } catch (error) {
    return withCors(req, {
      success: false,
      error: String(error)
    }, 500);
  }
}

//
// ---------------- UPDATE ----------------
//
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json() as Partial<Payer>;

    if (!body.payer_id) {
      return withCors(req, {
        success: false,
        error: "payer_id is required"
      }, 400);
    }

    const existing = await db`
      SELECT * FROM finance_payers WHERE payer_id = ${body.payer_id}
    `;

    const e = existing?.[0];

    if (!e) {
      return withCors(req, {
        success: false,
        error: "Payer not found"
      }, 404);
    }

    const updated = await db`
      UPDATE finance_payers SET
        payer_name = ${body.payer_name ?? e.payer_name},
        contact_person = ${body.contact_person ?? e.contact_person},
        email = ${body.email ?? e.email},
        phone = ${body.phone ?? e.phone},
        address = ${body.address ?? e.address},
        account_number = ${body.account_number ?? e.account_number},
        bank_name = ${body.bank_name ?? e.bank_name},
        tax_id = ${body.tax_id ?? e.tax_id},
        category = ${body.category ?? e.category},
        status = ${body.status ?? e.status},
        notes = ${body.notes ?? e.notes},
        updated_at = NOW()
      WHERE payer_id = ${body.payer_id}
      RETURNING *
    `;

    return withCors(req, {
      success: true,
      data: updated?.[0] ?? null
    });

  } catch (error) {
    return withCors(req, {
      success: false,
      error: String(error)
    }, 500);
  }
}

//
// ---------------- DELETE ----------------
//
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const payerId = searchParams.get("payer_id");

    if (!payerId) {
      return withCors(req, {
        success: false,
        error: "payer_id required"
      }, 400);
    }

    await db`
      DELETE FROM finance_payers WHERE payer_id = ${payerId}
    `;

    return withCors(req, {
      success: true
    });

  } catch (error) {
    return withCors(req, {
      success: false,
      error: String(error)
    }, 500);
  }
}