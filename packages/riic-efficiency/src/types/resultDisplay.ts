import type { DroneAccelerationResult } from "../utils/efficiency/drone";
import type { EfficiencyRuleset } from "../utils/efficiency/baseRules";
import type { SanityResourceAmounts, SanityValues } from "../utils/sanity";
import type { BasePointSource, FacilityEfficiencyResult } from "./efficiency";
import type { RoomKey } from "./schedule";

export interface DisplayRawNumber {
  value: number;
  signed?: boolean;
}

export interface DisplayValue {
  template: string;
  raws?: DisplayRawNumber[];
}

export interface DisplayRow {
  key: string;
  label?: DisplayValue;
  value?: DisplayValue;
}

export interface DisplayLine {
  key: string;
  value: DisplayValue;
}

export interface DisplayEntry {
  key: string;
  title?: DisplayValue;
  value?: DisplayValue;
  rows: DisplayRow[];
  cells?: DisplayValue[];
}

export interface DisplaySection {
  key: string;
  label?: string;
  rows: DisplayRow[];
  entries?: DisplayEntry[];
  sections?: DisplaySection[];
}

export interface DisplayCard {
  key: string;
  title: DisplayValue;
  subtitle?: DisplayValue;
  badge?: DisplayValue;
  sections: DisplaySection[];
  empty?: string;
  emptyNote?: string;
}

export interface DisplayPane {
  key: string;
  label: string;
  hint?: DisplayValue;
  badge?: DisplayValue;
  cards: DisplayCard[];
}

export interface DisplayTile {
  key: string;
  product?: string;
  sourceFacility?: RoomKey;
  main: DisplayValue;
  mainUnit?: string;
  lines: DisplayLine[];
}

export interface DailyOutputDisplay {
  key: string;
  label: string;
  cycleHours: DisplayValue;
  tiles: DisplayTile[];
  totalTile?: DisplayTile;
  empty: string;
  warning?: string;
}

export interface DroneStrategyDisplay {
  label: string;
  inputLabel: string;
  placeholder: string;
  hint: string;
  empty: string;
  strategyError?: string;
}

export interface DroneScenarioView {
  key: string;
  title: DisplayValue;
  meta: DisplayValue;
  baseRate: DisplayValue;
  baseRateLines?: DisplayValue[];
  views: Array<{ key: string; label: string; tiles: DisplayTile[] }>;
}

export interface BasePointSourceView {
  key: string;
  label: DisplayValue;
  value: DisplayValue;
}

export interface BasePointView {
  key: string;
  name: DisplayValue;
  value: DisplayValue;
  sources: BasePointSourceView[];
}

export interface BasePointColumn {
  key: string;
  title: DisplayValue;
  subtitle?: DisplayValue;
  points: BasePointView[];
  empty: string;
}

export interface BasePointDisplay {
  key: string;
  label: string;
  columns: BasePointColumn[];
}

export interface DisplayPlanView {
  planIndex: number;
  name: string;
  durationHours: number;
}

export interface FacilityStepView {
  key: string;
  planIndex: number;
  facilityId?: string;
  facilityLabel: string;
  inheritedLabel?: string;
  efficiency?: number;
  sections: DisplaySection[];
  emptyNote?: string;
}

export interface FacilityStepsDisplay {
  plans: DisplayPlanView[];
  steps: FacilityStepView[];
}

export interface CalculationStepsDisplay {
  label: string;
  hint: string;
  maaDrone?: DisplayPane;
  dailyOutput?: DisplayPane;
  basePoints?: BasePointDisplay;
  facilitySteps: FacilityStepsDisplay;
}

export interface ResultDisplay {
  dailyOutput: DailyOutputDisplay;
  droneStrategy: DroneStrategyDisplay;
  droneScenarios: DroneScenarioView[];
  calculationSteps: CalculationStepsDisplay;
}

export interface DisplayFlatLine {
  level: number;
  key: string;
  label?: string;
  text: string;
}

export type ResourceAmountDisplayMode = "raw" | "points" | "both";

export interface ResultDisplayOptions {
  sanityValues: SanityValues;
  resourceAmountDisplayMode?: ResourceAmountDisplayMode;
  dailyAmounts?: SanityResourceAmounts;
  droneAcceleration?: DroneAccelerationResult;
  ruleset?: EfficiencyRuleset;
  lmdDroneFacilityExists?: boolean;
  simulateOverflow?: boolean;
  facilityLabel?: (facility: FacilityEfficiencyResult) => string;
  basePointLabel?: (term: string) => string;
  basePointSource?: (source: BasePointSource) => string;
  visibleBasePointTerms?: ReadonlySet<string>;
  sourceFacilityForProduct?: (product: string) => RoomKey | undefined;
}
