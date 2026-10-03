import { isValidRunId, resetRun as resetErpRun } from "../erp/store";
import {
  getDemoState, getRecord, hasRecord, markOrderFulfilled, prepareDemoRun,
  replayRun, resendWebhook, sendWebhook, subscribe,
} from "../pipeline";
import type { DemoOptions } from "../pipeline";
import { pruneRecords, recordCount, resetPipeline } from "../pipeline/runs";

/** Most demo runs kept in memory at once; protects the server from floods. */
export const MAX_RUNS = 200;

/**
 * What a route handler should send back. `background` is work that keeps running after the
 * response (the pipeline itself): the route schedules it, the browser watches it over SSE.
 */
export interface ApiResult {
  status: number;
  body: unknown;
  background?: () => Promise<unknown>;
}

const fail = (status: number, code: string, message: string): ApiResult => ({
  status,
  body: { error: { code, message } },
});

const SCENARIOS = ["valid", "missing_customer_type"] as const;
type Scenario = (typeof SCENARIOS)[number];

function checkRunId(runId: string): ApiResult | null {
  return isValidRunId(runId) ? null : fail(400, "INVALID_RUN_ID", "Invalid run id");
}

/** True from the moment a run is prepared until it finishes, so a double-click cannot start two. */
function isBusy(runId: string): boolean {
  if (!hasRecord(runId)) return false;
  const run = getRecord(runId).run;
  return run === null || run.status === "Running";
}

function isRunning(runId: string): boolean {
  return hasRecord(runId) && getRecord(runId).run?.status === "Running";
}

/** POST /api/demo/:runId/start   { scenario?: "valid" | "missing_customer_type", failures?: 0-10 } */
export function handleStart(
  runId: string,
  body: unknown,
  overrides: Pick<DemoOptions, "delaysMs" | "sleep"> = {},
): ApiResult {
  const bad = checkRunId(runId);
  if (bad) return bad;

  const b = body ?? {};
  if (typeof b !== "object" || Array.isArray(b)) return fail(400, "INVALID_BODY", "Body must be a JSON object");
  const { scenario = "valid", failures = 0 } = b as { scenario?: unknown; failures?: unknown };

  if (!SCENARIOS.includes(scenario as Scenario)) {
    return fail(400, "INVALID_SCENARIO", `scenario must be one of: ${SCENARIOS.join(", ")}`);
  }
  if (!Number.isInteger(failures) || (failures as number) < 0 || (failures as number) > 10) {
    return fail(400, "INVALID_FAILURES", "failures must be a whole number from 0 to 10");
  }
  if (isBusy(runId)) return fail(409, "RUN_IN_PROGRESS", "A run is already in progress. Wait for it to finish.");

  pruneRecords();
  if (!hasRecord(runId) && recordCount() >= MAX_RUNS) {
    return fail(503, "DEMO_BUSY", "The demo is busy right now. Please try again in a minute.");
  }

  const { event } = prepareDemoRun(runId, {
    scenario: scenario as Scenario,
    failures: failures as number,
    ...overrides,
  });
  return {
    status: 202,
    body: { runId, eventId: event.eventId, scenario, failures },
    background: () => sendWebhook(runId, event),
  };
}

/** GET /api/demo/:runId   -> run, events, HubSpot deal, ERP customers/orders */
export function handleState(runId: string): ApiResult {
  const bad = checkRunId(runId);
  if (bad) return bad;
  const state = getDemoState(runId);
  return state ? { status: 200, body: state } : fail(404, "NOT_FOUND", "No run with this id. Start one first.");
}

/** DELETE /api/demo/:runId */
export function handleReset(runId: string): ApiResult {
  const bad = checkRunId(runId);
  if (bad) return bad;
  if (isRunning(runId)) return fail(409, "RUN_IN_PROGRESS", "A run is in progress. Wait for it to finish, then reset.");
  resetErpRun(runId);
  resetPipeline(runId);
  return { status: 200, body: { ok: true } };
}

/** POST /api/demo/:runId/actions   { action: "fulfil" | "resend" | "replay" } */
export async function handleAction(runId: string, body: unknown): Promise<ApiResult> {
  const bad = checkRunId(runId);
  if (bad) return bad;
  if (!hasRecord(runId)) return fail(404, "NOT_FOUND", "No run with this id. Start one first.");

  const action = (body as { action?: unknown } | null)?.action;
  try {
    switch (action) {
      case "fulfil":
        await markOrderFulfilled(runId);
        return { status: 200, body: { ok: true, action } };
      case "resend": {
        const run = await resendWebhook(runId);
        return { status: 200, body: { ok: true, action, runStatus: run.status } };
      }
      case "replay": {
        if (getRecord(runId).run?.status !== "Failed") {
          return fail(409, "ACTION_NOT_ALLOWED", "Only failed runs can be replayed");
        }
        return { status: 202, body: { ok: true, action }, background: () => replayRun(runId) };
      }
      default:
        return fail(400, "INVALID_ACTION", 'action must be "fulfil", "resend" or "replay"');
    }
  } catch (err) {
    return fail(409, "ACTION_NOT_ALLOWED", err instanceof Error ? err.message : "Action failed");
  }
}

/**
 * Server-Sent Events feed for a run.
 *   id: N / event: log    one pipeline event (replayed from `afterId` + 1, then live)
 *   event: state          HubSpot deal + ERP customers/orders, after every log event
 *   event: closed         the run was reset or replaced; reconnect after starting a new one
 * Throws if the run does not exist (check hasRecord first).
 */
export function createEventStream(
  runId: string,
  afterId = -1,
  signal?: AbortSignal,
  heartbeatMs = 15000,
): ReadableStream<Uint8Array> {
  const record = getRecord(runId);
  const enc = new TextEncoder();
  let cleanup = () => {};

  return new ReadableStream<Uint8Array>({
    start(controller) {
      let sent = afterId;
      let closed = false;

      const write = (text: string) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(text));
        } catch {
          cleanup();
        }
      };

      const flush = () => {
        for (let i = sent + 1; i < record.events.length; i++) {
          write(`id: ${i}\nevent: log\ndata: ${JSON.stringify(record.events[i])}\n\n`);
          sent = i;
        }
        const full = getDemoState(runId);
        if (full) {
          const { events, ...state } = full;
          write(`event: state\ndata: ${JSON.stringify(state)}\n\n`);
        }
      };

      const unsubscribe = subscribe(runId, flush);
      const timer = setInterval(() => {
        if (!hasRecord(runId) || getRecord(runId) !== record) {
          write("event: closed\ndata: {}\n\n");
          cleanup();
        } else {
          write(": ping\n\n");
        }
      }, heartbeatMs);

      cleanup = () => {
        if (closed) return;
        closed = true;
        unsubscribe();
        clearInterval(timer);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      signal?.addEventListener("abort", cleanup);
      write("retry: 2000\n\n");
      flush();
    },
    cancel() {
      cleanup();
    },
  });
}
