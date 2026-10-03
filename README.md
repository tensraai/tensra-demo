# Tensra CRM → ERP Demo

Lean Next.js demo: a simulated HubSpot deal becomes an ERP sales order with
validation, field mapping, duplicate prevention, retries and two-way sync.

## Run
```bash
npm install
npm run dev          # http://localhost:3000
npm run typecheck    # TypeScript check
npm run check:data   # sanity-check the demo data
```

## Demo API (Phase 3)
- `POST   /api/demo/:runId/start`    `{scenario?, failures?}` -> 202, pipeline runs in the background
- `GET    /api/demo/:runId/events`   Server-Sent Events: `log`, `state`, `closed`
- `POST   /api/demo/:runId/actions`  `{action: "fulfil" | "resend" | "replay"}`
- `GET    /api/demo/:runId`          full state (run, events, HubSpot deal, ERP data)
- `DELETE /api/demo/:runId`          reset

## Layout
- `lib/types.ts`      shared types (CRM deal, ERP customer/order, events, runs)
- `lib/demo-data.ts`  Acme deal, ERP products, SKU map, field mappings
- `lib/erp/`          mock ERP (Phase 1)
- `lib/pipeline/`     integration engine (Phase 2)
- `lib/demo/`         demo API logic + SSE stream (Phase 3)
- `app/api/`          route handlers (thin wrappers)
- `app/`              Next.js app (placeholder page until Phase 4)

## Phases
0 Setup · 1 Mock ERP · 2 Pipeline · 3 Streaming (done) · 4 UI · 5 Mapping/Architecture · 6 Launch
