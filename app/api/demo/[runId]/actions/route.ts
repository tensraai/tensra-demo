import { handleAction } from "@/lib/demo/api";
import { readBody, rateLimited, send, type RunCtx } from "@/lib/demo/http";
import { limits } from "@/lib/demo/ratelimit";

export const dynamic = "force-dynamic";

// POST /api/demo/:runId/actions   { "action": "fulfil" | "resend" | "replay" }
export async function POST(req: Request, { params }: RunCtx) {
  const blocked = rateLimited(req, limits.action);
  if (blocked) return blocked;
  const { runId } = await params;
  return send(await handleAction(runId, await readBody(req)));
}
