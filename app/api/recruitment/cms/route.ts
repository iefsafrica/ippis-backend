import { NextRequest } from "next/server";
import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "../../../../lib/cors";
import { z } from "zod";

const sql = neon(process.env.DATABASE_URL!);

const CmsPostSchema = z.object({
  title: z.string().min(1),
  type: z.string().min(1),
  content: z.string().optional(),
  status: z.enum(["Draft", "Published", "Archived"]),
  author: z.string().min(1),
  views: z.number().int().nonnegative().optional()
});

/* -------------------------
   OPTIONS
------------------------- */
export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

/* -------------------------
   CREATE CMS POST
------------------------- */
export async function POST(req: NextRequest) {
  try {
    const body = CmsPostSchema.parse(await req.json());

    const result = await sql`
      INSERT INTO cms_posts (
        title, type, content, status, author, views
      ) VALUES (
        ${body.title},
        ${body.type},
        ${body.content ?? null},
        ${body.status},
        ${body.author},
        ${body.views ?? 0}
      )
      RETURNING *
    `;

    return withCors(req, {
      success: true,
      message: "CMS post created successfully",
      data: result[0]
    });

  } catch (error: any) {
    return withCors(req, {
      success: false,
      message: error?.errors ? error.errors[0].message : "Create failed",
      error: error.message
    }, 400);
  }
}

/* -------------------------
   GET CMS POSTS
------------------------- */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    const status = searchParams.get("status");

    /* SINGLE POST */
    if (id) {
      const result = await sql`
        SELECT *
        FROM cms_posts
        WHERE id = ${id}::uuid
      `;
      if (result.length === 0) {
        return withCors(req, { success: false, message: "Post not found" }, 404);
      }
      return withCors(req, { success: true, data: result[0] });
    }

    /* LIST POSTS (for table) */
    const result = await sql`
      SELECT *
      FROM cms_posts
      WHERE (${status ? sql`status = ${status}` : sql`TRUE`})
      ORDER BY updated_at DESC
    `;

    return withCors(req, { success: true, data: result });

  } catch (error: any) {
    return withCors(req, {
      success: false,
      message: "Fetch failed",
      error: error.message
    }, 500);
  }
}

/* -------------------------
   UPDATE CMS POST
------------------------- */
export async function PUT(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      return withCors(req, { success: false, message: "Post ID required" }, 400);
    }

    const body = CmsPostSchema.parse(await req.json());

    const result = await sql`
      UPDATE cms_posts
      SET
        title = ${body.title},
        type = ${body.type},
        content = ${body.content ?? null},
        status = ${body.status},
        author = ${body.author},
        views = ${body.views ?? 0},
        updated_at = NOW()
      WHERE id = ${id}::uuid
      RETURNING *
    `;

    if (result.length === 0) {
      return withCors(req, { success: false, message: "Post not found" }, 404);
    }

    return withCors(req, {
      success: true,
      message: "CMS post updated successfully",
      data: result[0]
    });

  } catch (error: any) {
    return withCors(req, {
      success: false,
      message: error?.errors ? error.errors[0].message : "Update failed",
      error: error.message
    }, 400);
  }
}

/* -------------------------
   DELETE CMS POST
------------------------- */
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      return withCors(req, { success: false, message: "Post ID required" }, 400);
    }

    const result = await sql`
      DELETE FROM cms_posts
      WHERE id = ${id}::uuid
      RETURNING *
    `;

    if (result.length === 0) {
      return withCors(req, { success: false, message: "Post not found" }, 404);
    }

    return withCors(req, {
      success: true,
      message: "CMS post deleted successfully"
    });

  } catch (error: any) {
    return withCors(req, {
      success: false,
      message: "Delete failed",
      error: error.message
    }, 500);
  }
}