// app/api/admin/settings/advanced/route.ts
import { neon } from "@neondatabase/serverless"
import { withCors, handleOptions } from "../../../../../lib/cors"
import { NextRequest } from "next/server"

export const dynamic = "force-dynamic"

const sql = neon(process.env.DATABASE_URL!)

const VALID_DATE_FORMATS        = ["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD", "DD-MM-YYYY", "D MMM YYYY"]
const VALID_TIME_FORMATS        = ["HH:mm", "hh:mm A", "HH:mm:ss"]
const VALID_CURRENCIES          = ["NGN", "USD", "GBP", "EUR", "GHS", "KES", "ZAR", "XOF"]
const VALID_VERIFICATION_MODES  = ["manual", "automatic"]
const VALID_DECIMAL_SEPARATORS  = [".", ","]
const VALID_THOUSAND_SEPARATORS = [",", ".", " "]

// ─── OPTIONS ───────────────────────────────────────────────────────────────────
export async function OPTIONS(req: NextRequest) {
  return handleOptions(req)
}

// ─── GET /api/admin/settings/advanced ─────────────────────────────────────────
// Returns all advanced settings
export async function GET(req: NextRequest) {
  try {
    const rows = await sql`
      SELECT key, value, data_type, updated_at, updated_by
      FROM admin_settings
      WHERE category = 'advanced'
      ORDER BY key ASC
    `

    if (rows.length === 0) {
      return withCors(req, {
        success: false,
        error: "No advanced settings found. Run POST /api/admin/settings/init first.",
      }, 404)
    }

    const map: Record<string, any> = {}
    for (const row of rows) map[row.key] = row.value

    return withCors(req, {
      success: true,
      data: {
        documentVerificationMode: map["documentVerificationMode"] ?? "manual",
        systemDateFormat:         map["systemDateFormat"]         ?? "DD/MM/YYYY",
        systemTimeFormat:         map["systemTimeFormat"]         ?? "HH:mm",
        systemCurrency:           map["systemCurrency"]           ?? "NGN",
        systemDecimalSeparator:   map["systemDecimalSeparator"]   ?? ".",
        systemThousandSeparator:  map["systemThousandSeparator"]  ?? ",",
        debugMode:                map["debugMode"]                === "true",
        maintenanceMode:          map["maintenanceMode"]          === "true",
      },
      options: {
        dateFormats:        VALID_DATE_FORMATS,
        timeFormats:        VALID_TIME_FORMATS,
        currencies:         VALID_CURRENCIES,
        verificationModes:  VALID_VERIFICATION_MODES,
        decimalSeparators:  VALID_DECIMAL_SEPARATORS,
        thousandSeparators: VALID_THOUSAND_SEPARATORS,
      },
    })
  } catch (error) {
    console.error("Error fetching advanced settings:", error)
    return withCors(req, {
      success: false,
      error: "Failed to fetch advanced settings",
      details: error instanceof Error ? error.message : String(error),
    }, 500)
  }
}

