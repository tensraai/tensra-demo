import { readJson, respond, type RunCtx } from "@/lib/erp/http";
import { createCustomer, findCustomers } from "@/lib/erp/service";

export const dynamic = "force-dynamic";

// POST /api/erp/:runId/customers
export async function POST(req: Request, { params }: RunCtx) {
  const { runId } = await params;
  return respond(async () => createCustomer(runId, await readJson(req)), 201);
}

// GET /api/erp/:runId/customers?name=Acme%20Manufacturing
export async function GET(req: Request, { params }: RunCtx) {
  const { runId } = await params;
  const name = new URL(req.url).searchParams.get("name") ?? "";
  return respond(() => findCustomers(runId, name));
}
