// Drives the live demo API like the browser will: start -> watch SSE -> actions.
//   npm run smoke:demo                 happy path + duplicate webhook + fulfil
//   npm run smoke:demo -- failure      3 ERP failures, then recovery (about 7s)
//   npm run smoke:demo -- exhausted    6 failures, dead-letter, then replay
//   npm run smoke:demo -- missing-type validation failure
// Start the app first (npm run dev).
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const scenario = process.argv[2] ?? "happy";
const BODIES = {
  happy: {},
  failure: { failures: 3 },
  exhausted: { failures: 6 },
  "missing-type": { scenario: "missing_customer_type" },
};
if (!BODIES[scenario]) { console.error("Unknown scenario. Use:", Object.keys(BODIES).join(", ")); process.exit(1); }

const run = "smoke-" + Math.random().toString(36).slice(2, 8);
const api = (p) => `${BASE}/api/demo/${run}${p}`;
const ICON = { ok: "✓", error: "✕", retry: "↻", info: "•" };
const TERMINAL = ["Synced", "Recovered", "Failed"];

async function post(path, body) {
  const res = await fetch(api(path), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json();
  console.log(`\n>> POST ${path} ${JSON.stringify(body)} -> ${res.status}`);
  if (res.status >= 400) { console.error(JSON.stringify(data)); process.exit(1); }
  return data;
}

// Start, then listen
let waiter = null;
const waitTerminal = () => new Promise((r) => (waiter = r));
const first = waitTerminal();
await post("/start", BODIES[scenario]);

const ctrl = new AbortController();
const res = await fetch(api("/events"), { signal: ctrl.signal });
if (!res.ok) { console.error("SSE failed", res.status, await res.text()); process.exit(1); }

function onBlock(block) {
  let ev = "message", data = "";
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) ev = line.slice(6).trim();
    if (line.startsWith("data:")) data += line.slice(5).trim();
  }
  if (!data) return;
  const json = JSON.parse(data);
  if (ev === "log") {
    console.log(`${new Date(json.timestamp).toTimeString().slice(0, 8)}  ${ICON[json.status]}  ${json.message}`);
  } else if (ev === "state" && waiter && TERMINAL.includes(json.run?.status)) {
    const w = waiter; waiter = null; w(json);
  } else if (ev === "state") {
    lastState = json;
  }
}
let lastState = null;

(async () => {
  const dec = new TextDecoder();
  let buf = "";
  try {
    for await (const chunk of res.body) {
      buf += dec.decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) { onBlock(buf.slice(0, i)); buf = buf.slice(i + 2); }
    }
  } catch { /* aborted */ }
})();

let state = await first;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

if (scenario === "exhausted" && state.run.status === "Failed") {
  const next = waitTerminal();
  await post("/actions", { action: "replay" });
  state = await next;
}
if (scenario === "happy") {
  await post("/actions", { action: "resend" });
  await post("/actions", { action: "fulfil" });
}
await pause(400);
ctrl.abort();

const final = await (await fetch(api(""))).json();
console.log("\n── Final state ─────────────────────────────────────────");
console.log("run:     ", final.run.status, "| retries:", final.run.retries, final.run.failureReason ? `| ${final.run.failureReason}` : "");
console.log("HubSpot: ", JSON.stringify({ erp_order_id: final.deal.erp_order_id, erp_status: final.deal.erp_status, integration_status: final.deal.integration_status }));
console.log("ERP:     ", `${final.customers.length} customer(s), ${final.orders.length} order(s)`, final.orders[0] ? `${final.orders[0].id} (${final.orders[0].status})` : "");
process.exit(0);
