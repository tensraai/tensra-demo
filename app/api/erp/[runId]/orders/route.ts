import { readJson, respond, type RunCtx } from "@/lib/erp/http";
import { createOrder, findOrders } from "@/lib/erp/service";

export const dynamic = "force-dynamic";

// POST /api/erp/:runId/orders
export async function POST(req: Request, { params }: RunCtx) {
  const { runId } = await params;
  return respond(async () => createOrder(runId, await readJson(req)), 201);
}

// GET /api/erp/:runId/orders?externalRef=12345   (look up by HubSpot deal id)
export async function GET(req: Request, { params }: RunCtx) {
  const { runId } = await params;
  const ref = new URL(req.url).searchParams.get("externalRef") ?? "";
  return respond(() => findOrders(runId, ref));
}
