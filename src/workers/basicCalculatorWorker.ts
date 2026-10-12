import {
  calculateBasicCalculatorRowValues,
  type BasicCalculatorWorkerRequest,
  type BasicCalculatorWorkerResponse,
} from "@/utils/basicCalculator";

self.onmessage = (event: MessageEvent<BasicCalculatorWorkerRequest>) => {
  const request = event.data;
  if (request.type !== "calculate") {
    return;
  }
  try {
    const results = Object.fromEntries(
      request.groups.flatMap((group) =>
        group.rows.map((row) => [
          `${group.id}:${row.id}`,
          calculateBasicCalculatorRowValues(
            request.catalog,
            group,
            row,
            request.columns,
            {
              dormitoryDefaultIncludesMoodRecovery:
                request.dormitoryDefaultIncludesMoodRecovery,
              progressionProfile: request.progressionProfile,
              preferMaxJieEfficiency: request.preferMaxJieEfficiency,
              firstItemProgress: request.firstItemProgress,
              allowRowFirstItemProgressOverride:
                request.allowRowFirstItemProgressOverride,
            },
          ),
        ]),
      ),
    );
    const response: BasicCalculatorWorkerResponse = {
      requestId: request.requestId,
      results,
    };
    self.postMessage(response);
  } catch (error: unknown) {
    self.postMessage({
      error: error instanceof Error ? error.message : "计算器计算失败",
      requestId: request.requestId,
    } satisfies BasicCalculatorWorkerResponse);
  }
};

export {};
