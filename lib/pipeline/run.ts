import type { CrmAdapter } from "../crm/adapter";
import { ErpError } from "../erp/service";
import type { ErpOrder, EventStatus, IntegrationEvent, IntegrationRun, IntegrationStatus } from "../types";
import type { ErpClient } from "./erp-client";
import { mapDealToErp, type MappedDeal } from "./mapping";
import { RetryFailure, isRetryable, withRetry } from "./retry";
import { emitEvent, getRecord, type DealWebhookEvent, type PipelineRecord } from "./runs";
import { validateDeal } from "./validate";

export interface PipelineDeps {
  crm: CrmAdapter;
  erp: ErpClient;
}

interface Ctx {
  record: PipelineRecord;
  run: IntegrationRun;
  deps: PipelineDeps;
}

/** A step failed for good (validation error, rejected request, or retries exhausted). */
class PipelineFailure extends Error {
  constructor(
    public reason: string,
    public step: IntegrationEvent["step"],
    public original?: unknown,
  ) {
    super(reason);
  }
}

const say = (ctx: Ctx, step: IntegrationEvent["step"], status: EventStatus, message: string, payload?: unknown) =>
  emitEvent(ctx.record, step, status, message, payload);

function describe(err: unknown) {
  const e = err as { status?: number; code?: string; message?: string } | null;
  return { status: e?.status, code: e?.code, message: e?.message ?? String(err) };
}

const money = (n: number) => `$${n.toLocaleString("en-US")}`;
const plural = (n: number) => `${n} ${n === 1 ? "retry" : "retries"}`;

/** Runs one external call with retry + backoff, logging every failed attempt. */
async function call<T>(ctx: Ctx, system: "erp" | "crm", label: string, fn: () => Promise<T>): Promise<T> {
  const requestStep = system === "erp" ? "erp_request" : "crm_request";
  const sysName = system === "erp" ? "ERP" : "HubSpot";
  try {
    const { value, retries } = await withRetry(fn, {
      delaysMs: ctx.record.config.delaysMs,
      sleep: ctx.record.config.sleep,
      isRetryable,
      onAttemptFailed: ({ attempt, error, retryable, willRetry, nextDelayMs }) => {
        if (!retryable) return; // expected errors (409/422) are handled by the caller
        if (willRetry) ctx.run.retries++;
        const d = describe(error);
        const code = [d.status, d.code].filter(Boolean).join(" ");
        const tail = willRetry ? ` — retrying in ${nextDelayMs! / 1000}s` : " — retries exhausted";
        if (attempt === 0) say(ctx, requestStep, "error", `${label} failed (${code})${tail}`);
        else say(ctx, "retry", "error", `Retry #${attempt} failed (${code})${tail}`);
      },
    });
    if (retries > 0) say(ctx, "retry", "ok", `Retry #${retries} succeeded — ${label}`);
    return value;
  } catch (err) {
    if (!(err instanceof RetryFailure)) throw err;
    const d = describe(err.original);
    if (err.retryable) {
      const code = [d.status, d.code].filter(Boolean).join(" ");
      throw new PipelineFailure(`${sysName} unavailable after ${plural(err.retries)} (${code})`, requestStep, err.original);
    }
    throw new PipelineFailure(`${sysName} rejected the request: ${d.message}`, requestStep, err.original);
  }
}

/** If an ERP call lost a race and got a 409, returns the id of the record that already exists. */
function conflictId(err: unknown, code: string): string | undefined {
  if (err instanceof PipelineFailure && err.original instanceof ErpError) {
    if (err.original.status === 409 && err.original.code === code) return err.original.details?.existingId;
  }
  return undefined;
}

async function failRun(ctx: Ctx, reason: string) {
  ctx.run.status = "Failed";
  ctx.run.failureReason = reason;
  try {
    await ctx.deps.crm.updateDeal(ctx.run.dealId, { integration_status: "Failed" });
  } catch {
    /* CRM write-back is best effort when already failing */
  }
  // Emit last: listeners (the UI) snapshot state on each event, so HubSpot must already show Failed.
  say(ctx, "failed", "error", `Integration failed — ${reason}`);
}

