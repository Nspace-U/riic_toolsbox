import type { FiammettaMode, RoomKey, ScheduleDocument } from "./schedule";
import type { EliteLevel } from "./baseData";
import type { OperatorProgressionProfile } from "./operatorProgression";
import type { EfficiencyRuleset } from "../utils/efficiency/baseRules";

export type EfficiencyStat =
  | "tradeSpd"
  | "tradeGapEff"
  | "tradeNetEff"
  | "manuProd"
  | "clueSpeed"
  | "clueChance"
  | "hireSpd"
  | "droneCharge"
  | "orderLimit"
  | "storageCap"
  | "moodRecover"
  | "moodCost"
  | "facilityCount"
  | "basePointGain"
  | "basePointConvert"
  | "tradeOrder"
  | "zeroOpMood"
  | "zeroOpBonus"
  | "facBase"
  | "abyssalBoost"
  | "moodSwap"
  | "skillTagConvert";

export type EfficiencyPerSource =
  | "basePoint"
  | "baseFacilityWithGroup"
  | "facilityCount"
  | "facilityLevel"
  | "facilityLevelTotal"
  | "ownLevel"
  | "trainLevel"
  | "dormLevel"
  | "dormHere"
  | "dormOccupants"
  | "dormOccupantsOwn"
  | "dormNotFull"
  | "recruitSlots"
  | "opCount"
  | "opGroupInBase"
  | "opGroupInFacility"
  | "skillOwners"
  | "skillTagCount"
  | "stat"
  | "facCap"
  | "capTier"
  | "manuRecipes"
  | "moodDrop"
  | "orderCount"
  | "orderLimitNet"
  | "droneLimit"
  | "abyssalBoost";

export interface EfficiencyPer {
  per: number;
  value: number;
  cap?: number;
  capUnit?: "count" | "value";
  source: EfficiencyPerSource | string;
  statScope?: "sameFacility" | "targetFacility";
  group?: string;
  term?: string;
  tag?: string;
  stat?: string;
  facility?: RoomKey | "same";
  other?: boolean;
  exclude?: RoomKey[];
  floor?: boolean;
  moodCheck?: boolean;
  fullMood?: boolean;
  tiers?: Array<{ cap?: number; value: number }>;
  [key: string]: unknown;
}

export interface EfficiencyCurve {
  type: "ramp" | string;
  startValue: number;
  startHours: number;
  step: number;
  cap: number;
  [key: string]: unknown;
}

export type ComparisonOperator = "ge" | "gt" | "le" | "lt";

export interface EfficiencyCondition {
  type: string;
  op?: string;
  facility?: RoomKey | "same";
  facilities?: RoomKey[];
  group?: string;
  term?: string;
  a?: string | number;
  b?: string | number;
  min?: number;
  value?: number;
  stat?: string;
  assist?: boolean;
  other?: boolean;
  moodCheck?: boolean;
  fullMood?: boolean;
  exclude?: RoomKey[];
  negate?: boolean;
  [key: string]: unknown;
}

export interface EfficiencyOrderRule {
  type: "fixed" | "fixValues" | "tailor" | "breach" | "invest" | string;
  orderName?: string;
  qty?: number;
  material?: string | null;
  amount?: number;
  time?: number;
  priority?: number;
  ignoreEff?: boolean;
  level?: "α" | "β" | string;
  [key: string]: unknown;
}

export interface EfficiencyEffect {
  target: RoomKey | "any" | string;
  stat: EfficiencyStat | string;
  value?: number;
  per?: EfficiencyPer;
  curve?: EfficiencyCurve;
  condition?: EfficiencyCondition;
  facilities?: RoomKey[];
  scope?: "self" | "room" | "op" | string;
  op?: string;
  scopeGroup?: string;
  subjects?: "single" | "spread" | string;
  other?: boolean;
  stack?: "max" | string;
  maxGroup?: string;
  baseValue?: number;
  recipe?: string;
  term?: string;
  from?: string;
  to?: string;
  rate?: number;
  order?: EfficiencyOrderRule;
  group?: string;
  except?: string[];
  self?: boolean;
  tagFrom?: string[];
  tagTo?: string;
  text?: string;
  cluePreference?: CluePreference;
  suppresses?: string[];
  excludeFromStat?: boolean;
  [key: string]: unknown;
}

