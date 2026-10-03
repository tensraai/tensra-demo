import { getSimulatedCrm, removeSimulatedCrm } from "../crm/simulated";
import type { DealStage, EventStatus, IntegrationEvent, IntegrationRun } from "../types";

/** What a HubSpot "deal stage changed" webhook boils down to. */
export interface DealWebhookEvent {
  eventId: string;
  dealId: string;
  stage: DealStage;
}

export interface PipelineConfig {
  delaysMs: number[];
  sleep: (ms: number) => Promise<void>;
}

export type EventListener = (event: IntegrationEvent) => void;

export interface PipelineRecord {
  runId: string;
  run: IntegrationRun | null;
  events: IntegrationEvent[];
  subscribers: Set<EventListener>;
  /** Idempotency keys already received for this run. */
  keys: Set<string>;
  lastEvent?: DealWebhookEvent;
  config: PipelineConfig;
  /** Resolves when the latest ERP → CRM status sync has finished. */
  pendingSync?: Promise<void>;
  createdAt: number;
}

const g = globalThis as unknown as { __tensraPipeline?: Map<string, PipelineRecord> };
const records: Map<string, PipelineRecord> = (g.__tensraPipeline ??= new Map());

const MAX_AGE_MS = 30 * 60 * 1000;

/** Deletes runs older than 30 minutes. */
export function pruneRecords(now = Date.now()): void {
  for (const [id, r] of records) {
    if (now - r.createdAt > MAX_AGE_MS) {
      records.delete(id);
      removeSimulatedCrm(id);
    }
  }
}

export function recordCount(): number {
  return records.size;
}

export function createRecord(runId: string, config: PipelineConfig): PipelineRecord {
  const now = Date.now();
  pruneRecords(now);
  const record: PipelineRecord = {
    runId,
    run: null,
    events: [],
    subscribers: new Set(),
    keys: new Set(),
    config,
    createdAt: now,
  };
  records.set(runId, record);
  return record;
}

export function hasRecord(runId: string): boolean {
  return records.has(runId);
}

export function getRecord(runId: string): PipelineRecord {
  const r = records.get(runId);
  if (!r) throw new Error(`No pipeline run "${runId}". Start one first.`);
  return r;
}

export function resetPipeline(runId: string): void {
  records.delete(runId);
  removeSimulatedCrm(runId);
}

export function emitEvent(
  record: PipelineRecord,
  step: IntegrationEvent["step"],
  status: EventStatus,
  message: string,
  payload?: unknown,
): IntegrationEvent {
  const event: IntegrationEvent = {
    runId: record.runId,
    step,
    status,
    message,
    timestamp: new Date().toISOString(),
    payload,
  };
  record.events.push(event);
  for (const fn of record.subscribers) {
    try {
      fn(event);
    } catch {
      /* a broken subscriber must never break the pipeline */
    }
  }
  return event;
}

/** Live event feed (Phase 3 streams this over SSE). Returns an unsubscribe function. */
export function subscribe(runId: string, fn: EventListener): () => void {
  const record = getRecord(runId);
  record.subscribers.add(fn);
  return () => record.subscribers.delete(fn);
}

export { getSimulatedCrm };