async function resolveCustomer(ctx: Ctx, mapped: MappedDeal): Promise<string> {
  const name = mapped.customer.customerName;
  const found = await call(ctx, "erp", "ERP customer lookup", () => ctx.deps.erp.findCustomers(name));
  if (found.length > 0) {
    ctx.run.erpCustomerId = found[0].id;
    say(ctx, "customer_resolved", "ok", `Customer found — ${name} (${found[0].id}), reusing existing record`);
    return found[0].id;
  }
  try {
    const created = await call(ctx, "erp", "ERP customer create", () => ctx.deps.erp.createCustomer(mapped.customer));
    ctx.run.erpCustomerId = created.id;
    say(ctx, "customer_resolved", "ok", `Customer not found — created ${name} (${created.id})`);
    return created.id;
  } catch (err) {
    const existing = conflictId(err, "DUPLICATE_CUSTOMER");
    if (!existing) throw err;
    ctx.run.erpCustomerId = existing;
    say(ctx, "customer_resolved", "ok", `Customer already created by another request — using ${existing}`);
    return existing;
  }
}

async function resolveOrder(ctx: Ctx, mapped: MappedDeal, customerId: string): Promise<string> {
  const ref = mapped.order.externalRef;
  const found = await call(ctx, "erp", "ERP order lookup", () => ctx.deps.erp.findOrders(ref));
  if (found.length > 0) {
    ctx.run.erpOrderId = found[0].id;
    say(ctx, "order_created", "ok", `Order already exists — ${found[0].id} for deal ${ref}, no duplicate created`);
    return found[0].id;
  }
  try {
    const order = await call(ctx, "erp", "ERP order create", () =>
      ctx.deps.erp.createOrder({ ...mapped.order, customerId }),
    );
    ctx.run.erpOrderId = order.id;
    say(ctx, "order_created", "ok", `ERP order created — ${order.id} (${money(order.orderTotal)})`, { order });
    return order.id;
  } catch (err) {
    const existing = conflictId(err, "DUPLICATE_ORDER");
    if (!existing) throw err;
    ctx.run.erpOrderId = existing;
    say(ctx, "order_created", "ok", `Order already created by another request — using ${existing}`);
    return existing;
  }
}

/**
 * HubSpot webhook → ERP order → HubSpot write-back.
 * Never throws for business failures: the outcome is on the returned run (status + failureReason).
 */
