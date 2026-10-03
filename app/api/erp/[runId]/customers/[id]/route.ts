import { respond, type RunIdCtx } from "@/lib/erp/http";
import { getCustomer } from "@/lib/erp/service";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: RunIdCtx) {
  const { runId, id } = await params;
  return respond(() => getCustomer(runId, id));
}
