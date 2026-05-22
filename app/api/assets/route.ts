import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "@/lib/cors";
import { NextRequest } from "next/server";
import crypto from "crypto";

export const dynamic = "force-dynamic";

const db = neon(process.env.DATABASE_URL!);

// ---------------- TYPES ----------------
type Asset = {
  asset_id: string;
  asset_name: string;
  category_id: string;
  serial_number?: string;
  status?: string;
  location?: string;
  assigned_to?: string;
  notes?: string;
  purchase_date?: string;
  purchase_cost?: number;
  vendor_name?: string;
  warranty_expiry?: string;
};

// ---------------- CORS ----------------
export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// ---------------- CREATE ----------------
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as Partial<Asset>;

    if (!body.asset_name || !body.category_id) {
      return withCors(req, { success: false, error: "asset_name and category_id are required" }, 400);
    }

    const assetId = `AST-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;

    // ✅ Verify Category Exists
    const category = await db`SELECT category_id FROM asset_categories WHERE category_id = ${body.category_id}`;
    if (!category?.[0]) {
      return withCors(req, { success: false, error: "Invalid category_id. Please create the category first." }, 400);
    }

    const result = await db`
      INSERT INTO assets (
        asset_id, asset_name, category_id, serial_number, status,
        location, assigned_to, notes,
        purchase_date, purchase_cost, vendor_name, warranty_expiry,
        created_at, updated_at
      )
      VALUES (
        ${assetId}, ${body.asset_name}, ${body.category_id}, ${body.serial_number ?? null}, 
        ${body.status ?? 'Available'}, ${body.location ?? null}, ${body.assigned_to ?? null}, 
        ${body.notes ?? null}, ${body.purchase_date ?? null}, ${body.purchase_cost ?? 0},
        ${body.vendor_name ?? null}, ${body.warranty_expiry ?? null},
        NOW(), NOW()
      )
      RETURNING *
    `;

    return withCors(req, {
      success: true,
      data: result?.[0] ?? null
    });

  } catch (error: any) {
    console.error("CREATE ASSET ERROR:", error);
    return withCors(req, { success: false, error: error.message }, 500);
  }
}

// ---------------- READ ----------------
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const assetId = searchParams.get("asset_id");

    if (assetId) {
      const single = await db`
        SELECT a.*, c.category_name 
        FROM assets a
        LEFT JOIN asset_categories c ON a.category_id = c.category_id
        WHERE a.asset_id = ${assetId}
      `;
      if (!single?.[0]) return withCors(req, { success: false, error: "Not found" }, 404);
      return withCors(req, { success: true, data: single[0] });
    }

    const page = Number(searchParams.get("page") || "1");
    const limit = Number(searchParams.get("limit") || "10");
    const offset = (page - 1) * limit;

    const results = await db`
      SELECT a.*, c.category_name 
      FROM assets a
      LEFT JOIN asset_categories c ON a.category_id = c.category_id
      ORDER BY a.created_at DESC 
      LIMIT ${limit} OFFSET ${offset}
    `;

    const count = await db`SELECT COUNT(*) FROM assets`;

    return withCors(req, {
      success: true,
      data: {
        assets: results,
        pagination: {
          total: Number(count?.[0]?.count ?? 0),
          page,
          limit
        }
      }
    });

  } catch (error: any) {
    console.error("GET ASSETS ERROR:", error);
    return withCors(req, { success: false, error: error.message }, 500);
  }
}

// ---------------- UPDATE ----------------
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json() as Partial<Asset>;

    if (!body.asset_id) {
      return withCors(req, { success: false, error: "asset_id required" }, 400);
    }

    const existing = await db`SELECT * FROM assets WHERE asset_id = ${body.asset_id}`;
    if (!existing?.[0]) return withCors(req, { success: false, error: "Not found" }, 404);

    const a = existing[0];

    // ✅ Verify Category Exists (if being updated)
    if (body.category_id) {
       const category = await db`SELECT category_id FROM asset_categories WHERE category_id = ${body.category_id}`;
       if (!category?.[0]) {
         return withCors(req, { success: false, error: "Invalid category_id. Please create the category first." }, 400);
       }
    }

    const updated = await db`
      UPDATE assets SET
        asset_name = ${body.asset_name ?? a.asset_name},
        category_id = ${body.category_id ?? a.category_id},
        serial_number = ${body.serial_number ?? a.serial_number},
        status = ${body.status ?? a.status},
        location = ${body.location ?? a.location},
        assigned_to = ${body.assigned_to ?? a.assigned_to},
        notes = ${body.notes ?? a.notes},
        purchase_date = ${body.purchase_date ?? a.purchase_date},
        purchase_cost = ${body.purchase_cost ?? a.purchase_cost},
        vendor_name = ${body.vendor_name ?? a.vendor_name},
        warranty_expiry = ${body.warranty_expiry ?? a.warranty_expiry},
        updated_at = NOW()
      WHERE asset_id = ${body.asset_id}
      RETURNING *
    `;

    return withCors(req, {
      success: true,
      data: updated?.[0] ?? null
    });

  } catch (error: any) {
    console.error("UPDATE ASSET ERROR:", error);
    return withCors(req, { success: false, error: error.message }, 500);
  }
}

// ---------------- DELETE ----------------
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const assetId = searchParams.get("asset_id");

    if (!assetId) return withCors(req, { success: false, error: "asset_id required" }, 400);

    await db`DELETE FROM assets WHERE asset_id = ${assetId}`;

    return withCors(req, { success: true, message: "Asset deleted" });

  } catch (error: any) {
    console.error("DELETE ASSET ERROR:", error);
    return withCors(req, { success: false, error: error.message }, 500);
  }
}
