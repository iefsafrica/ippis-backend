import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "@/lib/cors";
import { NextRequest } from "next/server";
import crypto from "crypto";

export const dynamic = "force-dynamic";

const db = neon(process.env.DATABASE_URL!);

// ---------------- TYPES ----------------
type AssetCategory = {
  category_id: string;
  category_name: string;
  description?: string;
  status?: string;
};

// ---------------- CORS ----------------
export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// ---------------- CREATE ----------------
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as Partial<AssetCategory>;

    if (!body.category_name) {
      return withCors(req, { success: false, error: "category_name is required" }, 400);
    }

    const categoryId = `CAT-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;

    const result = await db`
      INSERT INTO asset_categories (
        category_id, category_name, description, status,
        created_at, updated_at
      )
      VALUES (
        ${categoryId}, ${body.category_name}, ${body.description ?? null}, ${body.status ?? 'Active'},
        NOW(), NOW()
      )
      RETURNING *
    `;

    return withCors(req, {
      success: true,
      data: result?.[0] ?? null
    });

  } catch (error: any) {
    console.error("CREATE CATEGORY ERROR:", error);
    return withCors(req, { success: false, error: error.message }, 500);
  }
}

// ---------------- READ ----------------
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const categoryId = searchParams.get("category_id");

    if (categoryId) {
      const single = await db`SELECT * FROM asset_categories WHERE category_id = ${categoryId}`;
      if (!single?.[0]) return withCors(req, { success: false, error: "Not found" }, 404);
      return withCors(req, { success: true, data: single[0] });
    }

    const page = Number(searchParams.get("page") || "1");
    const limit = Number(searchParams.get("limit") || "10");
    const offset = (page - 1) * limit;

    const results = await db`
      SELECT * FROM asset_categories 
      ORDER BY created_at DESC 
      LIMIT ${limit} OFFSET ${offset}
    `;

    const count = await db`SELECT COUNT(*) FROM asset_categories`;

    return withCors(req, {
      success: true,
      data: {
        categories: results,
        pagination: {
          total: Number(count?.[0]?.count ?? 0),
          page,
          limit
        }
      }
    });

  } catch (error: any) {
    console.error("GET CATEGORIES ERROR:", error);
    return withCors(req, { success: false, error: error.message }, 500);
  }
}

// ---------------- UPDATE ----------------
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json() as Partial<AssetCategory>;

    if (!body.category_id) {
      return withCors(req, { success: false, error: "category_id required" }, 400);
    }

    const existing = await db`SELECT * FROM asset_categories WHERE category_id = ${body.category_id}`;
    if (!existing?.[0]) return withCors(req, { success: false, error: "Not found" }, 404);

    const e = existing[0];

    const updated = await db`
      UPDATE asset_categories SET
        category_name = ${body.category_name ?? e.category_name},
        description = ${body.description ?? e.description},
        status = ${body.status ?? e.status},
        updated_at = NOW()
      WHERE category_id = ${body.category_id}
      RETURNING *
    `;

    return withCors(req, {
      success: true,
      data: updated?.[0] ?? null
    });

  } catch (error: any) {
    console.error("UPDATE CATEGORY ERROR:", error);
    return withCors(req, { success: false, error: error.message }, 500);
  }
}

// ---------------- DELETE ----------------
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const categoryId = searchParams.get("category_id");

    if (!categoryId) return withCors(req, { success: false, error: "category_id required" }, 400);

    // Check if assets exist for this category
    const count = await db`SELECT COUNT(*) FROM assets WHERE category_id = ${categoryId}`;
    if (Number(count?.[0]?.count ?? 0) > 0) {
      return withCors(req, { 
        success: false, 
        error: "Cannot delete category that still has linked assets. Move or delete assets first." 
      }, 400);
    }

    await db`DELETE FROM asset_categories WHERE category_id = ${categoryId}`;

    return withCors(req, { success: true, message: "Category deleted" });

  } catch (error: any) {
    console.error("DELETE CATEGORY ERROR:", error);
    return withCors(req, { success: false, error: error.message }, 500);
  }
}
