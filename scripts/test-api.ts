import assert from "node:assert/strict";
import { MAX_RUNS, createEventStream, handleAction, handleReset, handleStart, handleState } from "../lib/demo/api";
import { createLimiter } from "../lib/demo/ratelimit";
import { getDemoState } from "../lib/pipeline";

let n = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  await fn();
  n++;
  console.log("✓", name);
}

/** No real waiting: backoff delays are recorded, not slept. */
const fast = { sleep: async () => {} };
const err = (r: { body: unknown }) => (r.body as { error: { code: string } }).error.code;

/** Reads an SSE stream until `done(text)` is true. */
async function collect(stream: ReadableStream<Uint8Array>, done: (text: string) => boolean, ms = 3000) {
  const reader = stream.getReader();
  const dec = new TextDecoder();
  let text = "";
  while (!done(text)) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, rej) => (timer = setTimeout(() => rej(new Error("stream timeout")), ms)));
    const chunk = await Promise.race([reader.read(), timeout]);
    clearTimeout(timer);
    if (chunk.done) break;
    text += dec.decode(chunk.value);
  }
  reader.releaseLock();
  return text;
}

async function main() {
  await test("start: rejects bad run id, scenario and failures", () => {
    assert.equal(err(handleStart("bad id!", {})), "INVALID_RUN_ID");
    assert.equal(err(handleStart("a1", { scenario: "nope" })), "INVALID_SCENARIO");
    assert.equal(err(handleStart("a1", { failures: 99 })), "INVALID_FAILURES");
    assert.equal(err(handleStart("a1", { failures: 1.5 })), "INVALID_FAILURES");
    assert.equal(handleStart("a1", [] as unknown).status, 400);
  });

  await test("start: returns 202 and the pipeline completes in the background", async () => {
    const r = handleStart("t-start", {}, fast);
    assert.equal(r.status, 202);
    assert.ok(r.background);
    await r.background!();
    const s = handleState("t-start");
    assert.equal(s.status, 200);
    assert.equal((s.body as any).run.status, "Synced");
  });

  await test("start: refuses a second start while a run is in progress", async () => {
    const r = handleStart("t-busy", {}, fast);
    const p = r.background!(); // runs synchronously up to its first await, so status is Running now
    assert.equal(handleStart("t-busy", {}, fast).status, 409);
    assert.equal(handleReset("t-busy").status, 409);
    await p;
    assert.equal(handleStart("t-busy", {}, fast).status, 202); // fine once finished
  });

  await test("start: a double-click before the first start begins is refused", () => {
    assert.equal(handleStart("t-dbl", {}, fast).status, 202);
    assert.equal(handleStart("t-dbl", {}, fast).status, 409);
  });

  await test("state: 404 for unknown run", () => {
    assert.equal(handleState("never-started").status, 404);
  });

  await test("actions: validation and not-allowed cases", async () => {
    assert.equal((await handleAction("nope-run", { action: "fulfil" })).status, 404);
    await handleStart("t-act", {}, fast).background!();
    assert.equal((await handleAction("t-act", { action: "bogus" })).status, 400);
    assert.equal((await handleAction("t-act", null)).status, 400);
    assert.equal((await handleAction("t-act", { action: "replay" })).status, 409); // not failed
  });

  await test("actions: resend is ignored, fulfil syncs to HubSpot", async () => {
    await handleStart("t-flow", {}, fast).background!();
    const resend = await handleAction("t-flow", { action: "resend" });
    assert.equal(resend.status, 200);
    assert.ok(getDemoState("t-flow")!.events.at(-1)!.message.includes("Duplicate webhook ignored"));
    const fulfil = await handleAction("t-flow", { action: "fulfil" });
    assert.equal(fulfil.status, 200);
    assert.equal(getDemoState("t-flow")!.deal!.erp_status, "Fulfilled");
    assert.equal((await handleAction("t-flow", { action: "fulfil" })).status, 409); // already fulfilled
  });

  await test("actions: fulfil before an order exists is rejected", async () => {
    await handleStart("t-early", { scenario: "missing_customer_type" }, fast).background!();
    const r = await handleAction("t-early", { action: "fulfil" });
    assert.equal(r.status, 409);
  });

  await test("failure scenario + dead-letter replay through the API", async () => {
    const r = handleStart("t-dead", { failures: 6 }, fast);
    await r.background!();
    assert.equal((handleState("t-dead").body as any).run.status, "Failed");
    const replay = await handleAction("t-dead", { action: "replay" });
    assert.equal(replay.status, 202);
    await replay.background!();
    assert.equal((handleState("t-dead").body as any).run.status, "Recovered");
  });

  await test("reset removes the run", async () => {
    await handleStart("t-reset", {}, fast).background!();
    assert.equal(handleReset("t-reset").status, 200);
    assert.equal(handleState("t-reset").status, 404);
  });

  await test("SSE: streams events live, then state, with ids", async () => {
    const r = handleStart("t-sse", {}, fast);
    const ctrl = new AbortController();
    const stream = createEventStream("t-sse", -1, ctrl.signal, 50);
    const running = r.background!();
    const text = await collect(stream, (t) => t.includes("Synced —") && t.includes('"integration_status":"Synced"'));
    await running;
    assert.ok(text.includes("id: 0\nevent: log"));
    assert.ok(text.includes("event: state"));
    assert.ok(text.includes("Webhook received"));
    ctrl.abort();
  });

  await test("SSE: reconnect with Last-Event-ID skips events already seen", async () => {
    const ctrl = new AbortController();
    const text = await collect(createEventStream("t-sse", 3, ctrl.signal, 50), (t) => t.includes("Synced —"));
    assert.ok(!text.includes("id: 3\n"));
    assert.ok(text.includes("id: 4\n"));
    ctrl.abort();
  });

  await test("SSE: tells the client when the run was reset", async () => {
    await handleStart("t-close", {}, fast).background!();
    const stream = createEventStream("t-close", -1, undefined, 30);
    handleReset("t-close");
    const text = await collect(stream, (t) => t.includes("event: closed"));
    assert.ok(text.includes("event: closed"));
  });

  await test("rate limiter: blocks over the limit, frees up after the window", () => {
    const l = createLimiter(3, 1000);
    assert.equal(l.check("a", 0).ok, true);
    assert.equal(l.check("a", 100).ok, true);
    assert.equal(l.check("a", 200).ok, true);
    const blocked = l.check("a", 300);
    assert.equal(blocked.ok, false);
    assert.equal(blocked.retryAfterSec, 1);
    assert.equal(l.check("b", 300).ok, true); // other visitors unaffected
    assert.equal(l.check("a", 1100).ok, true); // window passed
  });

  await test("capacity: refuses new runs when the server is full", () => {
    let refused = 0;
    for (let i = 0; i < MAX_RUNS + 5; i++) if (handleStart(`cap-${i}`, {}, fast).status === 503) refused++;
    assert.ok(refused >= 1);
  });

  console.log(`\n${n} checks passed`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("✗ FAILED:", e);
    process.exit(1);
  });
