import { ERP_PRODUCTS, PRODUCT_SKU_MAP } from "../demo-data";
import type { CrmDeal } from "../types";

export interface ValidationCheck {
  name: string;
  ok: boolean;
  /** Why it failed (empty when ok). */
  detail: string;
}

export interface ValidationResult {
  ok: boolean;
  checks: ValidationCheck[];
  /** First failure, used as the run's failure reason. */
  reason?: string;
}

const PAYMENT_TERMS = ["Net 15", "Net 30", "Net 60"];
const CUSTOMER_TYPES = ["Wholesale", "Retail", "Distributor"];

/** Runs every check (no short-circuit) so the UI can show a full ✓/✕ list. */
export function validateDeal(deal: CrmDeal): ValidationResult {
  const item = deal.line_items.length === 1 ? deal.line_items[0] : undefined;
  const lineTotal = deal.line_items.reduce((sum, l) => sum + l.quantity * l.unit_price, 0);
  const sku = item ? PRODUCT_SKU_MAP[item.product_name] : undefined;

  const checks: ValidationCheck[] = [
    check("Deal is Closed Won", deal.stage === "Closed Won", `Deal stage is "${deal.stage}", expected Closed Won`),
    check("Customer name exists", !!deal.company.company_name?.trim(), "Customer name missing"),
    check("Email exists", /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(deal.company.email ?? ""), "Customer email missing or invalid"),
    check("ERP customer type present", CUSTOMER_TYPES.includes(deal.company.customer_type ?? ""), "ERP Customer Type missing"),
    check("Payment terms valid", PAYMENT_TERMS.includes(deal.payment_terms), "Payment terms missing or unsupported"),
    check(
      "Exactly one line item",
      deal.line_items.length === 1,
      deal.line_items.length === 0 ? "Deal has no products" : "This demo supports one line item per deal",
    ),
    check(
      "Product exists in ERP",
      !!item && !!sku && ERP_PRODUCTS.some((p) => p.sku === sku),
      item ? `Product "${item.product_name}" not found in ERP` : "No product to look up",
    ),
    check(
      "Quantity > 0",
      !!item && Number.isInteger(item.quantity) && item.quantity > 0,
      "Quantity must be a whole number greater than 0",
    ),
    check(
      "Deal amount valid",
      deal.deal_amount > 0 && deal.deal_amount === lineTotal,
      deal.deal_amount > 0
        ? `Deal amount ${deal.deal_amount} does not match line items (${lineTotal})`
        : "Deal amount must be greater than 0",
    ),
    check("Close date valid", !Number.isNaN(Date.parse(deal.close_date)), "Close date missing or invalid"),
  ];

  const failed = checks.find((c) => !c.ok);
  return { ok: !failed, checks, reason: failed?.detail };
}

function check(name: string, ok: boolean, detail: string): ValidationCheck {
  return { name, ok, detail: ok ? "" : detail };
}
