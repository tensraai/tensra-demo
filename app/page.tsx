"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CrmDeal, ErpCustomer, ErpOrder, IntegrationEvent, IntegrationRun } from "@/lib/types";

interface DemoState {
  run: IntegrationRun | null;
  deal: CrmDeal | null;
  customers: ErpCustomer[];
  orders: ErpOrder[];
}

// Pipeline strip: which log step lights up which node.
const NODES = [
  { step: "webhook_received", label: "Webhook", hint: "Deal closed won" },
  { step: "deal_retrieved", label: "Fetch deal", hint: "Read from HubSpot" },
  { step: "validated", label: "Validate", hint: "10 data checks" },
  { step: "fields_mapped", label: "Map fields", hint: "HubSpot → ERP" },
  { step: "customer_resolved", label: "Match customer", hint: "Find or create" },
  { step: "order_created", label: "Create order", hint: "Once per deal" },
  { step: "crm_updated", label: "Write back", hint: "ERP ID to HubSpot" },
] as const;

const ICON = { ok: "✓", error: "✕", retry: "↻", info: "•" } as const;

function nodeStates(events: IntegrationEvent[], run: IntegrationRun | null) {
  // A replay or new run starts a fresh pass: only look at events since the last webhook start.
  const start = events.map((e) => e.step === "webhook_received" && e.status === "ok").lastIndexOf(true);
  const pass = start >= 0 ? events.slice(start) : [];
  const done = (s: string) => pass.some((e) => e.step === s && e.status === "ok");
  const firstOpen = NODES.findIndex((n) => !done(n.step));
  const retrying = pass.length > 0 && ["erp_request", "crm_request", "retry"].includes(pass[pass.length - 1].step) && pass[pass.length - 1].status === "error";
  return NODES.map((n, i) => {
    if (done(n.step)) return "done";
    if (pass.some((e) => e.step === n.step && e.status === "error")) return "error";
    if (i !== firstOpen || !run) return "";
    if (run.status === "Failed") return "error";
    if (run.status === "Running") return retrying ? "retry" : "active";
    return "";
  });
}