// ─── PUT /api/admin/settings/advanced ─────────────────────────────────────────
// Body (all optional):
//   documentVerificationMode, systemDateFormat, systemTimeFormat,
//   systemCurrency, systemDecimalSeparator, systemThousandSeparator,
//   debugMode, maintenanceMode, updatedBy
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json()
    const {
      documentVerificationMode, systemDateFormat, systemTimeFormat,
      systemCurrency, systemDecimalSeparator, systemThousandSeparator,
      debugMode, maintenanceMode, updatedBy,
    } = body

    const updates: { key: string; value: string }[] = []
    const errors: string[] = []

    if (documentVerificationMode !== undefined) {
      const mode = String(documentVerificationMode).trim().toLowerCase()
      if (!VALID_VERIFICATION_MODES.includes(mode)) {
        errors.push(`documentVerificationMode must be one of: ${VALID_VERIFICATION_MODES.join(", ")}.`)
      } else {
        updates.push({ key: "documentVerificationMode", value: mode })
      }
    }

    if (systemDateFormat !== undefined) {
      const fmt = String(systemDateFormat).trim()
      if (!VALID_DATE_FORMATS.includes(fmt)) {
        errors.push(`systemDateFormat must be one of: ${VALID_DATE_FORMATS.join(", ")}.`)
      } else {
        updates.push({ key: "systemDateFormat", value: fmt })
      }
    }

    if (systemTimeFormat !== undefined) {
      const fmt = String(systemTimeFormat).trim()
      if (!VALID_TIME_FORMATS.includes(fmt)) {
        errors.push(`systemTimeFormat must be one of: ${VALID_TIME_FORMATS.join(", ")}.`)
      } else {
        updates.push({ key: "systemTimeFormat", value: fmt })
      }
    }

    if (systemCurrency !== undefined) {
      const currency = String(systemCurrency).trim().toUpperCase()
      if (!VALID_CURRENCIES.includes(currency)) {
        errors.push(`systemCurrency must be one of: ${VALID_CURRENCIES.join(", ")}.`)
      } else {
        updates.push({ key: "systemCurrency", value: currency })
      }
    }

    if (systemDecimalSeparator !== undefined) {
      const sep = String(systemDecimalSeparator).trim()
      if (!VALID_DECIMAL_SEPARATORS.includes(sep)) {
        errors.push(`systemDecimalSeparator must be one of: ${VALID_DECIMAL_SEPARATORS.join(" or ")}.`)
      } else {
        updates.push({ key: "systemDecimalSeparator", value: sep })
      }
    }

    if (systemThousandSeparator !== undefined) {
      const sep = String(systemThousandSeparator).trim()
      if (!VALID_THOUSAND_SEPARATORS.includes(sep)) {
        errors.push(`systemThousandSeparator must be one of: ${VALID_THOUSAND_SEPARATORS.join(" or ")}.`)
      } else {
        updates.push({ key: "systemThousandSeparator", value: sep })
      }
    }

    if (debugMode !== undefined) {
      if (typeof debugMode !== "boolean") {
        errors.push("debugMode must be a boolean (true or false).")
      } else {
        updates.push({ key: "debugMode", value: String(debugMode) })
      }
    }

    if (maintenanceMode !== undefined) {
      if (typeof maintenanceMode !== "boolean") {
        errors.push("maintenanceMode must be a boolean (true or false).")
      } else {
        updates.push({ key: "maintenanceMode", value: String(maintenanceMode) })
      }
    }

    if (errors.length > 0) {
      return withCors(req, { success: false, error: "Validation failed", details: errors }, 422)
    }

    if (updates.length === 0) {
      return withCors(req, { success: false, error: "No valid fields provided for update." }, 400)
    }

    const updatedByValue = updatedBy ? String(updatedBy).trim() : "system"
    const now = new Date().toISOString()

    for (const { key, value } of updates) {
      await sql`
        UPDATE admin_settings
        SET value = ${value}, updated_at = ${now}, updated_by = ${updatedByValue}
        WHERE key = ${key} AND category = 'advanced'
      `
    }

    const refreshed = await sql`
      SELECT key, value FROM admin_settings WHERE category = 'advanced'
    `
    const result: Record<string, string> = {}
    for (const row of refreshed) result[row.key] = row.value

    return withCors(req, {
      success: true,
      message: `${updates.length} advanced setting(s) updated successfully.`,
      updatedKeys: updates.map((u) => u.key),
      data: {
        documentVerificationMode: result["documentVerificationMode"] ?? "manual",
        systemDateFormat:         result["systemDateFormat"]         ?? "DD/MM/YYYY",
        systemTimeFormat:         result["systemTimeFormat"]         ?? "HH:mm",
        systemCurrency:           result["systemCurrency"]           ?? "NGN",
        systemDecimalSeparator:   result["systemDecimalSeparator"]   ?? ".",
        systemThousandSeparator:  result["systemThousandSeparator"]  ?? ",",
        debugMode:                result["debugMode"]                === "true",
        maintenanceMode:          result["maintenanceMode"]          === "true",
      },
    })
  } catch (error) {
    console.error("Error updating advanced settings:", error)
    return withCors(req, {
      success: false,
      error: "Failed to update advanced settings",
      details: error instanceof Error ? error.message : String(error),
    }, 500)
  }
}
