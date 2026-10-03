import { NextResponse, after } from "next/server";
import type { ApiResult } from "./api";
import type { Limiter } from "./ratelimit";

export type RunCtx = { params: Promise<{ runId: string }> };

/** Sends an ApiResult as JSON and schedules any background work (the pipeline) to run after the response. */
export function send(result: ApiResult) {
  if (result.background) {
    const work = result.background;
    after(() => work().catch((e) => console.error("Background pipeline error", e)));
  }
  return NextResponse.json(result.body, { status: result.status });
}

/** Parses a JSON body; returns null for an empty or invalid body. */
export async function readBody(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

/** Visitor address behind a proxy (Railway, Render, Cloudflare set these headers). */
function clientIp(req: Request): string {
  return req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "local";
}

/** Returns a 429 response when this visitor is over the limit, otherwise null. */
export function rateLimited(req: Request, limiter: Limiter) {
  const r = limiter.check(clientIp(req));
  if (r.ok) return null;
  return NextResponse.json(
    { error: { code: "RATE_LIMITED", message: `Too many requests. Please try again in ${r.retryAfterSec}s.` } },
    { status: 429, headers: { "Retry-After": String(r.retryAfterSec) } },
  );
}
