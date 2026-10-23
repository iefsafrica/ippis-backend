import { NextRequest } from 'next/server';
import { requirePermission, runAudited } from "@/lib/rbac";
import { resolveMda, managesMda, mdaIdOf } from "@/lib/organisation";
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
    const auth = await requirePermission(req, "organization.structure.view");
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    const mdaParam = searchParams.get('company_id') || searchParams.get('mda_id');
    const mdaFilter = mdaParam && Number.isInteger(Number(mdaParam)) ? Number(mdaParam) : null;

    if (id) {
      const result = await sql`
        SELECT a.*, c.name AS company_name
        FROM announcements a
        LEFT JOIN companies c
          ON c.id = a.company_id OR (a.company_id IS NULL AND TRIM(c.company_code) = TRIM(a.company_code))
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
        ON c.id = a.company_id OR (a.company_id IS NULL AND TRIM(c.company_code) = TRIM(a.company_code))
      WHERE (${mdaFilter}::int IS NULL OR a.company_id = ${mdaFilter})
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
    const auth = await requirePermission(req, "organization.structure.manage");
    if (!auth.ok) return auth.response;

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

    if (!title || !content) {
      return withCors(
        req,
        { success: false, message: 'title and content are required' },
        400
      );
    }

    // The MDA, by company_id or company_code; stored by both
    const mda = await resolveMda(body as any);
    if ("error" in mda) {
      return withCors(req, { success: false, message: mda.error }, mda.status);
    }
    if (!managesMda(auth.ctx, mda.company.id)) {
      return withCors(req, { success: false, message: 'This MDA is outside your scope' }, 403);
    }

    const result = await sql`
      INSERT INTO announcements
        (company_id, company_code, title, content, audience, status, publish_date, expiry_date, created_at)
      VALUES
        (${mda.company.id}, ${mda.company.company_code},
         ${title},
         ${content},
         ${audience ?? 'all'},
         ${status ?? 'draft'},
         ${publish_date ?? null},
         ${expiry_date ?? null},
         NOW())
      RETURNING *
    `;

    await runAudited(req, auth.ctx, { action: "organization.announcement.created", targetType: "organization.announcement", details: {} }, []);

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
    const auth = await requirePermission(req, "organization.structure.manage");
    if (!auth.ok) return auth.response;

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

    const owner = await sql`SELECT * FROM announcements WHERE id = ${id}`;
    if (owner[0] && !managesMda(auth.ctx, await mdaIdOf(owner[0]))) {
      return withCors(req, { success: false, message: 'This record belongs to an MDA outside your scope' }, 403);
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

    await runAudited(req, auth.ctx, { action: "organization.announcement.updated", targetType: "organization.announcement", details: {} }, []);

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
    const auth = await requirePermission(req, "organization.structure.manage");
    if (!auth.ok) return auth.response;

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return withCors(
        req,
        { success: false, message: 'Announcement ID is required' },
        400
      );
    }

    const owner = await sql`SELECT * FROM announcements WHERE id = ${id}`;
    if (owner[0] && !managesMda(auth.ctx, await mdaIdOf(owner[0]))) {
      return withCors(req, { success: false, message: 'This record belongs to an MDA outside your scope' }, 403);
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

    await runAudited(req, auth.ctx, { action: "organization.announcement.deleted", targetType: "organization.announcement", details: {} }, []);

    return withCors(req, {
      success: true,
      message: 'Announcement deleted successfully',
      data: result[0]
    }, 200);

  } catch (error) {
    if ((error as any)?.code === '23503') {
      return withCors(req, { success: false, message: 'This record is still in use elsewhere (for example by performance records), so it cannot be deleted. Set it to inactive instead.' }, 409);
    }
    console.error('Announcement DELETE error:', error);
    return withCors(req, { success: false, message: 'Failed to delete announcement' }, 500);
  }
}