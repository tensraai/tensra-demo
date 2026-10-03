import { handleReset, handleState } from "@/lib/demo/api";
import { send, type RunCtx } from "@/lib/demo/http";

export const dynamic = "force-dynamic";

// GET    /api/demo/:runId  -> current run, events, HubSpot deal, ERP data
export async function GET(_req: Request, { params }: RunCtx) {
  const { runId } = await params;
  return send(handleState(runId));
}

// DELETE /api/demo/:runId  -> reset
export async function DELETE(_req: Request, { params }: RunCtx) {
  const { runId } = await params;
  return send(handleReset(runId));
}