export default function Home() {
  const [runId, setRunId] = useState("");
  const [events, setEvents] = useState<IntegrationEvent[]>([]);
  const [state, setState] = useState<DemoState>({ run: null, deal: null, customers: [], orders: [] });
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);
  const es = useRef<EventSource | null>(null);
  const logEnd = useRef<HTMLDivElement>(null);

  useEffect(() => setRunId("run-" + Math.random().toString(36).slice(2, 10)), []);
  useEffect(() => () => es.current?.close(), []);
  useEffect(() => logEnd.current?.scrollIntoView?.({ block: "nearest" }), [events]);

  const api = useCallback(
    async (path: string, method: string, body?: unknown) => {
      setError("");
      const res = await fetch(`/api/demo/${runId}${path}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError(data?.error?.message ?? "Something went wrong. Try again.");
      return res.ok;
    },
    [runId],
  );

  function listen() {
    es.current?.close();
    const src = new EventSource(`/api/demo/${runId}/events`);
    src.addEventListener("log", (m) => {
      const id = Number((m as MessageEvent).lastEventId);
      const ev = JSON.parse((m as MessageEvent).data) as IntegrationEvent;
      setEvents((prev) => (prev.length > id ? prev : [...prev, ev]));
    });
    src.addEventListener("state", (m) => {
      const next = JSON.parse((m as MessageEvent).data) as DemoState;
      setState(next);
      if (next.run) setStarting(false);
    });
    src.addEventListener("closed", () => src.close());
    es.current = src;
  }

  async function start(body: object) {
    setStarting(true);
    setEvents([]);
    setState({ run: null, deal: null, customers: [], orders: [] });
    if (await api("/start", "POST", body)) listen();
    else setStarting(false);
  }

  async function reset() {
    es.current?.close();
    if (await api("", "DELETE")) {
      setEvents([]);
      setState({ run: null, deal: null, customers: [], orders: [] });
    }
  }

  const run = state.run;
  const busy = starting || run?.status === "Running";
  const canReplay = run?.status === "Failed" && /unavailable/.test(run.failureReason ?? "");
  const order = state.orders[0];
  const nodes = nodeStates(events, run);

  return (
    <main className="wrap">
      <h1>See a CRM → ERP integration in action</h1>
      <p className="sub">
        A simulated HubSpot deal becomes an ERP sales order, with validation, field mapping, duplicate protection,
        two-way sync and automatic recovery when the ERP fails. The server runs the real pipeline code.
      </p>

      <div className="bar">
        <button className="primary" disabled={!runId || busy} onClick={() => start({})}>Run demo</button>
        <button disabled={!runId || busy} onClick={() => start({ failures: 3 })}>Simulate ERP failure</button>
        <button disabled={!runId || busy} onClick={() => start({ failures: 6 })}>Simulate long ERP outage</button>
        <button disabled={!runId || busy} onClick={() => start({ scenario: "missing_customer_type" })}>Simulate bad data</button>
        <button disabled={!run || busy} onClick={() => api("/actions", "POST", { action: "resend" })}>Send webhook again</button>
        <button disabled={!order || order.status !== "Pending" || busy} onClick={() => api("/actions", "POST", { action: "fulfil" })}>Mark order fulfilled</button>
        <button disabled={!canReplay} onClick={() => api("/actions", "POST", { action: "replay" })}>Replay failed run</button>
        <button disabled={!run || busy} onClick={reset}>Reset</button>
      </div>
      {error && <p role="alert" style={{ color: "var(--bad)" }}>{error}</p>}

      <ol className="flow" aria-label="Pipeline steps">
        {NODES.map((n, i) => (
          <li key={n.step} className={`node ${nodes[i]}`}>
            <b>{n.label}</b>
            {n.hint}
          </li>
        ))}
      </ol>

      <div className="cards">
        <section className="card">
          <h2>HubSpot deal</h2>
          {state.deal ? (
            <dl>
              <dt>Deal</dt><dd>{state.deal.name}</dd>
              <dt>Customer</dt><dd>{state.deal.company.company_name}</dd>
              <dt>Amount</dt><dd>${state.deal.deal_amount.toLocaleString("en-US")} · {state.deal.payment_terms}</dd>
              <dt>ERP order ID</dt><dd>{state.deal.erp_order_id ?? "not set"}</dd>
              <dt>ERP status</dt><dd>{state.deal.erp_status ? <span className={`tag s-${state.deal.erp_status}`}>{state.deal.erp_status}</span> : "not set"}</dd>
              <dt>Integration</dt><dd>{state.deal.integration_status ? <span className={`tag s-${state.deal.integration_status}`}>{state.deal.integration_status}</span> : "not set"}</dd>
            </dl>
          ) : (
            <p className="empty">Press Run demo to close a deal in HubSpot.</p>
          )}
        </section>
        <section className="card">
          <h2>ERP sales order</h2>
          {order ? (
            <dl>
              <dt>Order</dt><dd>{order.id}</dd>
              <dt>Customer</dt><dd>{state.customers[0]?.customerName} ({order.customerId})</dd>
              <dt>Product</dt><dd>{order.quantity} × {order.sku}</dd>
              <dt>Total</dt><dd>${order.orderTotal.toLocaleString("en-US")}</dd>
              <dt>Status</dt><dd><span className={`tag s-${order.status}`}>{order.status}</span></dd>
            </dl>
          ) : (
            <p className="empty">{run?.status === "Failed" ? run.failureReason : "No order yet. The integration creates it."}</p>
          )}
        </section>
      </div>

      <div className="log" role="log" aria-live="polite" aria-label="Integration events">
        {events.length === 0 && <div>Events appear here as the integration runs.</div>}
        {events.map((e, i) => (
          <div key={i}>
            <time>{new Date(e.timestamp).toTimeString().slice(0, 8)}</time>
            <span className={`i-${e.status}`}>{ICON[e.status]}</span>
            <span>{e.message}</span>
          </div>
        ))}
        <div ref={logEnd} />
      </div>
      <p className="note">Simulated HubSpot and a mock ERP, running the same validation, mapping, retry and idempotency code a live integration uses.</p>
    </main>
  );
}
