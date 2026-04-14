import { neon } from "@neondatabase/serverless";
import { withCors, handleOptions } from "../../../lib/cors";
import { NextRequest } from "next/server";
import crypto from "crypto";

export const dynamic = "force-dynamic";

const db = neon(process.env.DATABASE_URL!);

// ✅ Knowledge Base Article type
type KnowledgeBaseArticle = {
  id?: number;
  kb_id: string;
  title: string;
  category: string;
  tags?: string;
  content: string;
  attachments?: string;
  created_at?: string;
  updated_at?: string;
};

// ----------------- CORS -----------------
export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// ----------------- CREATE -----------------
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      title: string;
      category: string;
      tags?: string;
      content: string;
      attachments?: string;
    };

    const { title, category, tags, content, attachments } = body;

    if (!title || !category || !content) {
      return withCors(req, {
        success: false,
        error: "Title, category, and content are required",
      }, 400);
    }

    const kbId = `KB-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;

    const result = await db`
      INSERT INTO knowledge_base (
        kb_id, title, category, tags, content, attachments, created_at, updated_at
      )
      VALUES (
        ${kbId}, ${title}, ${category}, ${tags ?? null}, ${content}, ${attachments ?? null}, NOW(), NOW()
      )
      RETURNING *
    `;

    const article = result as unknown as KnowledgeBaseArticle[];

    return withCors(req, {
      success: true,
      message: "Knowledge base article created successfully",
      article: article[0],
    });

  } catch (error) {
    console.error("❌ Error creating KB article:", error);
    return withCors(req, {
      success: false,
      error: "Failed to create KB article",
      details: error instanceof Error ? error.message : String(error),
    }, 500);
  }
}

// ----------------- READ -----------------
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const page = Number(searchParams.get("page") || "1");
    const limit = Number(searchParams.get("limit") || "10");
    const offset = (page - 1) * limit;

    const result = await db`
      SELECT * FROM knowledge_base
      ORDER BY updated_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const articles = result as unknown as KnowledgeBaseArticle[];

    const countResult = await db`SELECT COUNT(*) AS total FROM knowledge_base`;
    const total = Number((countResult as any)[0]?.total ?? 0);

    return withCors(req, {
      success: true,
      data: {
        articles,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      },
    });

  } catch (error) {
    console.error("❌ Error fetching KB articles:", error);
    return withCors(req, {
      success: false,
      error: "Failed to fetch KB articles",
      details: error instanceof Error ? error.message : String(error),
    }, 500);
  }
}

// ----------------- UPDATE -----------------
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json() as {
      kb_id: string;
      title?: string;
      category?: string;
      tags?: string;
      content?: string;
      attachments?: string;
    };

    const { kb_id, title, category, tags, content, attachments } = body;

    if (!kb_id) {
      return withCors(req, { success: false, error: "kb_id is required" }, 400);
    }

    // Fetch existing record first
    const existingResult = await db`
      SELECT * FROM knowledge_base WHERE kb_id = ${kb_id}
    `;

    const existing = (existingResult as KnowledgeBaseArticle[])[0];

    if (!existing) {
      return withCors(req, {
        success: false,
        error: "KB article not found",
      }, 404);
    }

    // Use existing values if not provided
    const updatedTitle = title ?? existing.title;
    const updatedCategory = category ?? existing.category;
    const updatedTags = tags ?? existing.tags;
    const updatedContent = content ?? existing.content;
    const updatedAttachments = attachments ?? existing.attachments;

    const result = await db`
      UPDATE knowledge_base
      SET
        title = ${updatedTitle},
        category = ${updatedCategory},
        tags = ${updatedTags},
        content = ${updatedContent},
        attachments = ${updatedAttachments},
        updated_at = NOW()
      WHERE kb_id = ${kb_id}
      RETURNING *
    `;

    const updated = result as unknown as KnowledgeBaseArticle[];

    return withCors(req, {
      success: true,
      message: "KB article updated successfully",
      article: updated[0],
    });

  } catch (error) {
    console.error("❌ Error updating KB article:", error);
    return withCors(req, {
      success: false,
      error: "Failed to update KB article",
      details: error instanceof Error ? error.message : String(error),
    }, 500);
  }
}

// ----------------- DELETE -----------------
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const kbId = searchParams.get("kb_id");

    if (!kbId) {
      return withCors(req, { success: false, error: "kb_id is required" }, 400);
    }

    await db`
      DELETE FROM knowledge_base WHERE kb_id = ${kbId}
    `;

    return withCors(req, {
      success: true,
      message: "KB article deleted successfully",
      kb_id: kbId,
    });

  } catch (error) {
    console.error("❌ Error deleting KB article:", error);
    return withCors(req, {
      success: false,
      error: "Failed to delete KB article",
      details: error instanceof Error ? error.message : String(error),
    }, 500);
  }
}