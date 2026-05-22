import { NextRequest } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { withCors, handleOptions } from "@/lib/cors";

const sql = neon(process.env.DATABASE_URL!);

// =========================
// Types
// =========================
type AnnouncementStatus = 'draft' | 'published' | 'archived';

type Announcement = {
  id: number;
  company_code: string;
  title: string;
  content: string;
  audience: string;
  status: AnnouncementStatus;
  publish_date: string | null;
  expiry_date: string | null;
  created_at: string;
  company_name?: string;
};

type CreateAnnouncementBody = {
  company_code: string;
  title: string;
  content: string;
  audience?: string;
  status?: AnnouncementStatus;
  publish_date?: string | null;
  expiry_date?: string | null;
};

type UpdateAnnouncementBody = {
  id: number;
  title?: string;
  content?: string;
  audience?: string;
  status?: AnnouncementStatus;
  publish_date?: string | null;
  expiry_date?: string | null;
};

// =========================
// OPTIONS
// =========================
export async function OPTIONS(req: NextRequest) {
  return handleOptions(req);
}

// =========================
// GET (List or Single)
// =========================
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (id) {
      const result = await sql`
        SELECT a.*, c.name AS company_name
        FROM announcements a
        LEFT JOIN companies c
          ON a.company_code = c.company_code
        WHERE a.id = ${id}
      `;

      if (!result.length) {
        return withCors(req, { success: false, message: 'Announcement not found' }, 404);
      }

      return withCors(req, {
        success: true,
        message: 'Announcement retrieved successfully',
        data: result[0]
      }, 200);
    }

    const all = await sql`
      SELECT a.*, c.name AS company_name
      FROM announcements a
      LEFT JOIN companies c
        ON a.company_code = c.company_code
      ORDER BY a.created_at DESC
    `;

    return withCors(req, {
      success: true,
      message: 'Announcements retrieved successfully',
      data: all
    }, 200);

  } catch (error) {
    console.error('Announcement GET error:', error);
    return withCors(req, { success: false, message: 'Failed to fetch announcements' }, 500);
  }
}

// =========================
// POST (Create)
// =========================
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as CreateAnnouncementBody;

    const {
      company_code,
      title,
      content,
      audience,
      status,
      publish_date,
      expiry_date
    } = body;

    if (!company_code || !title || !content) {
      return withCors(
        req,
        { success: false, message: 'company_code, title and content are required' },
        400
      );
    }

    // Validate company exists
    const company = await sql`
      SELECT company_code FROM companies
      WHERE TRIM(company_code) = TRIM(${company_code})
    `;

    if (!company.length) {
      return withCors(
        req,
        { success: false, message: 'Invalid company_code provided' },
        400
      );
    }

    const result = await sql`
      INSERT INTO announcements
        (company_code, title, content, audience, status, publish_date, expiry_date, created_at)
      VALUES
        (${company_code},
         ${title},
         ${content},
         ${audience ?? 'all'},
         ${status ?? 'draft'},
         ${publish_date ?? null},
         ${expiry_date ?? null},
         NOW())
      RETURNING *
    `;

    return withCors(req, {
      success: true,
      message: 'Announcement created successfully',
      data: result[0]
    }, 201);

  } catch (error) {
    console.error('Announcement POST error:', error);
    return withCors(req, { success: false, message: 'Failed to create announcement' }, 500);
  }
}

// =========================
// PUT (Update)
// =========================
export async function PUT(req: NextRequest) {
  try {
    const body = (await req.json()) as UpdateAnnouncementBody;

    const {
      id,
      title,
      content,
      audience,
      status,
      publish_date,
      expiry_date
    } = body;

    if (!id) {
      return withCors(
        req,
        { success: false, message: 'Announcement ID is required' },
        400
      );
    }

    const result = await sql`
      UPDATE announcements
      SET
        title = COALESCE(${title ?? null}, title),
        content = COALESCE(${content ?? null}, content),
        audience = COALESCE(${audience ?? null}, audience),
        status = COALESCE(${status ?? null}, status),
        publish_date = COALESCE(${publish_date ?? null}, publish_date),
        expiry_date = COALESCE(${expiry_date ?? null}, expiry_date)
      WHERE id = ${id}
      RETURNING *
    `;

    if (!result.length) {
      return withCors(
        req,
        { success: false, message: 'Announcement not found' },
        404
      );
    }

    return withCors(req, {
      success: true,
      message: 'Announcement updated successfully',
      data: result[0]
    }, 200);

  } catch (error) {
    console.error('Announcement PUT error:', error);
    return withCors(req, { success: false, message: 'Failed to update announcement' }, 500);
  }
}

// =========================
// DELETE
// =========================
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return withCors(
        req,
        { success: false, message: 'Announcement ID is required' },
        400
      );
    }

    const result = await sql`
      DELETE FROM announcements
      WHERE id = ${id}
      RETURNING *
    `;

    if (!result.length) {
      return withCors(
        req,
        { success: false, message: 'Announcement not found' },
        404
      );
    }

    return withCors(req, {
      success: true,
      message: 'Announcement deleted successfully',
      data: result[0]
    }, 200);

  } catch (error) {
    console.error('Announcement DELETE error:', error);
    return withCors(req, { success: false, message: 'Failed to delete announcement' }, 500);
  }
}