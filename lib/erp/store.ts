import type { ErpCustomer, ErpOrder } from "../types";

export interface RunStore {
  customers: Map<string, ErpCustomer>;
  orders: Map<string, ErpOrder>;
  /** The next N data requests will fail with 503 (failure injection). */
  failuresRemaining: number;
  failuresInjected: number;
  nextCustomerNum: number;
  nextOrderNum: number;
  touchedAt: number;
}

export type OrderStatusListener = (order: ErpOrder, previousStatus: ErpOrder["status"]) => void;

interface GlobalState {
  runs: Map<string, RunStore>;
  listeners: Map<string, Set<OrderStatusListener>>;
}

// Stored on globalThis so state survives Next.js hot reloads and is shared across route files.
const g = globalThis as unknown as { __tensraErp?: GlobalState };
const state: GlobalState = (g.__tensraErp ??= { runs: new Map(), listeners: new Map() });

const RUN_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_RUN_AGE_MS = 30 * 60 * 1000; // 30 minutes

export function isValidRunId(runId: string): boolean {
  return RUN_ID_PATTERN.test(runId);
}

function pruneOldRuns(now: number) {
  for (const [id, run] of state.runs) {
    if (now - run.touchedAt > MAX_RUN_AGE_MS) {
      state.runs.delete(id);
      state.listeners.delete(id);
    }
  }
}

/** Gets (or lazily creates) the isolated ERP data for one demo run. */
export function getRun(runId: string): RunStore {
  const now = Date.now();
  let run = state.runs.get(runId);
  if (!run) {
    pruneOldRuns(now);
    run = {
      customers: new Map(),
      orders: new Map(),
      failuresRemaining: 0,
      failuresInjected: 0,
      nextCustomerNum: 8472,
      nextOrderNum: 10482,
      touchedAt: now,
    };
    state.runs.set(runId, run);
  }
  run.touchedAt = now;
  return run;
}

export function resetRun(runId: string): void {
  state.runs.delete(runId);
  state.listeners.delete(runId);
}

/** Subscribe to order status changes in a run (used later for ERP → CRM two-way sync). */
export function onOrderStatusChange(runId: string, listener: OrderStatusListener): () => void {
  let set = state.listeners.get(runId);
  if (!set) state.listeners.set(runId, (set = new Set()));
  set.add(listener);
  return () => set!.delete(listener);
}

export function emitOrderStatusChange(runId: string, order: ErpOrder, previous: ErpOrder["status"]) {
  state.listeners.get(runId)?.forEach((fn) => fn({ ...order }, previous));
}
