import type { CrmDeal } from "../types";
import { CrmError, type CrmAdapter, type CrmDealUpdate } from "./adapter";

/** In-memory stand-in for HubSpot. One instance per demo run. */
export class SimulatedHubSpotAdapter implements CrmAdapter {
  readonly name = "Simulated HubSpot";
  private deal: CrmDeal;

  constructor(initial: CrmDeal) {
    this.deal = structuredClone(initial);
  }

  async fetchDeal(dealId: string): Promise<CrmDeal> {
    if (dealId !== this.deal.id) throw new CrmError(404, `Deal ${dealId} not found`);
    return structuredClone(this.deal);
  }

  async updateDeal(dealId: string, update: CrmDealUpdate): Promise<CrmDeal> {
    if (dealId !== this.deal.id) throw new CrmError(404, `Deal ${dealId} not found`);
    this.deal = { ...this.deal, ...update };
    return structuredClone(this.deal);
  }

  /** Current deal state, for the UI cards. */
  snapshot(): CrmDeal {
    return structuredClone(this.deal);
  }
}

const g = globalThis as unknown as { __tensraCrm?: Map<string, SimulatedHubSpotAdapter> };
const registry: Map<string, SimulatedHubSpotAdapter> = (g.__tensraCrm ??= new Map());

export function createSimulatedCrm(runId: string, deal: CrmDeal): SimulatedHubSpotAdapter {
  const adapter = new SimulatedHubSpotAdapter(deal);
  registry.set(runId, adapter);
  return adapter;
}

export function getSimulatedCrm(runId: string): SimulatedHubSpotAdapter | undefined {
  return registry.get(runId);
}

export function removeSimulatedCrm(runId: string): void {
  registry.delete(runId);
}
