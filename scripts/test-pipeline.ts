import assert from "node:assert/strict";
import { DEMO_DEAL } from "../lib/demo-data";
import { runSummary } from "../lib/erp/service";
import {
  getDemoState, markOrderFulfilled, prepareDemoRun, replayRun, resendWebhook, sendWebhook, startDemoRun,
} from "../lib/pipeline";
import { mapDealToErp } from "../lib/pipeline/mapping";
import { getRecord, subscribe } from "../lib/pipeline/runs";
import { getSimulatedCrm } from "../lib/crm/simulated";
import { validateDeal } from "../lib/pipeline/validate";

let n = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  await fn();
  n++;
  console.log("✓", name);
}

/** Fast runs: record the backoff delays instead of waiting. */
function fastOpts() {
  const sleeps: number[] = [];
  return { sleeps, sleep: async (ms: number) => void sleeps.push(ms) };
}
const steps = (runId: string) => getRecord(runId).events.map((e) => e.step);
const crm = (runId: string) => getDemoState(runId)!.deal!;

async function main() {
  await test("validation: demo deal passes every check", () => {
    const v = validateDeal(DEMO_DEAL);
    assert.equal(v.ok, true);
    assert.equal(v.checks.length, 10);
  });

  await test("validation: bad quantity and mismatched amount are caught", () => {
    const bad = structuredClone(DEMO_DEAL);
    bad.line_items[0].quantity = 0;
    assert.match(validateDeal(bad).reason!, /Quantity/);
    const mismatch = { ...structuredClone(DEMO_DEAL), deal_amount: 99 };
    assert.match(validateDeal(mismatch).reason!, /does not match/);
  });

  await test("mapping: HubSpot fields become ERP fields via FIELD_MAPPINGS", () => {
    const m = mapDealToErp(DEMO_DEAL);
    assert.equal(m.customer.customerName, "Acme Manufacturing");
    assert.equal(m.order.sku, "VALVE-500");
    assert.equal(m.order.quantity, 500);
    assert.equal(m.order.orderTotal, 25000);
    assert.equal(m.order.orderDate, "2026-10-03");
    assert.equal(m.order.externalRef, "12345");
    assert.equal(m.pairs.length, 9);
  });

  await test("happy path: deal becomes ERP order and HubSpot is updated", async () => {
    const { sleep, sleeps } = fastOpts();
    const run = await startDemoRun("t-happy", { sleep });
    assert.equal(run.status, "Synced");
    assert.equal(run.retries, 0);
    assert.equal(run.erpOrderId, "SO-10482");
    assert.equal(run.erpCustomerId, "ERP-8472");
    assert.deepEqual(steps("t-happy"), [
      "webhook_received", "deal_retrieved", "validated", "fields_mapped",
      "customer_resolved", "order_created", "crm_updated", "synced",
    ]);
    assert.equal(crm("t-happy").erp_order_id, "SO-10482");
    assert.equal(crm("t-happy").erp_status, "Created");
    assert.equal(crm("t-happy").integration_status, "Synced");
    assert.equal(sleeps.length, 0);
  });

  await test("validation failure: nothing is created in the ERP", async () => {
    const { sleep } = fastOpts();
    const run = await startDemoRun("t-invalid", { scenario: "missing_customer_type", sleep });
    assert.equal(run.status, "Failed");
    assert.equal(run.failureReason, "ERP Customer Type missing");
    const s = runSummary("t-invalid");
    assert.equal(s.customers, 0);
    assert.equal(s.orders, 0);
    assert.equal(crm("t-invalid").integration_status, "Failed");
    const ev = getRecord("t-invalid").events.find((e) => e.step === "validated")!;
    assert.equal(ev.status, "error");
  });

  await test("failure + recovery: 3 ERP failures, backoff 1s/2s/4s, order created once", async () => {
    const { sleep, sleeps } = fastOpts();
    const run = await startDemoRun("t-recover", { failures: 3, sleep });
    assert.equal(run.status, "Recovered");
    assert.equal(run.retries, 3);
    assert.deepEqual(sleeps, [1000, 2000, 4000]);
    assert.equal(runSummary("t-recover").orders, 1);
    assert.equal(crm("t-recover").integration_status, "Recovered");
    assert.ok(steps("t-recover").includes("recovered"));
  });

  await test("dead-letter: retries exhausted, then replay succeeds", async () => {
    const { sleep, sleeps } = fastOpts();
    const first = await startDemoRun("t-dead", { failures: 6, sleep });
    assert.equal(first.status, "Failed");
    assert.equal(first.retries, 3);
    assert.match(first.failureReason!, /ERP unavailable after 3 retries/);
    assert.equal(runSummary("t-dead").orders, 0);
    assert.equal(crm("t-dead").integration_status, "Failed");

    const replay = await replayRun("t-dead");
    assert.equal(replay.status, "Recovered");
    assert.equal(replay.retries, 2);
    assert.equal(runSummary("t-dead").orders, 1);
    assert.equal(runSummary("t-dead").failuresRemaining, 0);
    assert.equal(sleeps.length, 5);
  });

  await test("idempotency: same webhook delivered twice creates one order", async () => {
    const { sleep } = fastOpts();
    const run = await startDemoRun("t-dup", { sleep });
    const before = getRecord("t-dup").events.length;
    const again = await resendWebhook("t-dup");
    assert.equal(again, run);
    assert.equal(getRecord("t-dup").events.length, before + 1);
    assert.match(getRecord("t-dup").events.at(-1)!.message, /Duplicate webhook ignored/);
    assert.equal(runSummary("t-dup").orders, 1);
  });

  await test("duplicate prevention: a new event for the same deal reuses customer and order", async () => {
    const { sleep } = fastOpts();
    await startDemoRun("t-reuse", { sleep });
    const run = await sendWebhook("t-reuse", { eventId: "evt-second", dealId: "12345", stage: "Closed Won" });
    assert.equal(run.status, "Synced");
    assert.equal(run.erpOrderId, "SO-10482");
    const s = runSummary("t-reuse");
    assert.equal(s.customers, 1);
    assert.equal(s.orders, 1);
    assert.ok(getRecord("t-reuse").events.some((e) => /Order already exists/.test(e.message)));
  });

  await test("ignored stage: non-Closed-Won events do nothing", async () => {
    const { sleep } = fastOpts();
    const { event } = prepareDemoRun("t-open", { sleep });
    const run = await sendWebhook("t-open", { ...event, stage: "Open" });
    assert.equal(run.status, "Pending");
    assert.equal(runSummary("t-open").customers, 0);
  });

  await test("two-way sync: ERP Fulfilled is mirrored to HubSpot", async () => {
    const { sleep } = fastOpts();
    await startDemoRun("t-twoway", { sleep });
    await markOrderFulfilled("t-twoway");
    assert.equal(crm("t-twoway").erp_status, "Fulfilled");
    const last = getRecord("t-twoway").events.at(-1)!;
    assert.equal(last.step, "erp_status_synced");
    assert.equal(last.status, "ok");
  });

  await test("failed event is only emitted after HubSpot shows Failed (UI snapshot order)", async () => {
    const { sleep } = fastOpts();
    const { event } = prepareDemoRun("t-order", { scenario: "missing_customer_type", sleep });
    let seen = "";
    subscribe("t-order", (e) => {
      if (e.step === "failed") seen = getSimulatedCrm("t-order")!.snapshot().integration_status ?? "";
    });
    await sendWebhook("t-order", event);
    assert.equal(seen, "Failed");
  });

  await test("concurrent webhooks: the second is ignored instead of racing", async () => {
    const { sleep } = fastOpts();
    const { event } = prepareDemoRun("t-conc", { sleep });
    await Promise.all([
      sendWebhook("t-conc", event),
      sendWebhook("t-conc", { ...event, eventId: "evt-other" }),
    ]);
    const msgs = getRecord("t-conc").events.map((e) => e.message);
    assert.ok(msgs.some((m) => /already in progress/.test(m)));
    assert.ok(!msgs.some((m) => /another request/.test(m)));
    assert.equal(runSummary("t-conc").orders, 1);
  });

  await test("runs are isolated: another run sees nothing", () => {
    assert.equal(getDemoState("never-started"), null);
    assert.equal(runSummary("t-other").orders, 0);
  });

  console.log(`\n${n} checks passed`);
}

main().catch((e) => {
  console.error("✗ FAILED:", e);
  process.exit(1);
});
