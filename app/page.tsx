"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FIELD_MAPPINGS } from "@/lib/demo-data";
import type { CrmDeal, ErpCustomer, ErpOrder, IntegrationEvent, IntegrationRun } from "@/lib/types";

interface DemoState {
  run: IntegrationRun | null;
  deal: CrmDeal | null;
  customers: ErpCustomer[];
  orders: ErpOrder[];
}

const EMPTY: DemoState = { run: null, deal: null, customers: [], orders: [] };
const SITE = "https://tensraai.com";

const NODES = [
  { step: "webhook_received", label: "Webhook", hint: "Deal closed won" },
  { step: "deal_retrieved", label: "Fetch deal", hint: "Read from HubSpot" },
  { step: "validated", label: "Validate", hint: "10 data checks" },
  { step: "fields_mapped", label: "Map fields", hint: "HubSpot → ERP" },
  { step: "customer_resolved", label: "Match customer", hint: "Find or create" },
  { step: "order_created", label: "Create order", hint: "Once per deal" },
  { step: "crm_updated", label: "Write back", hint: "ERP ID to HubSpot" },
] as const;

const BACKEND = ["Authentication", "Validation", "Field mapping", "Business logic", "Idempotency", "Retry queue", "Error handling", "Logging"];

const ICON = { ok: "✓", error: "✕", retry: "↻", info: "•" } as const;

const CSS = `
:root{--bg:#0a0b0f;--panel:#10131a;--ink:#eef0f5;--mute:#8b93a7;--line:#232833;--ok:#34d3b4;--bad:#ff7b6e;--warn:#f2b84b;--accent:#1ac4ff;--con:#07090d;--on:#04121b}
body{font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif;background:radial-gradient(1000px 420px at 85% -80px,rgba(26,196,255,.10),transparent 70%),var(--bg)}
.wrap{max-width:1160px}
.top{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:56px}
.brand{display:flex;align-items:center;gap:12px;font-weight:800;font-size:1.3rem;letter-spacing:.02em;color:var(--ink);text-decoration:none}
.brand i{color:var(--accent);font-style:normal}
.cta{display:inline-block;background:var(--accent);color:var(--on);font-weight:700;text-decoration:none;padding:10px 20px;border-radius:10px;box-shadow:0 0 24px rgba(26,196,255,.30)}
.cta:focus-visible{outline:3px solid #fff;outline-offset:2px}
.pill{display:inline-flex;align-items:center;gap:9px;padding:6px 14px;margin-bottom:22px;border:1px solid var(--line);border-radius:99px;background:rgba(255,255,255,.03);color:#aab2c5;font:600 .72rem ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:.14em;text-transform:uppercase}
.pill::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--accent);box-shadow:0 0 8px var(--accent)}
h1{font-weight:800;font-size:clamp(2rem,5.5vw,3.5rem);line-height:1.05;letter-spacing:-.03em;max-width:20ch;margin-bottom:18px}
.tagline{margin:0 0 22px;color:#aab2c5;font:600 .85rem ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:.2em;text-transform:uppercase}
.sub{font-size:1.05rem;margin-bottom:32px}
button{border-radius:10px;background:transparent}
button.primary{background:var(--accent);border-color:var(--accent);color:var(--on);box-shadow:0 0 24px rgba(26,196,255,.30)}
.node.active{box-shadow:0 0 0 1px var(--accent) inset}
.card,.node{background:var(--panel)}
h3{font-size:1.25rem;margin:40px 0 6px;letter-spacing:-.01em}
.lead{color:var(--mute);margin:0 0 14px;max-width:70ch}
.tbl{overflow-x:auto;border:1px solid var(--line);border-radius:var(--r);background:var(--panel)}
.tbl table{width:100%;border-collapse:collapse;font-size:.9rem;min-width:620px}
.tbl th{text-align:left;color:var(--mute);font-weight:600;padding:10px 14px;border-bottom:1px solid var(--line)}
.tbl td{padding:9px 14px;border-bottom:1px solid var(--line);vertical-align:middle}
.tbl tr:last-child td{border-bottom:0}
.tbl code{font:13px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:var(--accent)}
.tbl .val{font:13px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:var(--ok);overflow-wrap:anywhere}
.tbl .dim{color:var(--mute)}
.arch{display:flex;align-items:stretch;gap:14px}
.sys{flex:0 0 130px;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;padding:18px;border:1px solid var(--line);border-radius:var(--r);background:var(--panel);font-weight:700}
.sys small{color:var(--mute);font-weight:400}
.link{flex:0 0 auto;align-self:center;text-align:center;color:var(--accent);font:600 .78rem ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.link .v{display:none}
.core{flex:1;padding:18px;border:1px solid var(--accent);border-radius:var(--r);background:var(--panel);box-shadow:0 0 28px rgba(26,196,255,.12)}
.core b{display:block;margin-bottom:10px}
.chips{display:flex;flex-wrap:wrap;gap:8px}
.chips span{padding:4px 11px;border:1px solid var(--line);border-radius:99px;font-size:.85rem;color:#c4cad8}
@media(max-width:800px){.arch{flex-direction:column}.sys{flex-basis:auto}.link .h{display:none}.link .v{display:inline}}
.endcta{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:16px;margin-top:40px;padding:22px 24px;border:1px solid var(--line);border-radius:var(--r);background:var(--panel)}
.endcta p{margin:0;font-weight:700;font-size:1.1rem}
.endcta span{display:block;color:var(--mute);font-weight:400;font-size:.92rem;margin-top:2px}
`;

