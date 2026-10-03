import { createCustomer, createOrder, findCustomers, findOrders } from "../erp/service";
import type { ErpCustomer, ErpCustomerInput, ErpOrder, ErpOrderInput } from "../types";

/** What the pipeline needs from an ERP. A real NetSuite/Odoo client would implement the same interface. */
export interface ErpClient {
  findCustomers(name: string): Promise<ErpCustomer[]>;
  createCustomer(input: ErpCustomerInput): Promise<ErpCustomer>;
  findOrders(externalRef: string): Promise<ErpOrder[]>;
  createOrder(input: ErpOrderInput): Promise<ErpOrder>;
}

/** Talks to the Phase 1 mock ERP in-process (same code the HTTP routes call). */
export function createInProcessErpClient(runId: string): ErpClient {
  return {
    async findCustomers(name) {
      return findCustomers(runId, name);
    },
    async createCustomer(input) {
      return createCustomer(runId, input);
    },
    async findOrders(externalRef) {
      return findOrders(runId, externalRef);
    },
    async createOrder(input) {
      return createOrder(runId, input);
    },
  };
}
