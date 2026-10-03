import { NextResponse } from "next/server";
import { ErpError } from "./service";

/** Runs a service call and converts the result or ErpError into a JSON response. */
export async function respond<T>(fn: () => T | Promise<T>, okStatus = 200) {
  try {
    return NextResponse.json(await fn(), { status: okStatus });
  } catch (e) {
    if (e instanceof ErpError) {
      const headers: Record<string, string> = e.status === 503 ? { "Retry-After": "1" } : {};
      return NextResponse.json(
        { error: { code: e.code, message: e.message, fields: e.details } },
        { status: e.status, headers },
      );
    }
    console.error("Unexpected mock ERP error", e);
    return NextResponse.json({ error: { code: "INTERNAL_ERROR", message: "Unexpected error" } }, { status: 500 });
  }
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new ErpError(400, "INVALID_JSON", "Request body must be valid JSON");
  }
}

export type RunCtx = { params: Promise<{ runId: string }> };
export type RunIdCtx = { params: Promise<{ runId: string; id: string }> };
