import type {
  AutoRestWarning,
  BasePointDetail,
  CurveCalculationStep,
  EfficiencyEffect,
  EfficiencyFacility,
  EfficiencyOperator,
  EfficiencyCatalog,
  EfficiencyStat,
  FacilityAttributes,
  FacilityCapacity,
  FacilityCapacitySegment,
  FiammettaPlanResult,
  MoodRateDetail,
  MoodWarning,
  OperatorEfficiencyCalculation,
  OperatorSkillFile,
} from "../../types/efficiency";
import type { EfficiencyRuleset } from "./baseRules";
import type {
  OperatorState,
  Plan,
  RoomAssignment,
  RoomKey,
  ScheduleDocument,
  ScheduleSettings,
} from "../../types/schedule";
import { CLUE_BASE_TIME_HOURS } from "./baseRules";
import { resolveRoomAssignment } from "../schedule";

export const EPSILON = 0.000001;
export const DEFAULT_DURATION_MINUTES = 720;
export const DRONE_LIMIT = 235;
export const POWER_OUTPUT_PER_HOUR = 10;
export const CLUE_OUTPUT_PER_HOUR = 1 / CLUE_BASE_TIME_HOURS;
export const HIRE_OUTPUT_PER_HOUR = 1 / 12;
export const CLUE_LIMIT = 11;
export const HIRE_LIMIT = 3;
export const FIAMMETTA_NAME = "菲亚梅塔";
export const CREDIT_BASE_DAILY =
  40 + 30 + 20 + 15 + 10 + 5 + 210 + 30 * 10 + 300 / 7;
export const DAILY_OUTPUT_ORDER = [
  "龙门币",
  "合成玉",
  "赤金",
  "中级作战记录",
  "源石碎片",
  "无人机",
  "信用",
  "公开招募标签刷新次数",
];
export const CLUE_PREFERENCE_BY_FACTION: Record<string, number> = {
  莱茵生命: 1,
  企鹅物流: 2,
  黑钢国际: 3,
  乌萨斯学生自治团: 4,
  格拉斯哥帮: 5,
  喀兰贸易: 6,
  罗德岛制药: 7,
};
export const EFFICIENCY_STATS = new Set([
  "tradeSpd",
  "manuProd",
  "clueSpeed",
  "hireSpd",
  "droneCharge",
  "abyssalBoost",
]);
export const DIRECT_FACILITY_EFFICIENCY_STATS = new Set([
  "tradeSpd",
  "manuProd",
  "droneCharge",
  "clueSpeed",
  "hireSpd",
]);
export const PERCENTAGE_EFFICIENCY_STATS: Partial<
  Record<RoomKey, EfficiencyStat>
> = {
  trading: "tradeSpd",
  manufacture: "manuProd",
  power: "droneCharge",
  meeting: "clueSpeed",
  hire: "hireSpd",
};
export const ATTRIBUTE_STATS = new Set(["orderLimit", "storageCap"]);
export const POINT_STATS = new Set(["basePointGain", "basePointConvert"]);
export const FLOW_GOLD_TERM = "cc.t.flow_gold";
export const FLOW_GOLD_DISPLAY_OPERATORS = ["绮良", "鸿雪", "图耶"];

export interface Placement {
  name: string;
  facility: EfficiencyFacility;
  assignment: RoomAssignment;
  index: number;
  state: OperatorState;
  profile?: EfficiencyOperator;
  skillFile?: OperatorSkillFile;
  selected: Array<{ skill: string; effect: EfficiencyEffect }>;
  explicitMood: boolean;
  moodStart: number;
  moodEnd: number;
  costRate: number;
  moodRateDetails: MoodRateDetail[];
  working: boolean;
  workHoursBefore: number;
  fiammettaForced: boolean;
}

