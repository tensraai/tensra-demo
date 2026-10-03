// Hits the running mock ERP over HTTP. Start the app first (npm run dev), then: npm run smoke:erp
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const run = "smoke-" + Math.random().toString(36).slice(2, 8);
const url = (p) => `${BASE}/api/erp/${run}${p}`;

async function call(method, path, body) {
  const res = await fetch(url(path), {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  console.log(`${method} ${path} -> ${res.status}`, JSON.stringify(data));
  return { status: res.status, data };
}

function expect(cond, msg) {
  if (!cond) { console.error("✗ FAILED:", msg); process.exit(1); }
  console.log("✓", msg, "\n");
}

const c = await call("POST", "/customers", {
  customerName: "Acme Manufacturing", email: "purchasing@acme-mfg.example",
  customerType: "Wholesale", paymentTerms: "Net 30",
});
expect(c.status === 201 && /^ERP-/.test(c.data.id), "customer created");

const bad = await call("POST", "/customers", { customerName: "NoType Ltd", email: "a@b.co", paymentTerms: "Net 30" });
expect(bad.status === 422 && bad.data.error.message === "ERP Customer Type missing", "missing customer type rejected");

await call("POST", "/control", { failures: 2 });
const q = encodeURIComponent("Acme Manufacturing");
const f1 = await call("GET", `/customers?name=${q}`);
const f2 = await call("GET", `/customers?name=${q}`);
const f3 = await call("GET", `/customers?name=${q}`);
expect(f1.status === 503 && f2.status === 503 && f3.status === 200, "failure injection: 503, 503, then 200");

const o = await call("POST", "/orders", {
  customerId: c.data.id, sku: "VALVE-500", quantity: 500, orderTotal: 25000,
  orderDate: "2026-10-03", externalRef: "12345",
});
expect(o.status === 201 && /^SO-/.test(o.data.id), "order created");

const dup = await call("POST", "/orders", {
  customerId: c.data.id, sku: "VALVE-500", quantity: 500, orderTotal: 25000,
  orderDate: "2026-10-03", externalRef: "12345",
});
expect(dup.status === 409, "duplicate order blocked");

const p = await call("PATCH", `/orders/${o.data.id}`, { status: "Fulfilled" });
expect(p.status === 200 && p.data.status === "Fulfilled", "order marked Fulfilled");

console.log("All smoke checks passed");
