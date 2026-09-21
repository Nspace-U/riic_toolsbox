import {
  calculateDroneAcceleration as calculatePackageDroneAcceleration,
  DEFAULT_LMD_DRONE_STRATEGIES,
  DRONE_ACCELERATABLE_PRODUCTS,
  parseLmdDroneStrategy as parsePackageLmdDroneStrategy,
} from "../../../packages/riic-efficiency/src/index";
import type {
  DroneAccelerationResult as PackageDroneAccelerationResult,
  EfficiencyCatalog as PackageCatalog,
  EfficiencyResult as PackageEfficiencyResult,
  LmdDroneStrategies,
  LmdDroneStrategy,
  LmdDroneStrategyLevel,
  LmdDroneStrategyParseResult,
} from "../../../packages/riic-efficiency/src/index";
import type {
  EfficiencyCalculationOptions,
  EfficiencyCatalog,
  EfficiencyResult,
} from "@/types/efficiency";
import type { ScheduleDocument } from "@/types/schedule";
import type { SanityResourceAmounts } from "@/utils/sanity";
import type { EfficiencyRuleset } from "../../../packages/riic-efficiency/src/index";

export type {
  LmdDroneStrategies,
  LmdDroneStrategy,
  LmdDroneStrategyLevel,
  LmdDroneStrategyParseResult,
};
export { DEFAULT_LMD_DRONE_STRATEGIES, DRONE_ACCELERATABLE_PRODUCTS };
export type {
  DroneAcceleratableProduct,
  DroneAccelerationScenario,
} from "../../../packages/riic-efficiency/src/index";
export type { DroneAccelerationResult } from "../../../packages/riic-efficiency/src/index";

export interface DroneAccelerationOptions extends EfficiencyCalculationOptions {
  efficiencyResult?: EfficiencyResult;
  lmdDroneStrategies?: LmdDroneStrategies;
  ruleset?: EfficiencyRuleset;
}

function documentWithCalculationSettings(
  document: ScheduleDocument,
  options: EfficiencyCalculationOptions,
): ScheduleDocument {
  if (
    options.progressionProfile === undefined &&
    options.treatSkillsAsUnlocked === undefined &&
    options.dormitoryDefaultIncludesMoodRecovery === undefined
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
    },
  };
}

export function parseLmdDroneStrategy(
  text: string,
  catalog: EfficiencyCatalog,
): LmdDroneStrategyParseResult {
  return parsePackageLmdDroneStrategy(
    text,
    catalog as unknown as PackageCatalog,
  );
}

export function calculateDroneAcceleration(
  document: ScheduleDocument,
  catalog: EfficiencyCatalog,
  dailyAmounts: SanityResourceAmounts,
  options: DroneAccelerationOptions = {},
): PackageDroneAccelerationResult {
  return calculatePackageDroneAcceleration(
    documentWithCalculationSettings(document, options) as never,
    catalog as unknown as PackageCatalog,
    dailyAmounts,
    {
      efficiencyResult: options.efficiencyResult as
        PackageEfficiencyResult | undefined,
      lmdDroneStrategies: options.lmdDroneStrategies,
      ruleset: options.ruleset,
    } as never,
  );
}
