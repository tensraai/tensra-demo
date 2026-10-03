// ---------- CRM side (HubSpot-shaped) ----------

export type DealStage = "Open" | "Closed Won" | "Closed Lost";
export type PaymentTerms = "Net 15" | "Net 30" | "Net 60";
export type IntegrationStatus = "Pending" | "Running" | "Synced" | "Failed" | "Recovered";
export type ErpStatus = "Created" | "Pending" | "Fulfilled"; // as shown on the CRM deal
export type ErpOrderStatus = "Pending" | "Fulfilled" | "Cancelled"; // inside the ERP

export interface CrmCompany {
  id: string;
  company_name: string;
  email?: string;
  /** ERP requires this; leaving it out is the demo's validation failure. */
  customer_type?: "Wholesale" | "Retail" | "Distributor";
}

export interface CrmLineItem {
  product_name: string;
  quantity: number;
  unit_price: number;
}

export interface CrmDeal {
  id: string;
  name: string;
  stage: DealStage;
  deal_amount: number;
  currency: "USD";
  close_date: string; // ISO date
  payment_terms: PaymentTerms;
  company: CrmCompany;
  line_items: CrmLineItem[];
  // Custom properties written back by Tensra
  erp_order_id?: string;
  erp_status?: ErpStatus;
  integration_status?: IntegrationStatus;
}

// ---------- ERP side ----------

export interface ErpProduct {
  sku: string;
  name: string;
  unitPrice: number;
}

export interface ErpCustomerInput {
  customerName: string;
  email: string;
  customerType: "Wholesale" | "Retail" | "Distributor";
  paymentTerms: PaymentTerms;
}

export interface ErpCustomer extends ErpCustomerInput {
  id: string; // e.g. ERP-8472
}

export interface ErpOrderInput {
  customerId: string;
  sku: string;
  quantity: number;
  orderTotal: number;
  orderDate: string;
  externalRef: string; // HubSpot deal ID, for lookup / duplicate prevention
}

export interface ErpOrder extends ErpOrderInput {
  id: string; // e.g. SO-10482
  status: ErpOrderStatus;
}

// ---------- Integration engine ----------

export type PipelineStep =
  | "webhook_received"
  | "deal_retrieved"
  | "validated"
  | "fields_mapped"
  | "customer_resolved"
  | "order_created"
  | "crm_updated"
  | "synced"
  | "erp_status_synced";

export type EventStatus = "ok" | "error" | "retry" | "info";

export interface IntegrationEvent {
  runId: string;
  step: PipelineStep | "erp_request" | "crm_request" | "retry" | "recovered" | "failed";
  status: EventStatus;
  message: string;
  timestamp: string; // ISO
  payload?: unknown;
}

export interface IntegrationRun {
  id: string;
  dealId: string;
  idempotencyKey: string;
  status: IntegrationStatus;
  retries: number;
  erpCustomerId?: string;
  erpOrderId?: string;
  failureReason?: string;
  createdAt: string;
}

// ---------- Mapping config (displayed in the UI AND used by the pipeline) ----------

export interface FieldMapping {
  source: string; // HubSpot field
  target: string; // ERP field
  transform?: string; // human-readable description, e.g. "format as ISO date"
}
