import {
  calculateEfficiency as calculatePackageEfficiency,
  DEFAULT_RULESET,
} from "../../../packages/riic-efficiency/src/index";
import type {
  EfficiencyCalculationInput as PackageCalculationInput,
  EfficiencyCatalog as PackageCatalog,
  EfficiencyResult as PackageEfficiencyResult,
} from "../../../packages/riic-efficiency/src/types/efficiency";
import type {
  EfficiencyCalculationOptions,
  EfficiencyCatalog,
  EfficiencyResult,
} from "@/types/efficiency";
import type { ScheduleDocument } from "@/types/schedule";
import { TRADE_ORDER_LIMIT } from "@/utils/efficiency/baseRules";

function documentWithCalculationSettings(
  document: ScheduleDocument,
  options: EfficiencyCalculationOptions,
): ScheduleDocument {
  const legacyOrderProgress = document.settings?.orderProgress;
  if (
    options.progressionProfile === undefined &&
    options.treatSkillsAsUnlocked === undefined &&
    options.dormitoryDefaultIncludesMoodRecovery === undefined &&
    !legacyOrderProgress
  ) {
    return document;
  }
  return {
    ...document,
    settings: {
      ...document.settings,
      ...(options.progressionProfile === undefined
        ? {}
        : { progressionProfile: options.progressionProfile }),
      ...(options.treatSkillsAsUnlocked === undefined
        ? {}
        : { treatSkillsAsUnlocked: options.treatSkillsAsUnlocked }),
      ...(options.dormitoryDefaultIncludesMoodRecovery === undefined
        ? {}
        : {
            dormitoryDefaultIncludesMoodRecovery:
              options.dormitoryDefaultIncludesMoodRecovery,
          }),
      ...(legacyOrderProgress
        ? {
            tradeOrderCount: Object.fromEntries(
              Object.entries(legacyOrderProgress).map(([facilityId, value]) => {
                const match = facilityId.match(/^(trading)-(\d+)$/);
                const level = match
                  ? document.layout.filter((entry) => entry.type === match[1])[
                      Number(match[2]) - 1
                    ]?.level
                  : undefined;
                const limit = level ? (TRADE_ORDER_LIMIT[level] ?? 0) : 0;
                return [facilityId, (limit * value) / 100];
              }),
            ),
          }
        : {}),
    },
  };
}

export function calculateEfficiency(
  document: ScheduleDocument,
  catalog: EfficiencyCatalog,
  options: EfficiencyCalculationOptions = {},
): EfficiencyResult {
  const input: PackageCalculationInput = {
    catalog: catalog as unknown as PackageCatalog,
    ruleset: DEFAULT_RULESET,
  };
  return calculatePackageEfficiency(
    documentWithCalculationSettings(document, options) as never,
    input,
  ) as PackageEfficiencyResult as unknown as EfficiencyResult;
}
