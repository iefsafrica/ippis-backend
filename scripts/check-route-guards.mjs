#!/usr/bin/env node
// Fails when an API handler has no permission check and is not listed as public.
// Runs before every build (see "build" in package.json), so a route added
// without requirePermission() or authenticate() cannot be deployed by accident.
//
//   node scripts/check-route-guards.mjs

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const API_DIR = join(ROOT, "app", "api");

// Handlers that are meant to work without a login. "METHOD /path": why.
// Adding a line here is a security decision: say why in the value.
const PUBLIC = {
  // Sign-in
  "POST /api/admin/auth/login": "password step of sign-in",
  "GET /api/admin/auth/login": "status ping, returns no data",
  "POST /api/admin/auth/login/request-otp": "resends the sign-in code",
  "POST /api/admin/auth/login/verify-otp": "code step of sign-in",
  "POST /api/admin/auth/logout": "clears the session cookie",

  // Public onboarding form (applicants have no account)
  "POST /api/admin/employees/register": "public registration",
  "POST /api/admin/employees/register/personal": "public registration",
  "POST /api/admin/employees/register/employment": "public registration",
  "POST /api/admin/employees/register/document-Upload": "public registration",
  "POST /api/admin/documents/upload": "public registration",
  "GET /api/admin/documents/status/[id]": "applicant checks own documents",
  "GET /api/track": "applicant tracks own registration",
  "POST /api/track": "applicant tracks own registration",
  "GET /api/kyc-status": "applicant checks own verification",
  "POST /api/verify/nin": "identity check during registration",

  // Read by pages that load before sign-in
  "GET /api/admin/settings/general": "system name and logo",
  "GET /api/admin/settings/appearance": "theme",
  "GET /api/admin/organization/company": "MDA list for forms",
  "GET /api/admin/organization/department": "department list for forms",
  "GET /api/admin/organization/designation": "designation list for forms",
  "GET /api/admin/organization/location": "location list for forms",

  // No data behind them
  "GET /api/health": "uptime check",
  "POST /api/payments/uverus": "mock, touches no data",
};

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const GUARD = /\b(requirePermission|authenticate)\s*\(/;
// Generated stubs that only return a fixed status message
const PLACEHOLDER = /message:\s*'IPPIS HR API'/;

function routeFiles(dir) {
  const found = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) found.push(...routeFiles(path));
    else if (name === "route.ts" || name === "route.js") found.push(path);
  }
  return found;
}

function urlOf(file) {
  const parts = relative(join(ROOT, "app"), file).split(sep).slice(0, -1);
  return "/" + parts.join("/");
}

// Splits a route file into its exported handlers and the code of each
function handlersOf(source) {
  const heads = [...source.matchAll(/^export\s+(?:async\s+)?function\s+([A-Z]+)\s*\(/gm)];
  return heads.map((head, i) => ({
    method: head[1],
    body: source.slice(head.index, i + 1 < heads.length ? heads[i + 1].index : source.length),
  }));
}

const unguarded = [];
const seen = new Set();
let checked = 0;
let placeholders = 0;

for (const file of routeFiles(API_DIR)) {
  const source = readFileSync(file, "utf8");
  if (PLACEHOLDER.test(source)) {
    placeholders++;
    continue;
  }

  for (const { method, body } of handlersOf(source)) {
    if (!METHODS.includes(method)) continue;
    const id = `${method} ${urlOf(file)}`;
    seen.add(id);
    checked++;

    if (GUARD.test(body)) {
      if (id in PUBLIC) {
        console.warn(`note: ${id} is listed as public but has a permission check; remove it from PUBLIC`);
      }
      continue;
    }
    if (!(id in PUBLIC)) unguarded.push({ id, file: relative(ROOT, file) });
  }
}

const stale = Object.keys(PUBLIC).filter((id) => !seen.has(id));
for (const id of stale) {
  console.warn(`note: ${id} is listed as public but no such handler exists; remove it from PUBLIC`);
}

if (unguarded.length > 0) {
  console.error(`\n${unguarded.length} API handler(s) have no permission check:\n`);
  for (const { id, file } of unguarded) console.error(`  ${id}\n      ${file}`);
  console.error(
    "\nAdd requirePermission(req, \"module.resource.action\") or authenticate(req) from lib/rbac.ts,\n" +
      "or, if the handler must work without a login, list it in PUBLIC in scripts/check-route-guards.mjs.\n"
  );
  process.exit(1);
}

console.log(
  `Route guards OK: ${checked} handlers checked, ${Object.keys(PUBLIC).length - stale.length} public by design, ` +
    `${placeholders} placeholder files skipped.`
);
