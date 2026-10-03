import { handleStart } from "@/lib/demo/api";
import { readBody, rateLimited, send, type RunCtx } from "@/lib/demo/http";
import { limits } from "@/lib/demo/ratelimit";

export const dynamic = "force-dynamic";

// POST /api/demo/:runId/start   { "scenario": "valid" | "missing_customer_type", "failures": 0-10 }
// Returns 202 immediately; the pipeline keeps running and streams progress over /events.
export async function POST(req: Request, { params }: RunCtx) {
  const blocked = rateLimited(req, limits.start);
  if (blocked) return blocked;
  const { runId } = await params;
  return send(handleStart(runId, await readBody(req)));
}