export interface PlanContext {
  catalog: EfficiencyCatalog;
  ruleset: EfficiencyRuleset;
  document: ScheduleDocument;
  plan: Plan;
  settings: ScheduleSettings;
  index: number;
  durationHours: number;
  facilities: EfficiencyFacility[];
  placements: Placement[];
  active: ActiveEffect[];
  basePoints: Record<string, number>;
  basePointDetails: BasePointDetail[];
  statValues: Map<string, number>;
  moodWarnings: MoodWarning[];
  autoRestWarnings: AutoRestWarning[];
  fiammetta?: FiammettaPlanResult;
  fiammettaWarnings: string[];
  warnings: string[];
}

export interface ActiveEffect {
  owner: Placement;
  effect: EfficiencyEffect;
  skill: string;
  target?: EfficiencyFacility;
}

export interface ZeroedSkillState {
  operators: Set<string>;
  exceptSources: Set<string>;
}

export const EMPTY_ZEROED_SKILL_STATE: ZeroedSkillState = {
  operators: new Set(),
  exceptSources: new Set(),
};

export interface EffectDetail {
  item: ActiveEffect;
  value: number;
  calculation?: OperatorEfficiencyCalculation;
}

export interface PerValue {
  value: number;
  count: number;
  times: number;
}

export interface CurveEvaluation {
  value: number;
  steps: CurveCalculationStep[];
}

export interface EvaluationData {
  capBoosts: Record<string, Record<string, number>>;
  bonusByFacility: Record<string, Record<string, Record<string, number>>>;
  sameFacilityBonusByFacility?: Record<
    string,
    Record<string, Record<string, number>>
  >;
  bonusSegments?: Array<{
    startHours: number;
    endHours: number;
    bonusByFacility: Record<string, Record<string, Record<string, number>>>;
    sameFacilityBonusByFacility: Record<
      string,
      Record<string, Record<string, number>>
    >;
  }>;
  capacitySegments?: CapacityEvaluationSegment[];
}

export interface CapacityEvaluationSegment extends FacilityCapacitySegment {
  capBoosts: Record<string, Record<string, number>>;
}

export interface CapacityCalculation {
  capacity: FacilityCapacity;
  segments: CapacityEvaluationSegment[];
}

export interface AttributeState {
  attributes: FacilityAttributes;
  rawOrderLimit: number;
  capBoosts: Record<string, Record<string, number>>;
  linked: boolean;
  orderLimitNet: number;
}

export interface BasePointState {
  points: Record<string, number>;
  details: BasePointDetail[];
}

export function clampMood(value: number): number {
  return Math.max(0, Math.min(24, Number.isFinite(value) ? value : 24));
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function roomAssignments(
  document: ScheduleDocument,
  planIndex: number,
  facility: EfficiencyFacility,
): RoomAssignment {
  return resolveRoomAssignment(
    document,
    planIndex,
    facility.type,
    facility.index,
  ).assignment;
}

export function hasFlowGoldDisplayOperator(context: PlanContext): boolean {
  return context.facilities
    .filter((facility) => facility.type === "trading")
    .some((facility) =>
      (
        roomAssignments(context.document, context.index, facility).operators ??
        []
      ).some((name) => FLOW_GOLD_DISPLAY_OPERATORS.includes(name)),
    );
}

export function stateOf(
  assignment: RoomAssignment,
  name: string,
): OperatorState {
  return assignment.operatorStates?.[name] ?? {};
}

export function firstItemProgress(
  settings: ScheduleSettings,
  facilityId: string,
): number {
  const value = settings.firstItemProgress;
  if (typeof value === "number") {
    return Math.max(0, Math.min(1, value));
  }
  if (isRecord(value)) {
    const progress =
      value[facilityId] ?? value[facilityId.replace(/-\d+$/, "")];
    return typeof progress === "number"
      ? Math.max(0, Math.min(1, progress))
      : 0;
  }
  return 0;
}

export function emptyEvaluationData(): EvaluationData {
  return { capBoosts: {}, bonusByFacility: {} };
}
