import assert from "node:assert/strict";
import { DEMO_DEAL } from "../lib/demo-data";
import {
  ErpError, createCustomer, createOrder, findCustomers, findOrders,
  getOrder, listProducts, setFailures, updateOrderStatus,
} from "../lib/erp/service";
import { onOrderStatusChange } from "../lib/erp/store";

function expectErr(fn: () => unknown, status: number, code: string) {
  try { fn(); } catch (e) {
    if (!(e instanceof ErpError)) throw e;
    assert.equal(e.status, status);
    assert.equal(e.code, code);
    return e;
  }
  throw new Error(`expected ${status} ${code}`);
}

let passed = 0;
function test(name: string, fn: () => void) { fn(); passed++; console.log("✓", name); }

const RUN = "test-run-1";
const validCustomer = {
  customerName: "Acme Manufacturing", email: "purchasing@acme-mfg.example",
  customerType: "Wholesale", paymentTerms: "Net 30",
};
const validOrder = (customerId: string, ref = "12345") => ({
  customerId, sku: "VALVE-500", quantity: 500, orderTotal: 25000, orderDate: "2026-10-03", externalRef: ref,
});

test("products are seeded", () => assert.equal(listProducts().length, 3));

let customerId = "";
test("creates a customer and returns ERP-style id", () => {
  const c = createCustomer(RUN, validCustomer);
  assert.match(c.id, /^ERP-\d+$/);
  customerId = c.id;
});

test("rejects customer with missing customer type (422)", () => {
  const e = expectErr(() => createCustomer(RUN, { ...validCustomer, customerName: "Other Co", customerType: undefined }), 422, "VALIDATION_FAILED");
  assert.equal(e.message, "ERP Customer Type missing");
});

test("rejects duplicate customer (409) and exposes existing id", () => {
  const e = expectErr(() => createCustomer(RUN, { ...validCustomer, customerName: "acme manufacturing" }), 409, "DUPLICATE_CUSTOMER");
  assert.equal(e.details?.existingId, customerId);
});

test("finds customer by name, case-insensitive", () => {
  assert.equal(findCustomers(RUN, "ACME MANUFACTURING").length, 1);
  assert.equal(findCustomers(RUN, "Nobody").length, 0);
});

let orderId = "";
test("creates order with SO- id and Pending status", () => {
  const o = createOrder(RUN, validOrder(customerId, DEMO_DEAL.id));
  assert.match(o.id, /^SO-\d+$/);
  assert.equal(o.status, "Pending");
  orderId = o.id;
});

test("rejects unknown SKU, bad quantity, unknown customer", () => {
  expectErr(() => createOrder(RUN, { ...validOrder(customerId, "a"), sku: "NOPE-1" }), 422, "VALIDATION_FAILED");
  expectErr(() => createOrder(RUN, { ...validOrder(customerId, "b"), quantity: 0 }), 422, "VALIDATION_FAILED");
  expectErr(() => createOrder(RUN, validOrder("ERP-0000", "c")), 422, "VALIDATION_FAILED");
});

test("rejects duplicate externalRef (409) — duplicate prevention", () => {
  const e = expectErr(() => createOrder(RUN, validOrder(customerId, DEMO_DEAL.id)), 409, "DUPLICATE_ORDER");
  assert.equal(e.details?.existingId, orderId);
  assert.equal(findOrders(RUN, DEMO_DEAL.id).length, 1);
});

test("failure injection: first N requests return 503, then succeed", () => {
  setFailures(RUN, 2);
  expectErr(() => getOrder(RUN, orderId), 503, "SERVICE_UNAVAILABLE");
  expectErr(() => getOrder(RUN, orderId), 503, "SERVICE_UNAVAILABLE");
  assert.equal(getOrder(RUN, orderId).id, orderId);
});

test("status change fires listener; Pending → Fulfilled; terminal after", () => {
  const seen: string[] = [];
  onOrderStatusChange(RUN, (o, prev) => seen.push(`${prev}->${o.status}`));
  assert.equal(updateOrderStatus(RUN, orderId, { status: "Fulfilled" }).status, "Fulfilled");
  assert.deepEqual(seen, ["Pending->Fulfilled"]);
  expectErr(() => updateOrderStatus(RUN, orderId, { status: "Pending" }), 409, "INVALID_TRANSITION");
  expectErr(() => updateOrderStatus(RUN, orderId, { status: "Bogus" }), 422, "VALIDATION_FAILED");
});

test("runs are isolated from each other", () => {
  assert.equal(findCustomers("test-run-2", "Acme Manufacturing").length, 0);
});

test("invalid run id is rejected", () => {
  expectErr(() => findCustomers("bad id!", "x"), 400, "INVALID_RUN_ID");
});

console.log(`\n${passed} checks passed`);
