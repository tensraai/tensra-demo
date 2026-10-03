import { createSimulatedCrm, getSimulatedCrm } from "../crm/simulated";
import { DEMO_DEAL, DEMO_DEAL_MISSING_TYPE } from "../demo-data";
import { runSummary, setFailures, updateOrderStatus } from "../erp/service";
import { getRun as getErpRun, isValidRunId, onOrderStatusChange, resetRun as resetErpRun } from "../erp/store";
import type { IntegrationRun } from "../types";
import { createInProcessErpClient } from "./erp-client";
import { runPipeline, syncErpStatusToCrm, type PipelineDeps } from "./run";
import { DEFAULT_DELAYS_MS, realSleep } from "./retry";
import { createRecord, getRecord, hasRecord, type DealWebhookEvent } from "./runs";

export { DEFAULT_DELAYS_MS } from "./retry";
export { subscribe, getRecord, hasRecord } from "./runs";
export type { DealWebhookEvent } from "./runs";

export interface DemoOptions {
  /** "missing_customer_type" triggers the validation-failure demo. */
  scenario?: "valid" | "missing_customer_type";
  /** Make the first N ERP requests fail with 503 ("Simulate Failure"). */
  failures?: number;
  delaysMs?: number[];
  sleep?: (ms: number) => Promise<void>;
}

function buildDeps(runId: string): PipelineDeps {
  const crm = getSimulatedCrm(runId);
  if (!crm) throw new Error(`No simulated CRM for run "${runId}". Start a demo run first.`);
  return { crm, erp: createInProcessErpClient(runId) };
}

/** Resets everything for this run id and seeds a fresh simulated HubSpot deal. Does not start the pipeline. */
export function prepareDemoRun(runId: string, opts: DemoOptions = {}): { event: DealWebhookEvent } {
  if (!isValidRunId(runId)) throw new Error("Invalid run id");
  resetErpRun(runId); // also clears ERP listeners, so subscribe after this
  const deal = opts.scenario === "missing_customer_type" ? DEMO_DEAL_MISSING_TYPE : DEMO_DEAL;
  createSimulatedCrm(runId, deal);
  createRecord(runId, { delaysMs: opts.delaysMs ?? DEFAULT_DELAYS_MS, sleep: opts.sleep ?? realSleep });
  if (opts.failures) setFailures(runId, opts.failures);

  // ERP → HubSpot: mirror order status changes onto the deal.
  onOrderStatusChange(runId, (order, previous) => {
    const record = getRecord(runId);
    record.pendingSync = syncErpStatusToCrm(runId, order, previous, buildDeps(runId)).catch(() => {});
  });

  return {
    event: { eventId: `evt-${Date.now().toString(36)}`, dealId: deal.id, stage: "Closed Won" },
  };
}

/** Delivers a webhook to the pipeline (the simulated HubSpot "deal closed won" event). */
export function sendWebhook(runId: string, event: DealWebhookEvent): Promise<IntegrationRun> {
  return runPipeline(runId, event, buildDeps(runId));
}

export async function startDemoRun(runId: string, opts: DemoOptions = {}): Promise<IntegrationRun> {
  const { event } = prepareDemoRun(runId, opts);
  return sendWebhook(runId, event);
}

/** Re-sends the same webhook (same idempotency key). Should be ignored if already processed. */
export function resendWebhook(runId: string): Promise<IntegrationRun> {
  const event = getRecord(runId).lastEvent;
  if (!event) throw new Error("Nothing to resend yet");
  return sendWebhook(runId, event);
}

/** Dead-letter replay: re-runs a Failed run with its original event. */
export function replayRun(runId: string): Promise<IntegrationRun> {
  const record = getRecord(runId);
  if (record.run?.status !== "Failed" || !record.lastEvent) throw new Error("Only failed runs can be replayed");
  return sendWebhook(runId, record.lastEvent);
}

/** Simulates the ERP fulfilling the order; the status sync back to HubSpot runs via the ERP listener. */
export async function markOrderFulfilled(runId: string): Promise<void> {
  const record = getRecord(runId);
  const orderId = record.run?.erpOrderId;
  if (!orderId) throw new Error("No ERP order to fulfil yet");
  updateOrderStatus(runId, orderId, { status: "Fulfilled" });
  await record.pendingSync;
}

/** Everything the UI needs to draw the pipeline, both cards and the log. Reading does not trigger failure injection. */
export function getDemoState(runId: string) {
  if (!hasRecord(runId)) return null;
  const record = getRecord(runId);
  const erp = getErpRun(runId);
  return {
    run: record.run,
    events: record.events,
    deal: getSimulatedCrm(runId)?.snapshot() ?? null,
    customers: [...erp.customers.values()],
    orders: [...erp.orders.values()],
    erp: runSummary(runId),
  };
}
