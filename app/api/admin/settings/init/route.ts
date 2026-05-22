// app/api/admin/settings/init/route.ts
// Seeds the admin_settings table with default values if they don't already exist.
// Call this once on first deploy or when the settings table is empty.
import { neon } from "@neondatabase/serverless"
import { withCors, handleOptions } from "@/lib/cors";
import { NextRequest } from "next/server"

export const dynamic = "force-dynamic"

const sql = neon(process.env.DATABASE_URL!)

const DEFAULT_SETTINGS = [
  // General
  { key: "systemName",     value: "IPPIS Admin Portal",  category: "general",       dataType: "string" },
  { key: "systemLogo",     value: "",                     category: "general",       dataType: "string" },
  { key: "systemLanguage", value: "en",                   category: "general",       dataType: "string" },
  { key: "systemTimezone", value: "Africa/Lagos",         category: "general",       dataType: "string" },

  // Notifications
  { key: "emailNotifications",    value: "true",       category: "notifications", dataType: "boolean" },
  { key: "systemNotifications",   value: "true",       category: "notifications", dataType: "boolean" },
  { key: "notificationFrequency", value: "immediate",  category: "notifications", dataType: "string"  },

  // Email
  { key: "emailServer",   value: "", category: "email", dataType: "string" },
  { key: "emailPort",     value: "", category: "email", dataType: "string" },
  { key: "emailUsername", value: "", category: "email", dataType: "string" },
  { key: "emailPassword", value: "", category: "email", dataType: "string" },
  { key: "emailFrom",     value: "", category: "email", dataType: "string" },
  { key: "emailReplyTo",  value: "", category: "email", dataType: "string" },
  { key: "emailTemplate", value: "", category: "email", dataType: "string" },

  // Appearance
  { key: "systemTheme",    value: "light",   category: "appearance", dataType: "string" },
  { key: "primaryColor",   value: "#22c55e", category: "appearance", dataType: "string" },
  { key: "secondaryColor", value: "#f97316", category: "appearance", dataType: "string" },
  { key: "fontFamily",     value: "Inter",   category: "appearance", dataType: "string" },

  // Advanced
  { key: "documentVerificationMode", value: "manual",    category: "advanced", dataType: "string"  },
  { key: "systemDateFormat",         value: "DD/MM/YYYY",category: "advanced", dataType: "string"  },
  { key: "systemTimeFormat",         value: "HH:mm",     category: "advanced", dataType: "string"  },
  { key: "systemCurrency",           value: "NGN",       category: "advanced", dataType: "string"  },
  { key: "systemDecimalSeparator",   value: ".",         category: "advanced", dataType: "string"  },
  { key: "systemThousandSeparator",  value: ",",         category: "advanced", dataType: "string"  },
  { key: "debugMode",                value: "false",     category: "advanced", dataType: "boolean" },
  { key: "maintenanceMode",          value: "false",     category: "advanced", dataType: "boolean" },
]

// ─── OPTIONS ───────────────────────────────────────────────────────────────────
export async function OPTIONS(req: NextRequest) {
  return handleOptions(req)
}

// ─── POST /api/admin/settings/init ─────────────────────────────────────────────
// Creates the admin_settings table (if not exists) and seeds default values.
export async function POST(req: NextRequest) {
  try {
    // 1. Ensure the table exists
    await sql`
      CREATE TABLE IF NOT EXISTS admin_settings (
        id         SERIAL PRIMARY KEY,
        key        VARCHAR(255)  NOT NULL UNIQUE,
        value      TEXT,
        category   VARCHAR(100)  NOT NULL,
        data_type  VARCHAR(50)   NOT NULL,
        created_at TIMESTAMPTZ   DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ   DEFAULT CURRENT_TIMESTAMP,
        updated_by VARCHAR(255)
      )
    `

    // 2. Insert defaults (skip on conflict)
    let inserted = 0
    let skipped = 0

    for (const s of DEFAULT_SETTINGS) {
      const result = await sql`
        INSERT INTO admin_settings (key, value, category, data_type)
        VALUES (${s.key}, ${s.value}, ${s.category}, ${s.dataType})
        ON CONFLICT (key) DO NOTHING
        RETURNING id
      `
      if (result.length > 0) inserted++
      else skipped++
    }

    return withCors(req, {
      success: true,
      message: "Settings initialised successfully.",
      inserted,
      skipped,
      total: DEFAULT_SETTINGS.length,
    })
  } catch (error) {
    console.error("Error initialising settings:", error)
    return withCors(req, {
      success: false,
      error: "Failed to initialise settings",
      details: error instanceof Error ? error.message : String(error),
    }, 500)
  }
}
