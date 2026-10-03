import type { CrmDeal, ErpProduct, FieldMapping } from "./types";

/** The fixed demo deal: Acme Manufacturing, 500 x Industrial Valve = $25,000, Net 30. */
export const DEMO_DEAL: CrmDeal = {
  id: "12345",
  name: "Acme — 500 Units",
  stage: "Closed Won",
  deal_amount: 25000,
  currency: "USD",
  close_date: "2026-10-03",
  payment_terms: "Net 30",
  company: {
    id: "c-001",
    company_name: "Acme Manufacturing",
    email: "purchasing@acme-mfg.example",
    customer_type: "Wholesale",
  },
  line_items: [{ product_name: "Industrial Valve", quantity: 500, unit_price: 50 }],
};

/** A copy with the required ERP field removed, used for the validation-failure scenario. */
export const DEMO_DEAL_MISSING_TYPE: CrmDeal = {
  ...DEMO_DEAL,
  company: { ...DEMO_DEAL.company, customer_type: undefined },
};

/** Products that exist in the mock ERP. */
export const ERP_PRODUCTS: ErpProduct[] = [
  { sku: "VALVE-500", name: "Industrial Valve", unitPrice: 50 },
  { sku: "PUMP-200", name: "Hydraulic Pump", unitPrice: 320 },
  { sku: "GASKET-10", name: "Steel Gasket", unitPrice: 4 },
];

/** Maps CRM product names to ERP SKUs. */
export const PRODUCT_SKU_MAP: Record<string, string> = {
  "Industrial Valve": "VALVE-500",
  "Hydraulic Pump": "PUMP-200",
  "Steel Gasket": "GASKET-10",
};

/** HubSpot → ERP field mapping. Phase 2 uses it to transform; Phase 5 renders it. */
export const FIELD_MAPPINGS: FieldMapping[] = [
  { source: "company_name", target: "customerName" },
  { source: "email", target: "email" },
  { source: "customer_type", target: "customerType" },
  { source: "payment_terms", target: "paymentTerms" },
  { source: "product_name", target: "sku", transform: "lookup product name → SKU" },
  { source: "quantity", target: "quantity" },
  { source: "deal_amount", target: "orderTotal" },
  { source: "close_date", target: "orderDate", transform: "format as ISO date" },
  { source: "deal.id", target: "externalRef", transform: "used for duplicate prevention" },
];
