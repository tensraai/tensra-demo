import { FIELD_MAPPINGS, PRODUCT_SKU_MAP } from "../demo-data";
import type { CrmDeal, ErpCustomerInput, ErpOrderInput } from "../types";

export interface MappedPair {
  source: string;
  target: string;
  value: unknown;
  transform?: string;
}

export interface MappedDeal {
  customer: ErpCustomerInput;
  order: Omit<ErpOrderInput, "customerId">;
  /** Source → target pairs with actual values; Phase 5 renders these. */
  pairs: MappedPair[];
}

/** Flat view of the HubSpot deal, addressed by the `source` names in FIELD_MAPPINGS. */
function sourceValues(deal: CrmDeal): Record<string, unknown> {
  const item = deal.line_items[0];
  return {
    company_name: deal.company.company_name,
    email: deal.company.email,
    customer_type: deal.company.customer_type,
    payment_terms: deal.payment_terms,
    product_name: item?.product_name,
    quantity: item?.quantity,
    deal_amount: deal.deal_amount,
    close_date: deal.close_date,
    "deal.id": deal.id,
  };
}

/** Value transforms, keyed by ERP target field. Everything else passes through unchanged. */
const TRANSFORMS: Record<string, (v: unknown) => unknown> = {
  sku: (v) => {
    const sku = PRODUCT_SKU_MAP[String(v)];
    if (!sku) throw new Error(`No SKU mapping for product "${String(v)}"`);
    return sku;
  },
  orderDate: (v) => new Date(String(v)).toISOString().slice(0, 10),
};

export function mapDealToErp(deal: CrmDeal): MappedDeal {
  const src = sourceValues(deal);
  const out: Record<string, unknown> = {};
  const pairs: MappedPair[] = [];

  for (const m of FIELD_MAPPINGS) {
    const raw = src[m.source];
    const transform = TRANSFORMS[m.target];
    const value = transform ? transform(raw) : raw;
    out[m.target] = value;
    pairs.push({ source: m.source, target: m.target, value, transform: m.transform });
  }

  return {
    customer: {
      customerName: out.customerName as string,
      email: out.email as string,
      customerType: out.customerType as ErpCustomerInput["customerType"],
      paymentTerms: out.paymentTerms as ErpCustomerInput["paymentTerms"],
    },
    order: {
      sku: out.sku as string,
      quantity: out.quantity as number,
      orderTotal: out.orderTotal as number,
      orderDate: out.orderDate as string,
      externalRef: out.externalRef as string,
    },
    pairs,
  };
}
