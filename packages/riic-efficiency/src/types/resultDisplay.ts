import type { DroneAccelerationResult } from "../utils/efficiency/drone";
import type { SanityResourceAmounts, SanityValues } from "../utils/sanity";
import type { BasePointSource, FacilityEfficiencyResult } from "./efficiency";
import type { RoomKey } from "./schedule";

export type DisplayNumberFormat =
  "number" | "production" | "efficiency" | "signed";

export interface DisplayValuePartText {
  text: string;
  muted?: boolean;
}

export interface DisplayValuePartNumber {
  value: number;
  format?: DisplayNumberFormat;
  unit?: string;
  muted?: boolean;
}

export type DisplayValuePart =
  string | DisplayValuePartText | DisplayValuePartNumber;

export interface DisplayValue {
  text: string;
  parts: DisplayValuePart[];
}

export interface DisplayRow {
  key: string;
  label?: DisplayValue;
  value?: DisplayValue;
  emphasis?: boolean;
  icon?: string;
  muted?: boolean;
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

export type DisplaySectionKind =
  "grid" | "skill-list" | "mood-list" | "candidate-list";

export interface DisplaySection {
  key: string;
  label?: string;
  kind?: DisplaySectionKind;
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
  icon?: string;
  sourceFacility?: RoomKey;
  netOnly?: boolean;
  main: DisplayValue;
  lines: DisplayLine[];
}

export interface DailyOutputDisplay {
  key: string;
  eyebrow: string;
  label: string;
  cycleHours: DisplayValue;
  tiles: DisplayTile[];
  totalTile?: DisplayTile;
  empty: string;
  warning?: string;
}

export interface DroneStrategyDisplay {
  eyebrow: string;
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
  views: Array<{ key: string; label: string; tiles: DisplayTile[] }>;
}

export interface BasePointSourceView {
  key: string;
  text: DisplayValue;
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

export interface CalculationStepsDisplay {
  eyebrow: string;
  label: string;
  hint: string;
  maaDrone?: DisplayPane;
  dailyOutput?: DisplayPane;
  basePoints?: BasePointDisplay;
  facilitySteps: {
    byFacility: DisplayPane[];
    byQueue: DisplayCard[];
  };
}

export interface ResultDisplay {
  dailyOutput: DailyOutputDisplay;
  droneStrategy: DroneStrategyDisplay;
  droneScenarios: DroneScenarioView[];
  calculationSteps: CalculationStepsDisplay;
}

export interface ResultDisplayOptions {
  sanityValues: SanityValues;
  dailyAmounts?: SanityResourceAmounts;
  droneAcceleration?: DroneAccelerationResult;
  lmdDroneFacilityExists?: boolean;
  simulateOverflow?: boolean;
  facilityLabel?: (facility: FacilityEfficiencyResult) => string;
  basePointLabel?: (term: string) => string;
  basePointSource?: (source: BasePointSource) => string;
  visibleBasePointTerms?: ReadonlySet<string>;
  sourceFacilityForProduct?: (product: string) => RoomKey | undefined;
}
