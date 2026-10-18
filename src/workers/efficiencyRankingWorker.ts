import type { EfficiencyCatalog } from "@arknights/riic-efficiency";

import {
  calculateEfficiencyRankingEntry,
  type EfficiencyRankingCalculationResult,
  type EfficiencyRankingEntry,
} from "@/utils/efficiencyRanking";

interface EfficiencyRankingWorkerRequest {
  type: "calculate";
  requestId: number;
  catalog: EfficiencyCatalog;
  entries: EfficiencyRankingEntry[];
}

interface EfficiencyRankingWorkerResponse {
  requestId: number;
  results?: Record<string, EfficiencyRankingCalculationResult>;
  error?: string;
}

self.onmessage = (event: MessageEvent<EfficiencyRankingWorkerRequest>) => {
  const request = event.data;
  if (request.type !== "calculate") return;
  try {
    const results = Object.fromEntries(
      request.entries.map((entry) => [
        entry.id,
        calculateEfficiencyRankingEntry(request.catalog, entry),
      ]),
    );
    self.postMessage({
      requestId: request.requestId,
      results,
    } satisfies EfficiencyRankingWorkerResponse);
  } catch (error: unknown) {
    self.postMessage({
      requestId: request.requestId,
      error: error instanceof Error ? error.message : "效率排名计算失败",
    } satisfies EfficiencyRankingWorkerResponse);
  }
};

export {};
