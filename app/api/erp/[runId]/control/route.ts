import { readJson, respond, type RunCtx } from "@/lib/erp/http";
import { ErpError, runSummary, setFailures } from "@/lib/erp/service";
import { resetRun } from "@/lib/erp/store";

export const dynamic = "force-dynamic";

// GET  -> counts and failure-injection state for the run
export async function GET(_req: Request, { params }: RunCtx) {
  const { runId } = await params;
  return respond(() => runSummary(runId));
}

// POST { "failures": 2 } -> next 2 data requests return 503
// POST { "reset": true } -> wipe this run's ERP data
export async function POST(req: Request, { params }: RunCtx) {
  const { runId } = await params;
  return respond(async () => {
    const body = (await readJson(req)) as { failures?: unknown; reset?: unknown };
    if (body.reset === true) {
      resetRun(runId);
      return runSummary(runId);
    }
    if (typeof body.failures === "number") return setFailures(runId, body.failures);
    throw new ErpError(400, "INVALID_BODY", 'Send {"failures": N} or {"reset": true}');
  });
}