function Logo({ size = 38 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 472 472" role="img" aria-label="Tensra logo">
      {[20, 132, 244, 356].map((x) => (
        <rect key={x} x={x} y={20} width={96} height={96} rx={24} fill="#d9dadf" />
      ))}
      <rect x={132} y={132} width={96} height={96} rx={24} fill="#1ac4ff" />
      <rect x={132} y={244} width={96} height={96} rx={24} fill="#6b7590" />
      <rect x={132} y={356} width={96} height={96} rx={24} fill="#454d63" />
    </svg>
  );
}

function nodeStates(events: IntegrationEvent[], run: IntegrationRun | null) {
  const start = events.map((e) => e.step === "webhook_received" && e.status === "ok").lastIndexOf(true);
  const pass = start >= 0 ? events.slice(start) : [];
  const done = (s: string) => pass.some((e) => e.step === s && e.status === "ok");
  const firstOpen = NODES.findIndex((n) => !done(n.step));
  const last = pass[pass.length - 1];
  const retrying = !!last && ["erp_request", "crm_request", "retry"].includes(last.step) && last.status === "error";
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
  const [state, setState] = useState<DemoState>(EMPTY);
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
    setState(EMPTY);
    if (await api("/start", "POST", body)) listen();
    else setStarting(false);
  }

  async function reset() {
    es.current?.close();
    if (await api("", "DELETE")) {
      setEvents([]);
      setState(EMPTY);
    }
  }

  const run = state.run;
  const busy = starting || run?.status === "Running";
  const order = state.orders[0];
  const nodes = nodeStates(events, run);

  const mapped = events.filter((e) => e.step === "fields_mapped" && e.status === "ok").pop()?.payload as
    | { pairs: { target: string; value: unknown }[] }
    | undefined;
  const valueFor = (target: string) => mapped?.pairs.find((p) => p.target === target)?.value;

  return (
    <main className="wrap">
      <style>{CSS}</style>

      <header className="top">
        <a className="brand" href={SITE} aria-label="Tensra AI home">
          <Logo />
          <span>
            TENSRA <i>AI</i>
          </span>
        </a>
        <a className="cta" href={SITE}>
          Discuss a Project
        </a>
      </header>

      <div className="pill">CRM → ERP integration demo</div>
      <h1>See a CRM → ERP integration in action</h1>
      <p className="tagline">Validate. Map. Sync. Recover.</p>
      <p className="sub">
        A simulated HubSpot deal becomes an ERP sales order, with validation, field mapping, duplicate protection,
        two-way sync and automatic recovery when the ERP fails. The server runs the real pipeline code.
      </p>

      <div className="bar">
        <button className="primary" disabled={!runId || busy} onClick={() => start({})}>
          Run demo
        </button>
        <button disabled={!runId || busy} onClick={() => start({ failures: 3 })}>
          Simulate ERP failure
        </button>
        <button disabled={!runId || busy} onClick={() => start({ scenario: "missing_customer_type" })}>
          Simulate bad data
        </button>
        <button disabled={!run || busy} onClick={() => api("/actions", "POST", { action: "resend" })}>
          Send webhook again
        </button>
        <button
          disabled={!order || order.status !== "Pending" || busy}
          onClick={() => api("/actions", "POST", { action: "fulfil" })}
        >
          Mark order fulfilled
        </button>
        <button disabled={!run || busy} onClick={reset}>
          Reset
        </button>
      </div>
      {error && (
        <p role="alert" style={{ color: "var(--bad)" }}>
          {error}
        </p>
      )}

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
              <dt>Deal</dt>
              <dd>{state.deal.name}</dd>
              <dt>Customer</dt>
              <dd>{state.deal.company.company_name}</dd>
              <dt>Amount</dt>
              <dd>
                ${state.deal.deal_amount.toLocaleString("en-US")} · {state.deal.payment_terms}
              </dd>
              <dt>ERP order ID</dt>
              <dd>{state.deal.erp_order_id ?? "not set"}</dd>
              <dt>ERP status</dt>
              <dd>
                {state.deal.erp_status ? (
                  <span className={`tag s-${state.deal.erp_status}`}>{state.deal.erp_status}</span>
                ) : (
                  "not set"
                )}
              </dd>
              <dt>Integration</dt>
              <dd>
                {state.deal.integration_status ? (
                  <span className={`tag s-${state.deal.integration_status}`}>{state.deal.integration_status}</span>
                ) : (
                  "not set"
                )}
              </dd>
            </dl>
          ) : (
            <p className="empty">Press Run demo to close a deal in HubSpot.</p>
          )}
        </section>

        <section className="card">
          <h2>ERP sales order</h2>
          {order ? (
            <dl>
              <dt>Order</dt>
              <dd>{order.id}</dd>
              <dt>Customer</dt>
              <dd>
                {state.customers[0]?.customerName} ({order.customerId})
              </dd>
              <dt>Product</dt>
              <dd>
                {order.quantity} × {order.sku}
              </dd>
              <dt>Total</dt>
              <dd>${order.orderTotal.toLocaleString("en-US")}</dd>
              <dt>Status</dt>
              <dd>
                <span className={`tag s-${order.status}`}>{order.status}</span>
              </dd>
            </dl>
          ) : (
            <p className="empty">
              {run?.status === "Failed" ? run.failureReason : "No order yet. The integration creates it."}
            </p>
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

      <h3>Field mapping</h3>
      <p className="lead">
        Every HubSpot field is translated into the structure the ERP expects. This table is the same mapping
        configuration the pipeline runs, and the values fill in from the live run.
      </p>
      <div className="tbl">
        <table>
          <thead>
            <tr>
              <th>HubSpot field</th>
              <th>Tensra mapping</th>
              <th>ERP field</th>
              <th>Value from this run</th>
            </tr>
          </thead>
          <tbody>
            {FIELD_MAPPINGS.map((m) => {
              const v = valueFor(m.target);
              return (
                <tr key={m.target}>
                  <td>
                    <code>{m.source}</code>
                  </td>
                  <td className="dim">{m.transform ?? "direct copy"}</td>
                  <td>
                    <code>{m.target}</code>
                  </td>
                  <td className={v === undefined ? "dim" : "val"}>{v === undefined ? "run the demo" : String(v)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h3>How it works</h3>
      <p className="lead">
        The integration layer sits between the two systems. It checks the data before touching the ERP, never
        creates the same order twice, retries when a system is down, and keeps both sides in sync.
      </p>
      <div className="arch">
        <div className="sys">
          HubSpot
          <small>CRM</small>
        </div>
        <div className="link">
          <span className="h">webhook →</span>
          <span className="v">webhook ↓</span>
        </div>
        <div className="core">
          <b>Tensra integration backend</b>
          <div className="chips">
            {BACKEND.map((c) => (
              <span key={c}>{c}</span>
            ))}
          </div>
        </div>
        <div className="link">
          <span className="h">REST API →</span>
          <span className="v">REST API ↓</span>
        </div>
        <div className="sys">
          ERP
          <small>orders, customers</small>
        </div>
      </div>
      <p className="note">
        The return path works the same way: when the ERP changes an order status, a webhook reaches Tensra and
        HubSpot is updated. Jobs that fail after every retry are stored and can be replayed safely without creating
        duplicates.
      </p>

      <div className="endcta">
        <p>
          Need this between your CRM and your ERP?
          <span>We build the integration layer behind it: APIs, mapping, retries and logging.</span>
        </p>
        <a className="cta" href={SITE}>
          Discuss a Project →
        </a>
      </div>
      <p className="note">
        This page uses a simulated HubSpot and a mock ERP, running the same validation, mapping, retry and
        idempotency code a live integration uses.
      </p>
    </main>
  );
}