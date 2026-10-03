import { ERP_PRODUCTS } from "../demo-data";
import type {
  ErpCustomer,
  ErpCustomerInput,
  ErpOrder,
  ErpOrderInput,
  ErpOrderStatus,
  ErpProduct,
} from "../types";
import { emitOrderStatusChange, getRun, isValidRunId } from "./store";

export class ErpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: Record<string, string>,
  ) {
    super(message);
  }
}

const CUSTOMER_TYPES = ["Wholesale", "Retail", "Distributor"];
const PAYMENT_TERMS = ["Net 15", "Net 30", "Net 60"];

function rec(body: unknown): Record<string, unknown> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new ErpError(400, "INVALID_BODY", "Request body must be a JSON object");
  }
  return body as Record<string, unknown>;
}

function assertRun(runId: string) {
  if (!isValidRunId(runId)) throw new ErpError(400, "INVALID_RUN_ID", "Invalid run id");
}

/** Failure injection: while failuresRemaining > 0, data requests return 503. */
function consumeFailure(runId: string) {
  assertRun(runId);
  const run = getRun(runId);
  if (run.failuresRemaining > 0) {
    run.failuresRemaining--;
    run.failuresInjected++;
    throw new ErpError(503, "SERVICE_UNAVAILABLE", "ERP temporarily unavailable (simulated failure)");
  }
}

// ---------- control (not subject to failure injection) ----------

export function setFailures(runId: string, count: number) {
  assertRun(runId);
  if (!Number.isInteger(count) || count < 0 || count > 10) {
    throw new ErpError(422, "VALIDATION_FAILED", "failures must be an integer between 0 and 10");
  }
  getRun(runId).failuresRemaining = count;
  return runSummary(runId);
}

export function runSummary(runId: string) {
  assertRun(runId);
  const run = getRun(runId);
  return {
    runId,
    customers: run.customers.size,
    orders: run.orders.size,
    failuresRemaining: run.failuresRemaining,
    failuresInjected: run.failuresInjected,
  };
}

export function listProducts(): ErpProduct[] {
  return ERP_PRODUCTS;
}

// ---------- customers ----------

export function createCustomer(runId: string, body: unknown): ErpCustomer {
  consumeFailure(runId);
  const b = rec(body);
  const fields: Record<string, string> = {};

  const name = typeof b.customerName === "string" ? b.customerName.trim() : "";
  const email = typeof b.email === "string" ? b.email.trim() : "";
  if (!name) fields.customerName = "customerName is required";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fields.email = "a valid email is required";
  if (!CUSTOMER_TYPES.includes(b.customerType as string)) fields.customerType = "ERP Customer Type missing";
  if (!PAYMENT_TERMS.includes(b.paymentTerms as string)) fields.paymentTerms = "paymentTerms must be Net 15, Net 30 or Net 60";
  if (Object.keys(fields).length) {
    const first = Object.values(fields)[0];
    throw new ErpError(422, "VALIDATION_FAILED", first, fields);
  }

  const run = getRun(runId);
  for (const c of run.customers.values()) {
    if (c.customerName.toLowerCase() === name.toLowerCase()) {
      throw new ErpError(409, "DUPLICATE_CUSTOMER", `Customer "${name}" already exists`, { existingId: c.id });
    }
  }

  const input = b as unknown as ErpCustomerInput;
  const customer: ErpCustomer = {
    id: `ERP-${run.nextCustomerNum++}`,
    customerName: name,
    email,
    customerType: input.customerType,
    paymentTerms: input.paymentTerms,
  };
  run.customers.set(customer.id, customer);
  return customer;
}

export function getCustomer(runId: string, id: string): ErpCustomer {
  consumeFailure(runId);
  const c = getRun(runId).customers.get(id);
  if (!c) throw new ErpError(404, "NOT_FOUND", `Customer ${id} not found`);
  return c;
}

/** Case-insensitive name search; returns an empty list when nothing matches. */
export function findCustomers(runId: string, name: string): ErpCustomer[] {
  consumeFailure(runId);
  const needle = name.trim().toLowerCase();
  return [...getRun(runId).customers.values()].filter((c) => c.customerName.toLowerCase() === needle);
}

// ---------- orders ----------

export function createOrder(runId: string, body: unknown): ErpOrder {
  consumeFailure(runId);
  const b = rec(body);
  const run = getRun(runId);
  const fields: Record<string, string> = {};

  if (typeof b.customerId !== "string" || !run.customers.has(b.customerId)) fields.customerId = "customerId does not match an existing customer";
  const product = ERP_PRODUCTS.find((p) => p.sku === b.sku);
  if (!product) fields.sku = `Unknown SKU "${String(b.sku)}"`;
  if (!Number.isInteger(b.quantity) || (b.quantity as number) < 1) fields.quantity = "quantity must be a whole number of at least 1";
  if (typeof b.orderTotal !== "number" || !(b.orderTotal > 0)) fields.orderTotal = "orderTotal must be greater than 0";
  if (typeof b.orderDate !== "string" || Number.isNaN(Date.parse(b.orderDate))) fields.orderDate = "orderDate must be a valid date";
  if (typeof b.externalRef !== "string" || !b.externalRef) fields.externalRef = "externalRef is required";
  if (Object.keys(fields).length) {
    throw new ErpError(422, "VALIDATION_FAILED", Object.values(fields)[0], fields);
  }

  const input = b as unknown as ErpOrderInput;
  for (const o of run.orders.values()) {
    if (o.externalRef === input.externalRef) {
      throw new ErpError(409, "DUPLICATE_ORDER", `An order for ${input.externalRef} already exists`, { existingId: o.id });
    }
  }

  const order: ErpOrder = {
    id: `SO-${run.nextOrderNum++}`,
    customerId: input.customerId,
    sku: input.sku,
    quantity: input.quantity,
    orderTotal: input.orderTotal,
    orderDate: input.orderDate,
    externalRef: input.externalRef,
    status: "Pending",
  };
  run.orders.set(order.id, order);
  return order;
}

export function getOrder(runId: string, id: string): ErpOrder {
  consumeFailure(runId);
  const o = getRun(runId).orders.get(id);
  if (!o) throw new ErpError(404, "NOT_FOUND", `Order ${id} not found`);
  return o;
}

export function findOrders(runId: string, externalRef: string): ErpOrder[] {
  consumeFailure(runId);
  return [...getRun(runId).orders.values()].filter((o) => o.externalRef === externalRef);
}

const TRANSITIONS: Record<ErpOrderStatus, ErpOrderStatus[]> = {
  Pending: ["Fulfilled", "Cancelled"],
  Fulfilled: [],
  Cancelled: [],
};

export function updateOrderStatus(runId: string, id: string, body: unknown): ErpOrder {
  consumeFailure(runId);
  const b = rec(body);
  const run = getRun(runId);
  const order = run.orders.get(id);
  if (!order) throw new ErpError(404, "NOT_FOUND", `Order ${id} not found`);

  const next = b.status as ErpOrderStatus;
  if (!(next in TRANSITIONS)) {
    throw new ErpError(422, "VALIDATION_FAILED", "status must be Pending, Fulfilled or Cancelled", { status: "invalid status" });
  }
  if (!TRANSITIONS[order.status].includes(next)) {
    throw new ErpError(409, "INVALID_TRANSITION", `Cannot change order from ${order.status} to ${next}`);
  }
  const previous = order.status;
  order.status = next;
  emitOrderStatusChange(runId, order, previous);
  return order;
}
