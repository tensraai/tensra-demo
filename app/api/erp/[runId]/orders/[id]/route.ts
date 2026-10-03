import { readJson, respond, type RunIdCtx } from "@/lib/erp/http";
import { getOrder, updateOrderStatus } from "@/lib/erp/service";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: RunIdCtx) {
  const { runId, id } = await params;
  return respond(() => getOrder(runId, id));
}

// PATCH { "status": "Fulfilled" }
export async function PATCH(req: Request, { params }: RunIdCtx) {
  const { runId, id } = await params;
  return respond(async () => updateOrderStatus(runId, id, await readJson(req)));
}