export interface EfficiencySkillStage {
  unlock: { type: "elite" | "level" | string; value: number };
  name: string;
  effects: EfficiencyEffect[];
  [key: string]: unknown;
}

export interface EfficiencySkillChain {
  slot: number;
  room: RoomKey | string;
  stages: EfficiencySkillStage[];
  [key: string]: unknown;
}

export interface OperatorSkillFile {
  schemaVersion?: number;
  id: string;
  name: string;
  rarity?: number;
  chains: EfficiencySkillChain[];
}

export interface EfficiencyOperator {
  id: string;
  name: string;
  maxEliteLevel?: EliteLevel;
  rarity: number;
  skillFile?: OperatorSkillFile;
  skillNames?: string[];
}

export interface EfficiencyCalculationOptions {
  progressionProfile?: OperatorProgressionProfile;
  treatSkillsAsUnlocked?: boolean;
  dormitoryDefaultIncludesMoodRecovery?: boolean;
}

export interface EfficiencyTerm {
  name?: string;
  members?: string[];
  definition?: string;
}

export interface EfficiencyTermsFile {
  schemaVersion?: number;
  terms: Record<string, EfficiencyTerm>;
}

export interface EfficiencyCatalog {
  operators: Record<string, EfficiencyOperator>;
  terms: Record<string, EfficiencyTerm>;
  ruleset?: EfficiencyRuleset;
}

export interface EfficiencyCalculationInput {
  catalog: EfficiencyCatalog;
  ruleset?: EfficiencyRuleset;
}

export interface EfficiencyFacility {
  id: string;
  type: RoomKey;
  level: number;
  index: number;
}

export interface FacilityAttributeValue {
  base: number;
  skill: number;
  total: number;
}

export interface FacilityCapacity {
  label: string;
  unit: string;
  base: number;
  skill: number;
  total: number;
  segments: FacilityCapacitySegment[];
  itemVolume?: number;
}

export interface FacilityCapacitySegment {
  startHours: number;
  endHours: number;
  base: number;
  skill: number;
  total: number;
}

export interface FacilityAttributes {
  orderLimit?: FacilityAttributeValue;
  storageCap?: FacilityAttributeValue;
}

export interface TradeOrderSummary {
  name: string;
  probability: number;
  quantity: number;
  time: number;
  material?: string | null;
  amount?: number;
  note?: string;
  ignoreEfficiency?: boolean;
}

export type CluePreference = number | "unowned" | "owned";

export interface ProductionValue {
  product: string;
  cluePreferences?: CluePreference[];
  conversion?: {
    label: string;
    amountPerUnit: number;
    sourceUnit: string;
    baseCycleHours: number;
  };
  baseAmountPerHour: number;
  baseAmountPerDay?: number;
  baseMaterialPerHour?: Record<string, number>;
  amountPerHour: number;
  amountPerDay: number;
  effectiveAmountPerHour?: number;
  effectiveAmountPerDay?: number;
  itemRate?: number;
  breachTime?: number;
  overflowed?: boolean;
  dailyContribution?: number;
  orderRule?: string;
  orders?: TradeOrderSummary[];
  materialPerHour?: Record<string, number>;
  effectiveMaterialPerHour?: Record<string, number>;
}

export type DailyOutputKind = "production" | "net";

export interface DailyOutput {
  product: string;
  kind: DailyOutputKind;
  amountPerDay: number;
}

export type EfficiencyNoticeLevel = "info" | "warning" | "error";

export interface EfficiencyNotice {
  code: string;
  level: EfficiencyNoticeLevel;
  message: string;
  details: string[];
  closable?: boolean;
}

export interface CurveCalculationStep {
  hour: number;
  weight: number;
  value: number;
}

