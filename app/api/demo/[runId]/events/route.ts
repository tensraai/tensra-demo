import { NextResponse } from "next/server";
import { createEventStream } from "@/lib/demo/api";
import type { RunCtx } from "@/lib/demo/http";
import { isValidRunId } from "@/lib/erp/store";
import { hasRecord } from "@/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/demo/:runId/events  -> text/event-stream (replays past events, then streams live)
export async function GET(req: Request, { params }: RunCtx) {
  const { runId } = await params;
  if (!isValidRunId(runId) || !hasRecord(runId)) {
    return NextResponse.json(
      { error: { code: "NOT_FOUND", message: "No run with this id. Start one first." } },
      { status: 404 },
    );
  }
  // EventSource sends Last-Event-ID when it reconnects, so no event is shown twice.
  const raw = req.headers.get("last-event-id") ?? new URL(req.url).searchParams.get("after");
  const afterId = raw !== null && Number.isInteger(Number(raw)) ? Number(raw) : -1;

  return new Response(createEventStream(runId, afterId, req.signal), {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
