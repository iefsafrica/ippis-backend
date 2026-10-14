import { NextRequest } from "next/server";
import { withCors } from "@/lib/cors";

/**
 * Fixed-window counters held in this server process.
 * They reset on restart and are not shared between instances, so this suits a
 * single-instance deployment; move the store to the database or Redis before
 * running more than one instance.
 */
type Bucket = { count: number; resetAt: number };

const store: Map<string, Bucket> =
  ((globalThis as any).__ippisRateLimit ??= new Map<string, Bucket>());

const MAX_KEYS = 10_000;

function prune(now: number) {
  if (store.size < MAX_KEYS) return;
  for (const [key, bucket] of store) {
    if (bucket.resetAt <= now) store.delete(key);
  }
}

export type LimitResult = { allowed: boolean; count: number; retryAfter: number };

/** Counts one event against `key` and says whether it is within `limit` per window. */
export function hit(key: string, limit: number, windowMs: number): LimitResult {
  const now = Date.now();
  prune(now);

  let bucket = store.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + windowMs };
    store.set(key, bucket);
  }
  bucket.count += 1;

  return {
    allowed: bucket.count <= limit,
    count: bucket.count,
    retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
  };
}

/** Reads the current count without adding to it. */
export function peek(key: string): number {
  const bucket = store.get(key);
  return bucket && bucket.resetAt > Date.now() ? bucket.count : 0;
}

export function clear(key: string) {
  store.delete(key);
}

export function clientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

export function tooManyRequests(req: NextRequest, retryAfter: number, message: string) {
  const response = withCors(req, { success: false, message, retryAfter }, 429);
  response.headers.set("Retry-After", String(retryAfter));
  return response;
}
