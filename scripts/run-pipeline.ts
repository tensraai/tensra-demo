// Runs the whole pipeline in the terminal and prints the event log.
//   npm run demo:run                    happy path + duplicate webhook + ERP fulfils the order
//   npm run demo:run -- failure         ERP fails 3 times, then recovers
//   npm run demo:run -- exhausted       ERP fails 6 times: dead-letter, then manual replay
//   npm run demo:run -- missing-type    validation failure (no customer type)
// Add --fast to shorten the backoff delays.
import {
  DEFAULT_DELAYS_MS, getRecord, markOrderFulfilled, prepareDemoRun,
  replayRun, resendWebhook, sendWebhook, subscribe,
} from "../lib/pipeline";
import type { DemoOptions } from "../lib/pipeline";
import type { IntegrationEvent } from "../lib/types";

const args = process.argv.slice(2);
const scenario = args.find((a) => !a.startsWith("--")) ?? "happy";
const fast = args.includes("--fast");

const SCENARIOS: Record<string, DemoOptions> = {
  happy: {},
  failure: { failures: 3 },
  exhausted: { failures: 6 },
  "missing-type": { scenario: "missing_customer_type" },
};
if (!SCENARIOS[scenario]) {
  console.error(`Unknown scenario "${scenario}". Use: ${Object.keys(SCENARIOS).join(", ")}`);
  process.exit(1);
}

const ICON = { ok: "✓", error: "✕", retry: "↻", info: "•" } as const;
const print = (e: IntegrationEvent) =>
  console.log(`${new Date(e.timestamp).toTimeString().slice(0, 8)}  ${ICON[e.status]}  ${e.message}`);
const section = (title: string) => console.log(`\n── ${title} ${"─".repeat(Math.max(0, 52 - title.length))}`);

async function main() {
  const runId = `cli-${Date.now()}`;
  const { event } = prepareDemoRun(runId, {
    ...SCENARIOS[scenario],
    delaysMs: fast ? DEFAULT_DELAYS_MS.map((d) => d / 10) : DEFAULT_DELAYS_MS,
  });
  subscribe(runId, print);

  section(`Scenario: ${scenario}`);
  let run = await sendWebhook(runId, event);

  if (scenario === "happy") {
    section("Same webhook delivered again");
    await resendWebhook(runId);
    section("ERP marks the order Fulfilled");
    await markOrderFulfilled(runId);
  }
  if (run.status === "Failed" && scenario === "exhausted") {
    section("Manual replay from dead-letter");
    run = await replayRun(runId);
  }

  const r = getRecord(runId).run!;
  section("Result");
  console.log(`status: ${r.status} | retries: ${r.retries} | ERP order: ${r.erpOrderId ?? "-"}${r.failureReason ? ` | reason: ${r.failureReason}` : ""}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
