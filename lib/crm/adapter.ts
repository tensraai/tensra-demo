import type { CrmDeal } from "../types";

/** The only CRM properties Tensra writes back. */
export type CrmDealUpdate = Partial<Pick<CrmDeal, "erp_order_id" | "erp_status" | "integration_status">>;

/**
 * The pipeline only talks to this interface.
 * Today: SimulatedHubSpotAdapter. Later: a real HubSpotAdapter with the same shape.
 */
export interface CrmAdapter {
  readonly name: string;
  fetchDeal(dealId: string): Promise<CrmDeal>;
  updateDeal(dealId: string, update: CrmDealUpdate): Promise<CrmDeal>;
}

export class CrmError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