export type OperatorEfficiencyCalculation =
  | {
      type: "tradeGap";
      mode: "max" | "integral";
      durationHours: number;
      gapBase: number;
      gapValue: number;
      initialEfficiency: number;
      averageEfficiency: number;
      expectedOrderHours?: number;
      firstItemProgress: number;
      completedOrders: number;
      decrement: number;
      orderIncrement: number;
      fallbackReason?: "fixedOrder" | "missingOrders";
    }
  | {
      type: "curve";
      beforeHours: number;
      durationHours: number;
      startValue: number;
      startHours: number;
      step: number;
      cap: number;
      steps: CurveCalculationStep[];
      workHours?: {
        threshold: number;
        activeHours: number;
      };
    }
  | {
      type: "workHours";
      beforeHours: number;
      durationHours: number;
      threshold: number;
      activeHours: number;
      baseValue: number;
    };

export interface OperatorEfficiencyDetail {
  operator: string;
  skill?: string;
  stat: string;
  value: number;
  facility: RoomKey;
  ownerFacility?: RoomKey;
  stack?: EfficiencyEffect["stack"];
  category?: "base" | "combination";
  calculation?: OperatorEfficiencyCalculation;
}

export interface FacilityEfficiencyResult {
  facility: EfficiencyFacility;
  inherited?: boolean;
  inheritedFromPlanIndex?: number;
  baseEfficiency: number;
  moodEfficiency: number;
  operatorEfficiency: number;
  skillEfficiency: number;
  operatorSkillEfficiency: number;
  efficiency: number;
  attributes: FacilityAttributes;
  cluePreferences?: CluePreference[];
  capacity?: FacilityCapacity;
  production?: ProductionValue;
  details: OperatorEfficiencyDetail[];
  baseDetails: OperatorEfficiencyDetail[];
  combinationDetails: OperatorEfficiencyDetail[];
}

export type MoodRateDetailKind =
  "base" | "controlWorkers" | "facilityWorkers" | "skill";

export interface MoodRateDetail {
  kind: MoodRateDetailKind;
  value: number;
  count?: number;
  operator?: string;
  skill?: string;
  stat?: "moodCost" | "moodRecover";
}

export interface MoodSnapshot {
  operator: string;
  facility: RoomKey;
  facilityId: string;
  slotIndex: number;
  start: number;
  end: number;
  costRate: number;
  working: boolean;
  rateDetails: MoodRateDetail[];
}

export interface MoodWarning {
  operator: string;
  facility: RoomKey;
  facilityId: string;
  facilityIndex: number;
  slotIndex: number;
  previousEnd: number;
  configuredStart: number;
}

export type BasePointSourceKind = "gain" | "convert";

export interface BasePointSource {
  kind: BasePointSourceKind;
  operator: string;
  skill?: string;
  facility: RoomKey;
  facilityIndex: number;
  slotIndex: number;
  value: number;
  from?: string;
  rate?: number;
}

export interface BasePointDetail {
  term: string;
  value: number;
  sources: BasePointSource[];
}

export interface EfficiencyPlanResult {
  name: string;
  durationHours: number;
  facilities: FacilityEfficiencyResult[];
  moods: MoodSnapshot[];
  moodWarnings: MoodWarning[];
  fiammetta?: FiammettaPlanResult;
  fiammettaWarnings: string[];
  basePoints: Record<string, number>;
  basePointDetails: BasePointDetail[];
  warnings: string[];
}

export interface EfficiencyResult {
  document: ScheduleDocument;
  plans: EfficiencyPlanResult[];
  dailyHours: number;
  dailyFacilities: FacilityEfficiencyResult[];
  dailyProductions: ProductionValue[];
  dailyOutputs: DailyOutput[];
  fiammetta?: FiammettaCalculation;
  fiammettaWarnings: string[];
  warnings: string[];
}

export interface FiammettaPlanResult {
  target?: string;
  targetMood: number;
  start: number;
  end: number;
  recoverRate: number;
  recoverHours: number;
  resting: boolean;
}

export interface FiammettaCalculation {
  mode: FiammettaMode;
  plans: Array<FiammettaPlanResult | undefined>;
  directTargets: string[];
  totalConsumption: number;
  totalRecovery: number;
}
