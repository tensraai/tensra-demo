import { respond, type RunCtx } from "@/lib/erp/http";
import { listProducts } from "@/lib/erp/service";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, _ctx: RunCtx) {
  return respond(() => listProducts());
}