export async function runPipeline(runId: string, event: DealWebhookEvent, deps: PipelineDeps): Promise<IntegrationRun> {
  const record = getRecord(runId);
  const key = `${event.dealId}:${event.eventId}`;
  const existing = record.run;

  // Idempotency: a repeated webhook must not run twice. Failed runs may be replayed.
  if (existing && record.keys.has(key) && existing.status !== "Failed") {
    emitEvent(record, "webhook_received", "info", `Duplicate webhook ignored — idempotency key ${key} already processed (${existing.status})`);
    return existing;
  }
  // Concurrency: only one pipeline pass at a time per run (e.g. a double-clicked button).
  if (existing && existing.status === "Running") {
    emitEvent(record, "webhook_received", "info", `Webhook ignored — a run is already in progress (${key})`);
    return existing;
  }
  const isReplay = !!existing && record.keys.has(key);
  record.keys.add(key);
  record.lastEvent = event;

  const run: IntegrationRun = {
    id: runId,
    dealId: event.dealId,
    idempotencyKey: key,
    status: "Running",
    retries: 0,
    createdAt: new Date().toISOString(),
  };
  record.run = run;
  const ctx: Ctx = { record, run, deps };

  say(
    ctx,
    "webhook_received",
    "ok",
    isReplay
      ? `Replaying failed run — deal ${event.dealId}`
      : `Webhook received — deal ${event.dealId} moved to ${event.stage}`,
  );

  if (event.stage !== "Closed Won") {
    run.status = "Pending";
    say(ctx, "webhook_received", "info", `Ignored — stage is "${event.stage}", only Closed Won triggers an order`);
    return run;
  }

  try {
    const deal = await call(ctx, "crm", "HubSpot deal fetch", () => deps.crm.fetchDeal(event.dealId));
    say(ctx, "deal_retrieved", "ok", `Deal retrieved — ${deal.name} · ${deal.company.company_name} · ${money(deal.deal_amount)}`, { deal });
    await call(ctx, "crm", "HubSpot status update", () => deps.crm.updateDeal(deal.id, { integration_status: "Running" }));

    const validation = validateDeal(deal);
    if (!validation.ok) {
      say(ctx, "validated", "error", `Validation failed — ${validation.reason}`, { checks: validation.checks });
      throw new PipelineFailure(validation.reason!, "validated");
    }
    say(ctx, "validated", "ok", `Validated — ${validation.checks.length} checks passed`, { checks: validation.checks });

    const mapped = mapDealToErp(deal);
    say(ctx, "fields_mapped", "ok", `Mapped ${mapped.pairs.length} fields HubSpot → ERP`, { pairs: mapped.pairs });

    const customerId = await resolveCustomer(ctx, mapped);
    const orderId = await resolveOrder(ctx, mapped, customerId);

    const final: IntegrationStatus = run.retries > 0 ? "Recovered" : "Synced";
    await call(ctx, "crm", "HubSpot write-back", () =>
      deps.crm.updateDeal(deal.id, { erp_order_id: orderId, erp_status: "Created", integration_status: final }),
    );
    say(ctx, "crm_updated", "ok", `HubSpot updated — ERP Order ID ${orderId}, status ${final}`);

    run.status = final;
    if (run.retries > 0) say(ctx, "recovered", "ok", `Workflow recovered after ${plural(run.retries)}`);
    say(ctx, "synced", "ok", `Synced — deal ${deal.id} ↔ ${orderId}`);
  } catch (err) {
    if (err instanceof PipelineFailure) await failRun(ctx, err.reason);
    else await failRun(ctx, `Unexpected error: ${describe(err).message}`);
  }
  return run;
}

/**
 * ERP → HubSpot: when the ERP order status changes, mirror it onto the deal.
 * Loop protection: only the run's own order is handled, and unchanged values are skipped.
 */
export async function syncErpStatusToCrm(
  runId: string,
  order: ErpOrder,
  previous: ErpOrder["status"],
  deps: PipelineDeps,
): Promise<void> {
  const record = getRecord(runId);
  const run = record.run;
  if (!run || run.erpOrderId !== order.id) return;
  const ctx: Ctx = { record, run, deps };

  say(ctx, "erp_status_synced", "info", `ERP webhook — ${order.id} ${previous} → ${order.status}`);
  if (order.status === "Cancelled") {
    say(ctx, "erp_status_synced", "info", "Cancelled orders are not mirrored to HubSpot in this demo");
    return;
  }
  const status = order.status; // "Pending" | "Fulfilled" here
  try {
    const deal = await call(ctx, "crm", "HubSpot deal fetch", () => deps.crm.fetchDeal(run.dealId));
    if (deal.erp_status === status) {
      say(ctx, "erp_status_synced", "info", `HubSpot already shows ${status} — skipped (loop protection)`);
      return;
    }
    await call(ctx, "crm", "HubSpot status update", () => deps.crm.updateDeal(run.dealId, { erp_status: status }));
    say(ctx, "erp_status_synced", "ok", `HubSpot updated — ERP Status: ${status}`);
  } catch (err) {
    const reason = err instanceof PipelineFailure ? err.reason : describe(err).message;
    say(ctx, "erp_status_synced", "error", `Could not sync ERP status to HubSpot — ${reason}`);
  }
}
