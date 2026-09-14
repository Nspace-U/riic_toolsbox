import type {
  EfficiencyCatalog,
  EfficiencyCondition,
  EfficiencyEffect,
  EfficiencyCalculationOptions,
  EfficiencyFacility,
  EfficiencyOperator,
  BasePointDetail,
  BasePointSource,
  OperatorEfficiencyCalculation,
  FacilityCapacity,
  EfficiencyPer,
  EfficiencyPlanResult,
  EfficiencyResult,
  FiammettaCalculation,
  FiammettaPlanResult,
  FacilityAttributes,
  FacilityEfficiencyResult,
  CluePreference,
  CurveCalculationStep,
  MoodWarning,
  MoodRateDetail,
  MoodSnapshot,
  OperatorEfficiencyDetail,
  OperatorEfficiencyContribution,
  OperatorSkillFile,
  ProductionValue,
  TradeOrderSummary,
} from "@/types/efficiency";
import type { OperatorProgressionProfile } from "@/types/operatorProgression";
import { resolveOperatorProgression } from "@/utils/operatorProgression";
import type {
  OperatorState,
  Plan,
  RoomAssignment,
  RoomKey,
  ScheduleSettings,
  ScheduleDocument,
} from "@/types/schedule";
import {
  buildFacilities,
  eliteEfficiency,
  facilityBaseEfficiency,
  MANUFACTURE_STORAGE,
  manufactureRule,
  meetingAtmosphereBonus,
  rarityEfficiency,
  TRADE_ORDER_LIMIT,
  TRADE_ORDERS,
  TAILOR_PROBABILITIES,
  WORK_ROOM_KEYS,
} from "@/utils/efficiency/baseRules";
import { catalogOperator, groupMembers } from "@/utils/efficiency/catalog";
import { resolveRoomAssignment, roomSlotCount } from "@/utils/schedule";
import {
  compareBasePointDetails,
  compareBasePointSources,
} from "@/utils/efficiency/basePoints";

const EPSILON = 0.000001;
const DEFAULT_DURATION_MINUTES = 720;
const DRONE_LIMIT = 235;
const POWER_OUTPUT_PER_HOUR = 10;
const CLUE_BASE_TIME_HOURS = 20;
const CREDIT_PER_CLUE = 40;
const CLUE_OUTPUT_PER_HOUR = 1 / CLUE_BASE_TIME_HOURS;
const HIRE_OUTPUT_PER_HOUR = 1 / 12;
const CLUE_LIMIT = 11;
const HIRE_LIMIT = 3;
const FIAMMETTA_NAME = "菲亚梅塔";
const CLUE_PREFERENCE_BY_FACTION: Record<string, number> = {
  莱茵生命: 1,
  企鹅物流: 2,
  黑钢国际: 3,
  乌萨斯学生自治团: 4,
  格拉斯哥帮: 5,
  喀兰贸易: 6,
  罗德岛制药: 7,
};
const EFFICIENCY_STATS = new Set([
  "tradeSpd",
  "manuProd",
  "clueSpeed",
  "hireSpd",
  "droneCharge",
  "abyssalBoost",
]);
const DIRECT_FACILITY_EFFICIENCY_STATS = new Set([
  "tradeSpd",
  "manuProd",
  "droneCharge",
  "clueSpeed",
  "hireSpd",
]);
const ATTRIBUTE_STATS = new Set(["orderLimit", "storageCap"]);
const POINT_STATS = new Set(["basePointGain", "basePointConvert"]);

interface Placement {
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
  owned: boolean;
  fiammettaForced: boolean;
}

interface PlanContext {
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
  fiammetta?: FiammettaPlanResult;
  fiammettaWarnings: string[];
  warnings: string[];
}

interface ActiveEffect {
  owner: Placement;
  effect: EfficiencyEffect;
  skill: string;
  target?: EfficiencyFacility;
}

interface PerValue {
  value: number;
  count: number;
  times: number;
}

interface CurveEvaluation {
  value: number;
  steps: CurveCalculationStep[];
}

interface EvaluationData {
  capBoosts: Record<string, Record<string, number>>;
  bonusByFacility: Record<string, Record<string, Record<string, number>>>;
}

interface AttributeState {
  attributes: FacilityAttributes;
  rawOrderLimit: number;
  capBoosts: Record<string, Record<string, number>>;
  linked: boolean;
  orderLimitNet: number;
}

interface BasePointState {
  points: Record<string, number>;
  details: BasePointDetail[];
}

function clampMood(value: number): number {
  return Math.max(0, Math.min(24, Number.isFinite(value) ? value : 24));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function roomAssignments(
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

function stateOf(assignment: RoomAssignment, name: string): OperatorState {
  return assignment.operatorStates?.[name] ?? {};
}

function firstItemProgress(
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

function isFacilityBaseEffect(item: ActiveEffect): boolean {
  const { effect, owner } = item;
  if (effect.stat === "facBase") {
    return true;
  }
  return (
    owner.facility.type === "control" &&
    DIRECT_FACILITY_EFFICIENCY_STATS.has(effect.stat) &&
    !effect.per &&
    !effect.condition &&
    !effect.scope &&
    !effect.other
  );
}

function progressionOf(
  profile: OperatorProgressionProfile | undefined,
  name: string,
  catalog: EfficiencyCatalog,
  facility: EfficiencyFacility,
  state: OperatorState,
  treatSkillsAsUnlocked: boolean,
  dormitoryDefaultIncludesMoodRecovery: boolean,
): ReturnType<typeof resolveOperatorProgression> {
  const operator = catalogOperator(catalog, name);
  return resolveOperatorProgression({
    operatorId: operator?.id ?? name,
    facility: facility.type,
    operatorSkillFile: operator?.skillFile,
    maxEliteLevel: operator?.maxEliteLevel,
    manualElite: state.elite,
    manualLevel: state.level,
    profile,
    treatSkillsAsUnlocked,
    dormitoryDefaultIncludesMoodRecovery,
  });
}

function unlocksStage(
  stage: { unlock?: { type?: string; value?: number } },
  state: OperatorState,
): boolean {
  const value = Number(stage.unlock?.value ?? 0);
  if (stage.unlock?.type === "level") {
    return (state.level ?? 30) >= value;
  }
  return (state.elite ?? 0) >= value;
}

function selectedSkills(
  skillFile: OperatorSkillFile | undefined,
  facility: RoomKey,
  state: OperatorState,
): Array<{ skill: string; effect: EfficiencyEffect }> {
  if (!skillFile) {
    return [];
  }
  return skillFile.chains
    .filter((chain) => chain.room === facility)
    .flatMap((chain) => {
      const stage = chain.stages
        .filter((candidate) => unlocksStage(candidate, state))
        .at(-1);
      return stage
        ? stage.effects.map((effect) => ({ skill: stage.name, effect }))
        : [];
    });
}

function createContexts(
  document: ScheduleDocument,
  catalog: EfficiencyCatalog,
  progressionProfile?: OperatorProgressionProfile,
  treatSkillsAsUnlocked = false,
  dormitoryDefaultIncludesMoodRecovery = false,
): PlanContext[] {
  const facilities = buildFacilities(document.layout);
  return document.plans.map((plan, index) => {
    const durationHours = Math.max(
      0,
      Number(plan.duration ?? DEFAULT_DURATION_MINUTES) / 60,
    );
    const placements: Placement[] = [];
    const warnings: string[] = [];
    facilities.forEach((facility) => {
      const assignment = roomAssignments(document, index, facility);
      if (!assignment.operators?.some(Boolean)) {
        return;
      }
      (assignment.operators ?? []).forEach((name, operatorIndex) => {
        if (!name) {
          return;
        }
        const profile = catalogOperator(catalog, name);
        if (!profile) {
          warnings.push(`队列 ${index + 1}：找不到干员“${name}”的技能数据`);
        }
        const state = stateOf(assignment, name);
        const progression = progressionOf(
          progressionProfile,
          name,
          catalog,
          facility,
          state,
          treatSkillsAsUnlocked,
          dormitoryDefaultIncludesMoodRecovery,
        );
        const effectiveState: OperatorState = {
          ...state,
          elite: progression.elite,
          level: progression.level,
        };
        placements.push({
          name,
          facility,
          assignment,
          index: operatorIndex,
          state: effectiveState,
          profile,
          skillFile: profile?.skillFile,
          selected: selectedSkills(
            profile?.skillFile,
            facility.type,
            effectiveState,
          ),
          explicitMood: Object.prototype.hasOwnProperty.call(state, "mood"),
          moodStart: clampMood(state.mood ?? 24),
          moodEnd: clampMood(state.mood ?? 24),
          costRate: 0,
          moodRateDetails: [],
          working: true,
          workHoursBefore: 0,
          owned: progression.owned,
          fiammettaForced: false,
        });
      });
    });
    return {
      document,
      plan,
      settings: document.settings ?? {},
      index,
      durationHours,
      facilities,
      placements,
      active: [],
      basePoints: {},
      basePointDetails: [],
      statValues: new Map(),
      moodWarnings: [],
      fiammettaWarnings: [],
      warnings,
    };
  });
}

function isWorkPlacement(placement: Placement): boolean {
  return WORK_ROOM_KEYS.includes(placement.facility.type);
}

function isMoodContinuityPlacement(placement: Placement): boolean {
  return placement.facility.type !== "dormitory";
}

function isCurrentlyWorking(placement: Placement): boolean {
  return (
    placement.working &&
    (!isWorkPlacement(placement) || placement.moodStart > EPSILON)
  );
}

function placementsInFacility(
  context: PlanContext,
  facility: EfficiencyFacility,
): Placement[] {
  return context.placements.filter(
    (placement) => placement.facility.id === facility.id,
  );
}

function placementsInRoomType(
  context: PlanContext,
  type: RoomKey,
): Placement[] {
  return context.placements.filter(
    (placement) => placement.facility.type === type,
  );
}

function placementAt(
  context: PlanContext,
  name: string,
  type?: RoomKey,
): Placement | undefined {
  return context.placements.find(
    (placement) =>
      placement.name === name &&
      (type === undefined || placement.facility.type === type),
  );
}

function workingPlacement(placement: Placement, moodCheck = false): boolean {
  return !moodCheck || placement.moodStart > EPSILON;
}

function facilityTargets(
  effect: EfficiencyEffect,
  owner: Placement,
  facilities: EfficiencyFacility[],
): Array<EfficiencyFacility | undefined> {
  if (
    POINT_STATS.has(effect.stat) ||
    effect.stat === "facilityCount" ||
    effect.stat === "skillTagConvert"
  ) {
    return [undefined];
  }
  if (effect.target === "training" || effect.target === "processing") {
    return [];
  }
  if (effect.target === "any") {
    if (effect.facilities?.length) {
      return facilities.filter((facility) =>
        effect.facilities?.includes(facility.type),
      );
    }
    return facilities.filter(
      (facility) =>
        WORK_ROOM_KEYS.includes(facility.type) || facility.type === "dormitory",
    );
  }
  const type = effect.target as RoomKey;
  const sameType = facilities.filter((facility) => facility.type === type);
  if (sameType.length === 0) {
    return [];
  }
  if (owner.facility.type === type) {
    return [owner.facility];
  }
  return sameType;
}

function compare(left: number, right: number, operator = "ge"): boolean {
  if (operator === "gt") return left > right;
  if (operator === "le") return left <= right;
  if (operator === "lt") return left < right;
  return left >= right;
}

function termValue(
  context: PlanContext,
  value: string | number | undefined,
): number {
  if (typeof value === "number") return value;
  return value ? (context.basePoints[value] ?? 0) : 0;
}

function membersFor(
  catalog: EfficiencyCatalog,
  group: string | undefined,
): string[] {
  return groupMembers(catalog, group);
}

function skillMatchesTag(
  placement: Placement,
  skill: string,
  tag: string,
  context: PlanContext,
  catalog: EfficiencyCatalog,
): boolean {
  if (catalog.terms[tag]?.members?.includes(skill)) {
    return true;
  }
  return context.active.some(
    (item) =>
      item.effect.stat === "skillTagConvert" &&
      item.effect.tagTo === tag &&
      item.owner.facility.id === placement.facility.id &&
      item.effect.tagFrom?.some((sourceTag) =>
        catalog.terms[sourceTag]?.members?.includes(skill),
      ) === true,
  );
}

function conditionFacilityType(
  conditionFacility: string | undefined,
  owner: Placement,
): RoomKey | undefined {
  return conditionFacility === "same"
    ? owner.facility.type
    : (conditionFacility as RoomKey | undefined);
}

function conditionSatisfied(
  condition: EfficiencyCondition | undefined,
  owner: Placement,
  target: EfficiencyFacility | undefined,
  context: PlanContext,
  catalog: EfficiencyCatalog,
): boolean {
  if (!condition) return true;
  let result: boolean;
  const type = conditionFacilityType(condition.facility, owner);
  const members = membersFor(catalog, condition.group);
  switch (condition.type) {
    case "opAtFacility": {
      const found = placementAt(context, String(condition.op ?? ""), type);
      result = !!found && (!condition.moodCheck || found.moodStart > EPSILON);
      break;
    }
    case "opInBase": {
      const found = placementAt(context, String(condition.op ?? ""));
      result =
        !!found &&
        (!condition.facilities?.length ||
          condition.facilities.includes(found.facility.type)) &&
        (!condition.moodCheck || found.moodStart > EPSILON);
      break;
    }
    case "opInFacilityAndTarget": {
      const found = placementAt(
        context,
        String(condition.op ?? ""),
        condition.facility as RoomKey | undefined,
      );
      result =
        !!found &&
        target?.type === condition.facility &&
        (!condition.moodCheck || found.moodStart > EPSILON);
      break;
    }
    case "opGroupInFacility":
    case "opGroupNotInFacility": {
      const placements = placementsInRoomType(context, type as RoomKey)
        .filter((placement) => workingPlacement(placement, condition.moodCheck))
        .filter(
          (placement) => !condition.other || placement.name !== owner.name,
        );
      const found = placements.some((placement) =>
        members.includes(placement.name),
      );
      result = condition.type === "opGroupNotInFacility" ? !found : found;
      break;
    }
    case "opGroupCountInFacility": {
      const count = placementsInRoomType(context, type as RoomKey)
        .filter((placement) => workingPlacement(placement, condition.moodCheck))
        .filter((placement) => members.includes(placement.name))
        .filter(
          (placement) => !condition.other || placement.name !== owner.name,
        ).length;
      result = count >= Number(condition.min ?? 1);
      break;
    }
    case "opGroupCountInBase": {
      const count = context.placements
        .filter(
          (placement) => !condition.exclude?.includes(placement.facility.type),
        )
        .filter((placement) => workingPlacement(placement, condition.moodCheck))
        .filter((placement) => members.includes(placement.name))
        .filter(
          (placement) => !condition.other || placement.name !== owner.name,
        ).length;
      result = count >= Number(condition.min ?? 1);
      break;
    }
    case "onlySelf": {
      const working = context.placements.filter(
        (placement) =>
          placement.facility.id === owner.facility.id &&
          isCurrentlyWorking(placement),
      );
      result = working.length === 1 && working[0]?.name === owner.name;
      break;
    }
    case "clueExchanging":
      result =
        context.plan.rooms.meeting !== undefined &&
        context.settings.clueExchanging !== false;
      break;
    case "moodCmp":
      result = compare(
        owner.moodStart,
        Number(condition.value ?? 0),
        condition.op,
      );
      break;
    case "moodDrop":
      result =
        24 -
          owner.moodStart +
          (Math.max(0, owner.costRate) * context.durationHours) / 2 >
        Number(condition.value ?? 0);
      break;
    case "termCmp":
      result = compare(
        termValue(context, condition.a),
        termValue(context, condition.b),
        condition.op,
      );
      break;
    case "statCmp": {
      const key = `${target?.id ?? owner.facility.id}:${condition.stat ?? ""}`;
      result = compare(
        context.statValues.get(key) ?? 0,
        Number(condition.value ?? 0),
        condition.op,
      );
      break;
    }
    case "workHours":
      result =
        owner.workHoursBefore + context.durationHours >=
        Number(condition.value ?? 0);
      break;
    default:
      result = false;
  }
  return condition.negate ? !result : result;
}

function currentFacilityCount(context: PlanContext, type: RoomKey): number {
  const physical = context.facilities.filter(
    (facility) => facility.type === type,
  ).length;
  const extra = context.active
    .filter(
      (item) =>
        item.effect.stat === "facilityCount" && item.effect.target === type,
    )
    .reduce((total, item) => total + Number(item.effect.value ?? 0), 0);
  return physical + extra;
}

function orderCount(
  context: PlanContext,
  facility: EfficiencyFacility,
): number {
  const progress = context.settings.orderProgress?.[facility.id] ?? 0;
  return Math.max(
    0,
    ((TRADE_ORDER_LIMIT[facility.level] ?? 0) * progress) / 100,
  );
}

function basePointTerm(context: PlanContext, term: string | undefined): number {
  return term ? (context.basePoints[term] ?? 0) : 0;
}

function perCount(
  per: EfficiencyPer,
  owner: Placement,
  target: EfficiencyFacility | undefined,
  effectTarget: EfficiencyEffect["target"],
  context: PlanContext,
  catalog: EfficiencyCatalog,
  data: EvaluationData,
): PerValue {
  const sameFacility =
    effectTarget === "any" || !target ? owner.facility : target;
  const countInFacility = (type: RoomKey | "same" | undefined): Placement[] => {
    if (type === "same" || !type) {
      return placementsInFacility(context, sameFacility);
    }
    return placementsInRoomType(context, type);
  };
  let count = 0;
  switch (per.source) {
    case "basePoint":
      count = basePointTerm(context, per.term);
      break;
    case "facilityCount":
      count = currentFacilityCount(
        context,
        (per.facility ?? "power") as RoomKey,
      );
      break;
    case "facilityLevel":
      count = context.facilities
        .filter((facility) => facility.type === (per.facility ?? "trading"))
        .reduce((total, facility) => total + facility.level, 0);
      break;
    case "facilityLevelTotal":
      count = context.facilities.reduce(
        (total, facility) => total + facility.level,
        0,
      );
      break;
    case "ownLevel":
      count = target?.level ?? owner.facility.level;
      break;
    case "trainLevel":
      count = context.facilities
        .filter((facility) => facility.type === "training")
        .reduce((total, facility) => total + facility.level, 0);
      break;
    case "dormLevel":
      count = context.facilities
        .filter((facility) => facility.type === "dormitory")
        .reduce((total, facility) => total + facility.level, 0);
      break;
    case "dormHere": {
      const dorm =
        owner.facility.type === "dormitory" ? owner.facility : undefined;
      if (!dorm) break;
      count =
        context.settings.dormFullTreat === false
          ? placementsInFacility(context, dorm).length
          : roomSlotCount("dormitory", dorm.level);
      break;
    }
    case "dormOccupants":
      count = context.facilities
        .filter((facility) => facility.type === "dormitory")
        .reduce(
          (total, facility) =>
            total +
            (context.settings.dormFullTreat === false
              ? placementsInFacility(context, facility).length
              : roomSlotCount("dormitory", facility.level)),
          0,
        );
      break;
    case "dormOccupantsOwn":
      count =
        owner.facility.type === "dormitory"
          ? placementsInFacility(context, owner.facility).filter(
              (placement) => placement.name !== owner.name,
            ).length
          : 0;
      break;
    case "dormNotFull":
      count =
        owner.facility.type === "dormitory"
          ? placementsInFacility(context, owner.facility).filter(
              (placement) => placement.moodStart < 24 - EPSILON,
            ).length
          : 0;
      break;
    case "recruitSlots":
      count = context.facilities
        .filter((facility) => facility.type === "hire")
        .reduce(
          (total, facility) => total + Math.max(0, facility.level - 1),
          0,
        );
      break;
    case "opCount":
      count = countInFacility(per.facility)
        .filter((placement) => workingPlacement(placement, per.moodCheck))
        .filter(
          (placement) => !per.other || placement.name !== owner.name,
        ).length;
      break;
    case "opGroupInBase": {
      const members = membersFor(catalog, per.group);
      count = context.placements
        .filter((placement) => !per.exclude?.includes(placement.facility.type))
        .filter((placement) => workingPlacement(placement, per.moodCheck))
        .filter((placement) => members.includes(placement.name))
        .filter(
          (placement) => !per.other || placement.name !== owner.name,
        ).length;
      break;
    }
    case "opGroupInFacility": {
      const members = membersFor(catalog, per.group);
      count = countInFacility(per.facility)
        .filter((placement) => workingPlacement(placement, per.moodCheck))
        .filter((placement) => members.includes(placement.name))
        .filter((placement) => !per.other || placement.name !== owner.name)
        .filter(
          (placement) => !per.fullMood || placement.moodStart >= 24 - EPSILON,
        ).length;
      break;
    }
    case "baseFacilityWithGroup": {
      const members = membersFor(catalog, per.group);
      count = context.facilities.filter((facility) =>
        placementsInFacility(context, facility).some(
          (placement) =>
            members.includes(placement.name) &&
            workingPlacement(placement, per.moodCheck),
        ),
      ).length;
      break;
    }
    case "skillOwners": {
      const members = catalog.terms[per.term ?? ""]?.members ?? [];
      count = placementsInRoomType(context, "control")
        .filter((placement) => workingPlacement(placement, per.moodCheck))
        .filter((placement) =>
          placement.selected.some((item) => members.includes(item.skill)),
        ).length;
      break;
    }
    case "skillTagCount": {
      count = countInFacility(per.facility)
        .filter((placement) => workingPlacement(placement, per.moodCheck))
        .reduce(
          (total, placement) =>
            total +
            placement.selected.filter(({ skill }) =>
              skillMatchesTag(
                placement,
                skill,
                per.tag ?? "",
                context,
                catalog,
              ),
            ).length,
          0,
        );
      break;
    }
    case "stat": {
      const stat = per.stat ?? "";
      const facilityIdValue = target?.id ?? owner.facility.id;
      count = Object.entries(data.bonusByFacility[facilityIdValue] ?? {})
        .filter(([name]) => !per.other || name !== owner.name)
        .reduce((total, [, values]) => total + (Number(values[stat]) || 0), 0);
      break;
    }
    case "facCap": {
      count = Object.values(
        data.capBoosts[per.stat ?? "storageCap"] ?? {},
      ).reduce((total, value) => total + value, 0);
      break;
    }
    case "capTier": {
      const tiers = per.tiers ?? [];
      count = Object.values(
        data.capBoosts[per.stat ?? "storageCap"] ?? {},
      ).reduce((total, value) => {
        if (value <= 0 || tiers.length === 0) return total;
        const tier =
          tiers.find(
            (candidate) =>
              candidate.cap === undefined || value <= candidate.cap,
          ) ?? tiers[tiers.length - 1];
        return total + value * Number(tier?.value ?? 0);
      }, 0);
      break;
    }
    case "moodDrop":
      count = Math.max(
        0,
        24 -
          owner.moodStart +
          (Math.max(0, owner.costRate) * context.durationHours) / 2,
      );
      break;
    case "orderCount":
      count = target ? orderCount(context, target) : 0;
      break;
    case "orderLimitNet":
      count = data.capBoosts.orderLimit
        ? Object.values(data.capBoosts.orderLimit).reduce(
            (total, value) => total + value,
            0,
          )
        : 0;
      break;
    case "droneLimit":
      count = DRONE_LIMIT;
      break;
    case "manuRecipes": {
      const recipes = new Set(
        context.facilities
          .filter((facility) => facility.type === "manufacture")
          .map((facility) => {
            const assignment = roomAssignments(
              context.document,
              context.index,
              facility,
            );
            return manufactureRule(
              assignment.product,
              assignment.sourceMaterial,
            )?.recipe;
          })
          .filter((recipe): recipe is string => !!recipe),
      );
      count = recipes.size;
      break;
    }
    case "abyssalBoost": {
      const members = membersFor(catalog, per.group);
      const local = placementsInRoomType(context, "manufacture").filter(
        (placement) =>
          members.includes(placement.name) &&
          workingPlacement(placement, per.moodCheck),
      ).length;
      const total = context.placements
        .filter((placement) => placement.facility.type === "manufacture")
        .filter(
          (placement) =>
            members.includes(placement.name) &&
            workingPlacement(placement, per.moodCheck),
        ).length;
      const amount = local * total * Number(per.value ?? 0);
      return {
        value:
          per.capUnit === "value"
            ? Math.min(amount, Number(per.cap ?? Infinity))
            : amount,
        count: local,
        times: local * total,
      };
    }
    default:
      count = 0;
  }
  const perUnit = Math.max(EPSILON, Number(per.per) || 1);
  const shouldFloor = per.floor ?? per.source !== "facCap";
  const times = shouldFloor
    ? Math.max(0, Math.floor(count / perUnit))
    : count / perUnit;
  const raw = times * (Number(per.value) || 0);
  const value =
    per.capUnit === "value"
      ? Math.min(raw, Number(per.cap ?? Infinity))
      : per.cap === undefined
        ? raw
        : Math.min(times, per.cap) * (Number(per.value) || 0);
  return { value, count, times };
}

function curveEvaluation(
  curve: NonNullable<EfficiencyEffect["curve"]>,
  duration: number,
  start: number,
): CurveEvaluation {
  let total = 0;
  const steps: CurveCalculationStep[] = [];
  for (let hour = 1; hour <= Math.ceil(duration); hour += 1) {
    const weight = Math.max(0, Math.min(1, duration - (hour - 1)));
    const value = Math.min(
      curve.startValue + (start + hour - curve.startHours) * curve.step,
      curve.cap,
    );
    total += value * weight;
    steps.push({ hour, weight, value });
  }
  return {
    value: duration > EPSILON ? total / duration : 0,
    steps,
  };
}

function workHoursCalculation(
  item: ActiveEffect,
  context: PlanContext,
): { threshold: number; activeHours: number } | undefined {
  if (item.effect.condition?.type !== "workHours") {
    return undefined;
  }
  const threshold = Number(item.effect.condition.value ?? 0);
  const activeHours = Math.max(
    0,
    Math.min(
      context.durationHours,
      item.owner.workHoursBefore + context.durationHours - threshold,
    ),
  );
  return { threshold, activeHours };
}

function effectValue(
  item: ActiveEffect,
  target: EfficiencyFacility | undefined,
  context: PlanContext,
  catalog: EfficiencyCatalog,
  data: EvaluationData,
): number {
  const { effect, owner } = item;
  let value: number;
  if (effect.curve) {
    value = curveEvaluation(
      effect.curve,
      context.durationHours,
      owner.workHoursBefore,
    ).value;
  } else if (effect.per) {
    value = perCount(
      effect.per,
      owner,
      target,
      effect.target,
      context,
      catalog,
      data,
    ).value;
  } else {
    value = Number(effect.value ?? 0) + Number(effect.baseValue ?? 0);
  }
  const workHours = workHoursCalculation(item, context);
  if (workHours) {
    value *=
      context.durationHours > EPSILON
        ? workHours.activeHours / context.durationHours
        : 0;
  }
  return value;
}

function effectCalculation(
  item: ActiveEffect,
  context: PlanContext,
): OperatorEfficiencyCalculation | undefined {
  const { effect, owner } = item;
  const workHours = workHoursCalculation(item, context);
  if (effect.curve) {
    const curve = curveEvaluation(
      effect.curve,
      context.durationHours,
      owner.workHoursBefore,
    );
    return {
      type: "curve",
      beforeHours: owner.workHoursBefore,
      durationHours: context.durationHours,
      startValue: effect.curve.startValue,
      startHours: effect.curve.startHours,
      step: effect.curve.step,
      cap: effect.curve.cap,
      steps: curve.steps,
      ...(workHours ? { workHours } : {}),
    };
  }
  if (!workHours) {
    return undefined;
  }
  return {
    type: "workHours",
    beforeHours: owner.workHoursBefore,
    durationHours: context.durationHours,
    threshold: workHours.threshold,
    activeHours: workHours.activeHours,
    baseValue: Number(effect.value ?? 0) + Number(effect.baseValue ?? 0),
  };
}

function effectAppliesToSubject(
  item: ActiveEffect,
  subject: Placement,
  target: EfficiencyFacility,
  catalog: EfficiencyCatalog,
): boolean {
  const { effect, owner } = item;
  if (item.target?.id !== target.id) return false;
  if (effect.other && subject.name === owner.name) return false;
  if (effect.scope === "op" && subject.name !== effect.op) return false;
  if (effect.scope === "room" && subject.facility.id !== owner.facility.id)
    return false;
  if (
    effect.scopeGroup &&
    !membersFor(catalog, effect.scopeGroup).includes(subject.name)
  )
    return false;
  if (!effect.scope && effect.target !== "any" && subject.name !== owner.name)
    return false;
  return true;
}

function collectActive(
  context: PlanContext,
  catalog: EfficiencyCatalog,
  ignoreStatCmp = false,
): ActiveEffect[] {
  const active: ActiveEffect[] = [];
  context.placements
    .filter((placement) => isCurrentlyWorking(placement))
    .forEach((owner) => {
      owner.selected.forEach(({ skill, effect }) => {
        if (ignoreStatCmp && effect.condition?.type === "statCmp") return;
        const targets = facilityTargets(effect, owner, context.facilities);
        targets.forEach((target) => {
          if (
            !conditionSatisfied(
              effect.condition,
              owner,
              target,
              context,
              catalog,
            )
          )
            return;
          active.push({ owner, effect, skill, target });
        });
      });
    });
  return active;
}

function cluePreferenceOf(
  effect: EfficiencyEffect,
): CluePreference | undefined {
  if (
    typeof effect.cluePreference === "number" ||
    effect.cluePreference === "unowned" ||
    effect.cluePreference === "owned"
  ) {
    return effect.cluePreference;
  }
  const text = effect.text ?? "";
  if (text.includes("尚未拥有")) return "unowned";
  if (text.includes("已经拥有")) return "owned";
  const faction = Object.entries(CLUE_PREFERENCE_BY_FACTION).find(([name]) =>
    text.includes(name),
  );
  return faction?.[1];
}

function cluePreferenceRank(preference: CluePreference): number {
  if (typeof preference === "number") return preference;
  return preference === "unowned" ? 8 : 9;
}

function sortedCluePreferences(
  preferences: Iterable<CluePreference>,
): CluePreference[] {
  return [...new Set(preferences)].sort(
    (left, right) => cluePreferenceRank(left) - cluePreferenceRank(right),
  );
}

function cluePreferencesFor(
  context: PlanContext,
  facility: EfficiencyFacility,
): CluePreference[] {
  return sortedCluePreferences(
    context.active
      .filter(
        (item) =>
          item.target?.id === facility.id && item.effect.stat === "clueChance",
      )
      .map((item) => cluePreferenceOf(item.effect))
      .filter(
        (preference): preference is CluePreference => preference !== undefined,
      ),
  );
}

function appendBasePointSource(
  sources: Record<string, BasePointSource[]>,
  term: string,
  source: BasePointSource,
): void {
  const termSources = sources[term] ?? (sources[term] = []);
  const current = termSources.find(
    (candidate) =>
      candidate.kind === source.kind &&
      candidate.operator === source.operator &&
      candidate.skill === source.skill &&
      candidate.facility === source.facility &&
      candidate.facilityIndex === source.facilityIndex &&
      candidate.slotIndex === source.slotIndex &&
      candidate.from === source.from &&
      candidate.rate === source.rate,
  );
  if (current) {
    current.value += source.value;
  } else {
    termSources.push(source);
  }
}

function orderedBasePointConversions(active: ActiveEffect[]): ActiveEffect[] {
  const pending = active.filter(
    (item) =>
      item.effect.stat === "basePointConvert" &&
      Boolean(item.effect.from) &&
      Boolean(item.effect.to),
  );
  const ordered: ActiveEffect[] = [];
  while (pending.length > 0) {
    const nextIndex = pending.findIndex(
      (candidate) =>
        !pending.some(
          (dependency) =>
            dependency !== candidate &&
            dependency.effect.to === candidate.effect.from,
        ),
    );
    const [next] = pending.splice(nextIndex >= 0 ? nextIndex : 0, 1);
    if (next) {
      ordered.push(next);
    }
  }
  return ordered;
}

function computeBasePointState(
  context: PlanContext,
  active: ActiveEffect[],
  catalog: EfficiencyCatalog,
  data: EvaluationData,
): BasePointState {
  const points: Record<string, number> = {};
  const sources: Record<string, BasePointSource[]> = {};
  active
    .filter((item) => item.effect.stat === "basePointGain")
    .forEach((item) => {
      const term = item.effect.term;
      if (!term) return;
      const value = effectValue(item, item.target, context, catalog, data);
      points[term] = (points[term] ?? 0) + value;
      if (value > EPSILON) {
        appendBasePointSource(sources, term, {
          kind: "gain",
          operator: item.owner.name,
          skill: item.skill,
          facility: item.owner.facility.type,
          facilityIndex: item.owner.facility.index,
          slotIndex: item.owner.index,
          value,
        });
      }
    });
  orderedBasePointConversions(active).forEach((item) => {
    const from = item.effect.from;
    const to = item.effect.to;
    if (!from || !to) return;
    const amount = Math.max(
      0,
      (points[from] ?? 0) * Number(item.effect.rate ?? 0),
    );
    points[to] = (points[to] ?? 0) + amount;
    if (amount > EPSILON) {
      appendBasePointSource(sources, to, {
        kind: "convert",
        operator: item.owner.name,
        skill: item.skill,
        facility: item.owner.facility.type,
        facilityIndex: item.owner.facility.index,
        slotIndex: item.owner.index,
        value: amount,
        from,
        rate: Number(item.effect.rate ?? 0),
      });
    }
  });
  return {
    points,
    details: Object.entries(points)
      .filter(([, value]) => value > EPSILON)
      .map(([term, value]) => ({
        term,
        value,
        sources: [...(sources[term] ?? [])].sort(compareBasePointSources),
      }))
      .sort((left, right) =>
        compareBasePointDetails(left, right, catalog.terms),
      ),
  };
}

function preliminaryStatValues(
  context: PlanContext,
  active: ActiveEffect[],
  catalog: EfficiencyCatalog,
): Map<string, number> {
  const values = new Map<string, number>();
  const data: EvaluationData = { capBoosts: {}, bonusByFacility: {} };
  context.facilities.forEach((facility) => {
    let total = 0;
    active
      .filter(
        (item) =>
          item.target?.id === facility.id &&
          EFFICIENCY_STATS.has(item.effect.stat),
      )
      .filter((item) => item.effect.per?.source !== "stat")
      .forEach((item) => {
        total += effectValue(item, facility, context, catalog, data);
      });
    values.set(
      `${facility.id}:${facility.type === "hire" ? "hireSpd" : facility.type === "trading" ? "tradeSpd" : facility.type === "manufacture" ? "manuProd" : "clueSpeed"}`,
      total,
    );
  });
  return values;
}

function resolveMoodRate(
  context: PlanContext,
  placement: Placement,
  catalog: EfficiencyCatalog,
  data: EvaluationData,
): { rate: number; details: MoodRateDetail[] } {
  if (!isCurrentlyWorking(placement) || !isWorkPlacement(placement)) {
    return { rate: 0, details: [] };
  }
  const details: MoodRateDetail[] = [{ kind: "base", value: 1 }];
  const controlWorkers = placementsInRoomType(context, "control").filter(
    (candidate) => isCurrentlyWorking(candidate),
  ).length;
  let rate = 1 - controlWorkers * 0.05;
  if (controlWorkers > 0) {
    details.push({
      kind: "controlWorkers",
      value: -controlWorkers * 0.05,
      count: controlWorkers,
    });
  }
  if (
    placement.facility.type === "trading" ||
    placement.facility.type === "manufacture"
  ) {
    const count = placementsInFacility(context, placement.facility).filter(
      (candidate) => isCurrentlyWorking(candidate),
    ).length;
    if (count >= 3) {
      rate -= 0.1;
      details.push({
        kind: "facilityWorkers",
        value: -0.1,
        count,
      });
    } else if (count === 2) {
      rate -= 0.05;
      details.push({
        kind: "facilityWorkers",
        value: -0.05,
        count,
      });
    }
  }
  const zeroMood = context.active
    .filter((item) => item.effect.stat === "zeroOpMood")
    .some(
      (item) =>
        effectAppliesToSubject(item, placement, placement.facility, catalog) ||
        (item.effect.group &&
          membersFor(catalog, item.effect.group).includes(placement.name)),
    );
  const skillCosts = moodEffectValues(
    context,
    placement,
    catalog,
    data,
  ).flatMap(({ item, value }) => {
    const cost = item.effect.stat === "moodRecover" ? -value : value;
    return zeroMood && cost > 0
      ? []
      : [
          {
            cost,
            detail: {
              kind: "skill" as const,
              value: cost,
              operator: item.owner.name,
              skill: item.skill,
              stat: item.effect.stat as "moodCost" | "moodRecover",
            },
          },
        ];
  });
  skillCosts.forEach(({ cost, detail }) => {
    rate += cost;
    details.push(detail);
  });
  return { rate: Math.max(0, rate), details };
}

function moodEffectValues(
  context: PlanContext,
  placement: Placement,
  catalog: EfficiencyCatalog,
  data: EvaluationData,
): Array<{ item: ActiveEffect; value: number }> {
  const normal: Array<{ item: ActiveEffect; value: number }> = [];
  const byGroup = new Map<
    string,
    Map<string, Array<{ item: ActiveEffect; value: number }>>
  >();
  context.active
    .filter(
      (item) =>
        item.effect.stat === "moodCost" || item.effect.stat === "moodRecover",
    )
    .filter((item) =>
      effectAppliesToSubject(item, placement, placement.facility, catalog),
    )
    .forEach((item) => {
      const value = effectValue(
        item,
        placement.facility,
        context,
        catalog,
        data,
      );
      if (item.effect.stack !== "max") {
        normal.push({ item, value });
        return;
      }
      const groupKey =
        item.effect.maxGroup ??
        `${item.effect.target}|${item.effect.stat}|${item.effect.recipe ?? ""}`;
      const groups =
        byGroup.get(groupKey) ??
        new Map<string, Array<{ item: ActiveEffect; value: number }>>();
      const values = groups.get(item.owner.name) ?? [];
      values.push({ item, value });
      groups.set(item.owner.name, values);
      byGroup.set(groupKey, groups);
    });
  const selected = [...normal];
  byGroup.forEach((groups) => {
    let bestName = "";
    let bestValue = -Infinity;
    groups.forEach((items, name) => {
      const value = items.reduce((total, item) => total + item.value, 0);
      if (value < bestValue) {
        return;
      }
      bestName = name;
      bestValue = value;
    });
    if (bestName) {
      selected.push(...(groups.get(bestName) ?? []));
    }
  });
  return selected;
}

function fiammettaMode(settings: ScheduleSettings): "queue" | "direct" {
  return settings.fiammettaMode === "queue" ? "queue" : "direct";
}

function fiammettaTargetForPlan(
  context: PlanContext,
  planIndex: number,
): string | undefined {
  const mode = fiammettaMode(context.settings);
  const assignment =
    mode === "queue"
      ? context.document.fiammetta?.queue?.[planIndex]
      : planIndex === 0
        ? context.document.fiammetta?.direct
        : undefined;
  return assignment?.operators?.find(Boolean);
}

function fiammettaDirectTargets(document: ScheduleDocument): string[] {
  return document.fiammetta?.direct?.operators?.filter(Boolean) ?? [];
}

function hasFiammetta(contexts: PlanContext[]): boolean {
  return contexts.some((context) =>
    context.placements.some(
      (placement) =>
        placement.name === FIAMMETTA_NAME &&
        placement.facility.type === "dormitory",
    ),
  );
}

function isFiammettaForcedTarget(
  context: PlanContext,
  placement: Placement,
  available: boolean,
): boolean {
  if (!available || placement.name === FIAMMETTA_NAME) {
    return false;
  }
  if (fiammettaMode(context.settings) === "queue") {
    return fiammettaTargetForPlan(context, context.index) === placement.name;
  }
  return fiammettaDirectTargets(context.document).includes(placement.name);
}

function fiammettaRecoveryRate(
  context: PlanContext,
  catalog: EfficiencyCatalog,
): number {
  const fiammetta = context.placements.find(
    (placement) =>
      placement.name === FIAMMETTA_NAME &&
      placement.facility.type === "dormitory",
  );
  if (!fiammetta) {
    return 0;
  }
  return fiammetta.selected
    .filter(({ effect }) => effect.stat === "moodRecover")
    .reduce(
      (total, { effect, skill }) =>
        total +
        effectValue(
          {
            owner: fiammetta,
            effect,
            skill,
            target: fiammetta.facility,
          },
          fiammetta.facility,
          context,
          catalog,
          emptyEvaluationData(),
        ),
      0,
    );
}

function resolveFiammetta(
  contexts: PlanContext[],
  catalog: EfficiencyCatalog,
): FiammettaCalculation | undefined {
  contexts.forEach((context) => {
    context.fiammettaWarnings = [];
  });
  if (!hasFiammetta(contexts)) {
    contexts.forEach((context) => {
      context.fiammetta = undefined;
    });
    return undefined;
  }

  const mode = fiammettaMode(contexts[0]?.settings ?? {});
  const results: Array<FiammettaPlanResult | undefined> = [];
  if (mode === "queue") {
    let mood = 24;
    contexts.forEach((context, index) => {
      const target = fiammettaTargetForPlan(context, index);
      const previousIndex = (index - 1 + contexts.length) % contexts.length;
      const previousTarget = target
        ? contexts[previousIndex]?.placements.find(
            (placement) => placement.name === target,
          )
        : undefined;
      const targetMood = previousTarget?.moodEnd ?? 24;
      if (target && mood < 24 - EPSILON && contexts.length > 1) {
        const previousContext = contexts[previousIndex];
        previousContext?.fiammettaWarnings.push(
          `菲亚梅塔在${previousIndex + 1}队列结束后无法恢复心情`,
        );
      }
      const start = mood;
      if (target) {
        mood = targetMood;
      }
      const recoverRate = fiammettaRecoveryRate(context, catalog);
      const recoverHours =
        recoverRate * context.durationHours > EPSILON
          ? recoverRate * context.durationHours
          : 0;
      const end = clampMood(mood + (recoverRate > EPSILON ? recoverHours : 0));
      context.fiammetta = {
        ...(target ? { target } : {}),
        targetMood,
        start,
        end,
        recoverRate,
        recoverHours,
        resting: recoverRate > EPSILON,
      };
      results.push(context.fiammetta);
      mood = end;
    });
    return {
      mode,
      plans: results,
      directTargets: [],
      totalConsumption: 0,
      totalRecovery: results.reduce(
        (total, result) => total + (result?.recoverHours ?? 0),
        0,
      ),
    };
  }

  const directTargets = fiammettaDirectTargets(contexts[0]!.document);
  let totalConsumption = 0;
  let totalRecovery = 0;
  contexts.forEach((context) => {
    const recoverRate = fiammettaRecoveryRate(context, catalog);
    const recoverHours = recoverRate * context.durationHours;
    totalRecovery += recoverHours;
    context.placements.forEach((placement) => {
      if (
        directTargets.includes(placement.name) &&
        isWorkPlacement(placement)
      ) {
        totalConsumption += placement.costRate * context.durationHours;
      }
    });
    context.fiammetta = {
      target: directTargets[context.index],
      targetMood: directTargets[context.index] ? 24 : 24,
      start: 24,
      end: 24,
      recoverRate,
      recoverHours,
      resting: recoverRate > EPSILON,
    };
    results.push(context.fiammetta);
  });
  if (totalConsumption > totalRecovery + EPSILON && directTargets.length > 0) {
    contexts[0]?.fiammettaWarnings.push("菲亚梅塔无法完全恢复这些干员心情");
  }
  return {
    mode,
    plans: results,
    directTargets,
    totalConsumption,
    totalRecovery,
  };
}

function resolveMoods(
  contexts: PlanContext[],
  catalog: EfficiencyCatalog,
): FiammettaCalculation | undefined {
  const previousWorkPlacement = (
    index: number,
    placement: Placement,
  ): { placement?: Placement; context?: PlanContext } => {
    if (contexts.length <= 1) {
      return {};
    }
    const previousIndex = (index - 1 + contexts.length) % contexts.length;
    const context = contexts[previousIndex];
    return {
      placement: context?.placements.find(
        (candidate) =>
          candidate.name === placement.name &&
          candidate.facility.id === placement.facility.id &&
          candidate.index === placement.index,
      ),
      context,
    };
  };
  const previousMoodPlacement = (
    index: number,
    placement: Placement,
  ): { placement?: Placement; context?: PlanContext } => {
    if (contexts.length <= 1) {
      return {};
    }
    const previousIndex = (index - 1 + contexts.length) % contexts.length;
    const context = contexts[previousIndex];
    return {
      placement: context?.placements.find(
        (candidate) => candidate.name === placement.name,
      ),
      context,
    };
  };
  const fiammettaAvailable = hasFiammetta(contexts);
  contexts.forEach((context) => {
    context.placements.forEach((placement) => {
      placement.fiammettaForced = isFiammettaForcedTarget(
        context,
        placement,
        fiammettaAvailable,
      );
    });
  });
  const unanchoredCycleOperators = new Set(
    contexts.length > 1
      ? contexts[0]?.placements
          .map((placement) => placement.name)
          .filter((name) =>
            contexts.every((context) => {
              const placement = context.placements.find(
                (candidate) => candidate.name === name,
              );
              return (
                !!placement &&
                isMoodContinuityPlacement(placement) &&
                !placement.explicitMood
              );
            }),
          )
          .filter((name) =>
            contexts.some((context) => {
              const placement = context.placements.find(
                (candidate) => candidate.name === name,
              );
              return !!placement && isWorkPlacement(placement);
            }),
          )
      : [],
  );
  const canInheritMood = (
    previous: Placement | undefined,
    current: Placement,
  ): previous is Placement =>
    !!previous &&
    isMoodContinuityPlacement(previous) &&
    isMoodContinuityPlacement(current);
  const canContinueWork = (
    previous: Placement | undefined,
    current: Placement,
  ): previous is Placement =>
    !!previous &&
    isCurrentlyWorking(previous) &&
    previous.moodStart > EPSILON &&
    isWorkPlacement(previous) &&
    isWorkPlacement(current) &&
    (!current.explicitMood || clampMood(current.state.mood ?? 24) > EPSILON);

  contexts.forEach((context, index) => {
    context.placements.forEach((placement) => {
      const previousMood = previousMoodPlacement(index, placement);
      const previousOperator = previousMood.placement;
      const inheritsMood = canInheritMood(previousOperator, placement);
      const previousWork = previousWorkPlacement(index, placement);
      const previousWorkOperator = previousWork.placement;
      const continuesWork = canContinueWork(previousWorkOperator, placement);
      placement.moodStart = placement.fiammettaForced
        ? 24
        : placement.explicitMood
          ? clampMood(placement.state.mood ?? 24)
          : inheritsMood
            ? previousOperator.moodEnd
            : unanchoredCycleOperators.has(placement.name)
              ? 0
              : 24;
      placement.working = true;
      placement.workHoursBefore = continuesWork
        ? previousWorkOperator.workHoursBefore +
          (previousWork.context?.durationHours ?? 0)
        : 0;
      placement.moodEnd = placement.moodStart;
    });
  });

  for (let round = 0; round < 8; round += 1) {
    let maxStartDelta = 0;
    contexts.forEach((context, index) => {
      context.placements.forEach((placement) => {
        const previousMood = previousMoodPlacement(index, placement);
        const previousOperator = previousMood.placement;
        const inheritsMood = canInheritMood(previousOperator, placement);
        const previousWork = previousWorkPlacement(index, placement);
        const previousWorkOperator = previousWork.placement;
        const continuesWork = canContinueWork(previousWorkOperator, placement);
        const nextStart = placement.fiammettaForced
          ? 24
          : placement.explicitMood
            ? clampMood(placement.state.mood ?? 24)
            : inheritsMood
              ? previousOperator.moodEnd
              : unanchoredCycleOperators.has(placement.name)
                ? 0
                : 24;
        maxStartDelta = Math.max(
          maxStartDelta,
          Math.abs(nextStart - placement.moodStart),
        );
        placement.moodStart = nextStart;
        placement.working = true;
        placement.workHoursBefore = continuesWork
          ? previousWorkOperator.workHoursBefore +
            (previousWork.context?.durationHours ?? 0)
          : 0;
      });
      const emptyData: EvaluationData = { capBoosts: {}, bonusByFacility: {} };
      context.active = collectActive(context, catalog, true);
      const preliminaryPointState = computeBasePointState(
        context,
        context.active,
        catalog,
        emptyData,
      );
      context.basePoints = preliminaryPointState.points;
      context.basePointDetails = preliminaryPointState.details;
      context.active = collectActive(context, catalog, false);
      const pointState = computeBasePointState(
        context,
        context.active,
        catalog,
        emptyData,
      );
      context.basePoints = pointState.points;
      context.basePointDetails = pointState.details;
      context.statValues = preliminaryStatValues(
        context,
        context.active,
        catalog,
      );
      context.active = collectActive(context, catalog, false);
      context.placements.forEach((placement) => {
        const moodRate = resolveMoodRate(
          context,
          placement,
          catalog,
          emptyData,
        );
        placement.costRate = moodRate.rate;
        placement.moodRateDetails = moodRate.details;
        placement.moodEnd = isWorkPlacement(placement)
          ? clampMood(
              placement.moodStart - placement.costRate * context.durationHours,
            )
          : placement.moodStart;
      });
    });
    if (maxStartDelta <= EPSILON) {
      break;
    }
  }
  contexts.forEach((context, index) => {
    context.moodWarnings = context.placements.flatMap((placement) => {
      if (!placement.explicitMood) {
        return [];
      }
      const previous = previousMoodPlacement(index, placement).placement;
      const configuredStart = clampMood(placement.state.mood ?? 24);
      if (
        !previous ||
        !isMoodContinuityPlacement(previous) ||
        !isMoodContinuityPlacement(placement) ||
        previous.moodEnd >= configuredStart
      ) {
        return [];
      }
      return [
        {
          operator: placement.name,
          facility: placement.facility.type,
          facilityId: placement.facility.id,
          facilityIndex: placement.facility.index,
          slotIndex: placement.index,
          previousEnd: previous.moodEnd,
          configuredStart,
        },
      ];
    });
  });
  return resolveFiammetta(contexts, catalog);
}

function recipeMatches(
  effect: EfficiencyEffect,
  assignment: RoomAssignment,
): boolean {
  if (!effect.recipe || !assignment.product) return !effect.recipe;
  return (
    manufactureRule(assignment.product, assignment.sourceMaterial)?.recipe ===
    effect.recipe
  );
}

function emptyEvaluationData(): EvaluationData {
  return { capBoosts: {}, bonusByFacility: {} };
}

function rawAttributeState(
  context: PlanContext,
  facility: EfficiencyFacility,
  catalog: EfficiencyCatalog,
  active: ActiveEffect[],
): AttributeState {
  const data = emptyEvaluationData();
  const assignment = roomAssignments(context.document, context.index, facility);
  const baseOrder =
    facility.type === "trading" ? (TRADE_ORDER_LIMIT[facility.level] ?? 0) : 0;
  const baseStorage =
    facility.type === "manufacture"
      ? (MANUFACTURE_STORAGE[facility.level] ?? 0)
      : 0;
  const raw: Record<string, number> = { orderLimit: 0, storageCap: 0 };
  const boosts: Record<string, Record<string, number>> = {
    orderLimit: {},
    storageCap: {},
  };
  active
    .filter(
      (item) =>
        item.target?.id === facility.id &&
        ATTRIBUTE_STATS.has(item.effect.stat),
    )
    .filter(
      (item) =>
        item.effect.per?.source !== "stat" &&
        item.effect.per?.source !== "facCap" &&
        item.effect.per?.source !== "capTier",
    )
    .filter((item) => recipeMatches(item.effect, assignment))
    .forEach((item) => {
      const value = effectValue(item, facility, context, catalog, data);
      raw[item.effect.stat] = (raw[item.effect.stat] ?? 0) + value;
      const statBoosts =
        boosts[item.effect.stat] ?? (boosts[item.effect.stat] = {});
      statBoosts[item.owner.name] = (statBoosts[item.owner.name] ?? 0) + value;
    });
  const capData: EvaluationData = { capBoosts: boosts, bonusByFacility: {} };
  active
    .filter(
      (item) =>
        item.target?.id === facility.id &&
        ATTRIBUTE_STATS.has(item.effect.stat),
    )
    .filter((item) =>
      ["facCap", "capTier"].includes(item.effect.per?.source ?? ""),
    )
    .filter((item) => recipeMatches(item.effect, assignment))
    .forEach((item) => {
      const value = effectValue(item, facility, context, catalog, capData);
      raw[item.effect.stat] = (raw[item.effect.stat] ?? 0) + value;
      const statBoosts =
        boosts[item.effect.stat] ?? (boosts[item.effect.stat] = {});
      statBoosts[item.owner.name] = (statBoosts[item.owner.name] ?? 0) + value;
    });
  const linked =
    facility.type === "trading" &&
    active.some(
      (item) =>
        item.target?.id === facility.id &&
        item.effect.per?.source === "stat" &&
        item.effect.stat === "orderLimit",
    );
  const attributes: FacilityAttributes = {};
  if (facility.type === "trading") {
    const skill = raw.orderLimit ?? 0;
    attributes.orderLimit = {
      base: baseOrder,
      skill,
      total: Math.max(1, baseOrder + skill),
    };
  }
  if (facility.type === "manufacture") {
    const skill = raw.storageCap ?? 0;
    attributes.storageCap = {
      base: baseStorage,
      skill,
      total: baseStorage + skill,
    };
  }
  return {
    attributes,
    rawOrderLimit: raw.orderLimit ?? 0,
    capBoosts: boosts,
    linked,
    orderLimitNet: raw.orderLimit ?? 0,
  };
}

function zeroedSkillOperators(
  context: PlanContext,
  facility: EfficiencyFacility,
): Set<string> {
  const zeroingOperators = new Set(
    context.active
      .filter(
        (item) =>
          item.target?.id === facility.id && item.effect.stat === "zeroOpBonus",
      )
      .map((item) => item.owner.name),
  );
  if (zeroingOperators.size === 0) {
    return new Set<string>();
  }
  return new Set(
    context.active
      .filter(
        (item) =>
          item.target?.id === facility.id &&
          !zeroingOperators.has(item.owner.name),
      )
      .map((item) => item.owner.name),
  );
}

function isFacilitySkillEffect(item: ActiveEffect): boolean {
  return (
    item.effect.stack === "max" &&
    DIRECT_FACILITY_EFFICIENCY_STATS.has(item.effect.stat)
  );
}

function isZeroExemptEffect(item: ActiveEffect): boolean {
  const source = item.effect.per?.source;
  return (
    isFacilityBaseEffect(item) ||
    isFacilitySkillEffect(item) ||
    (typeof source === "string" &&
      item.effect.except?.includes(source) === true)
  );
}

function shouldIncludeZeroedEffect(
  item: ActiveEffect,
  zeroed: Set<string>,
): boolean {
  return !zeroed.has(item.owner.name) || isZeroExemptEffect(item);
}

function aggregateEffectValues(
  context: PlanContext,
  facility: EfficiencyFacility,
  catalog: EfficiencyCatalog,
  active: ActiveEffect[],
  data: EvaluationData,
  zeroed: Set<string>,
  stats: Set<string>,
  category: "all" | "base" | "combination" = "all",
  source: "regular" | "stat" = "regular",
): { total: number; details: Array<{ item: ActiveEffect; value: number }> } {
  const matchesCategory = (item: ActiveEffect): boolean => {
    const base = isFacilityBaseEffect(item);
    return category === "all" || (category === "base" ? base : !base);
  };
  const matchesSource = (item: ActiveEffect): boolean =>
    source === "stat"
      ? item.effect.per?.source === "stat"
      : item.effect.per?.source !== "stat" &&
        item.effect.per?.source !== "orderCount";
  const normal: Array<{ item: ActiveEffect; value: number }> = [];
  active
    .filter(
      (item) => item.target?.id === facility.id && stats.has(item.effect.stat),
    )
    .filter(matchesCategory)
    .filter((item) =>
      recipeMatches(
        item.effect,
        roomAssignments(context.document, context.index, facility),
      ),
    )
    .filter((item) => item.effect.stat !== "tradeNetEff")
    .filter(matchesSource)
    .filter((item) => !["moodCost", "moodRecover"].includes(item.effect.stat))
    .filter((item) => item.effect.stack !== "max")
    .filter((item) => shouldIncludeZeroedEffect(item, zeroed))
    .forEach((item) =>
      normal.push({
        item,
        value: effectValue(item, facility, context, catalog, data),
      }),
    );
  const byGroup = new Map<
    string,
    Map<string, Array<{ item: ActiveEffect; value: number }>>
  >();
  active
    .filter(
      (item) => item.target?.id === facility.id && stats.has(item.effect.stat),
    )
    .filter(matchesCategory)
    .filter((item) =>
      recipeMatches(
        item.effect,
        roomAssignments(context.document, context.index, facility),
      ),
    )
    .filter(matchesSource)
    .filter((item) => item.effect.stack === "max")
    .filter((item) => item.effect.stat !== "tradeNetEff")
    .filter((item) => shouldIncludeZeroedEffect(item, zeroed))
    .forEach((item) => {
      const groupKey =
        item.effect.maxGroup ??
        `${item.effect.target}|${item.effect.stat}|${item.effect.recipe ?? ""}`;
      const groups =
        byGroup.get(groupKey) ??
        new Map<string, Array<{ item: ActiveEffect; value: number }>>();
      const values = groups.get(item.owner.name) ?? [];
      values.push({
        item,
        value: effectValue(item, facility, context, catalog, data),
      });
      groups.set(item.owner.name, values);
      byGroup.set(groupKey, groups);
    });
  let total = normal.reduce((sum, item) => sum + item.value, 0);
  const details = [...normal];
  byGroup.forEach((groups) => {
    let bestName = "";
    let bestValue = -Infinity;
    groups.forEach((items, name) => {
      const value = items.reduce((sum, item) => sum + item.value, 0);
      if (value > bestValue) {
        bestName = name;
        bestValue = value;
      }
    });
    if (bestName && Number.isFinite(bestValue)) {
      total += bestValue;
      details.push(...(groups.get(bestName) ?? []));
    }
  });
  return { total, details };
}

function collectBonusByFacility(
  context: PlanContext,
  catalog: EfficiencyCatalog,
  attributeStates: Map<string, AttributeState>,
): Record<string, Record<string, Record<string, number>>> {
  const result: Record<string, Record<string, Record<string, number>>> = {};
  context.facilities.forEach((facility) => {
    const data = {
      capBoosts: attributeStates.get(facility.id)?.capBoosts ?? {},
      bonusByFacility: result,
    };
    const zeroed = zeroedSkillOperators(context, facility);
    const stats = new Set([
      "tradeSpd",
      "manuProd",
      "clueSpeed",
      "hireSpd",
      "droneCharge",
      "abyssalBoost",
    ]);
    const aggregate = aggregateEffectValues(
      context,
      facility,
      catalog,
      context.active.filter(
        (item) =>
          item.owner.facility.id === facility.id &&
          !["facilityCount", "powerCount"].includes(
            item.effect.per?.source ?? "",
          ),
      ),
      data,
      zeroed,
      stats,
    );
    const byOperator: Record<string, Record<string, number>> = {};
    aggregate.details.forEach(({ item, value }) => {
      const values =
        byOperator[item.owner.name] ?? (byOperator[item.owner.name] = {});
      values[item.effect.stat] = (values[item.effect.stat] ?? 0) + value;
    });
    result[facility.id] = byOperator;
  });
  return result;
}

function calculateAttributes(
  context: PlanContext,
  catalog: EfficiencyCatalog,
): Map<string, AttributeState> {
  const states = new Map<string, AttributeState>();
  context.facilities.forEach((facility) => {
    states.set(
      facility.id,
      rawAttributeState(context, facility, catalog, context.active),
    );
  });
  return states;
}

function tradeSpecialEfficiency(
  context: PlanContext,
  facility: EfficiencyFacility,
  catalog: EfficiencyCatalog,
  state: AttributeState,
  active: ActiveEffect[],
  data: EvaluationData,
  zeroed: Set<string>,
  ordinarySkill: number,
): {
  value: number;
  orderLimitNet: number;
  details: Array<{ item: ActiveEffect; value: number }>;
} {
  if (facility.type !== "trading") {
    return { value: 0, orderLimitNet: state.rawOrderLimit, details: [] };
  }
  const jieEffects = active.filter(
    (item) =>
      item.target?.id === facility.id &&
      item.effect.stat === "orderLimit" &&
      item.effect.per?.source === "stat",
  );
  const netEffects = active
    .filter(
      (item) =>
        item.target?.id === facility.id && item.effect.stat === "tradeNetEff",
    )
    .filter((item) => shouldIncludeZeroedEffect(item, zeroed));
  const orderEffects = active
    .filter(
      (item) =>
        item.target?.id === facility.id &&
        item.effect.stat === "tradeSpd" &&
        item.effect.per?.source === "orderCount",
    )
    .filter((item) => shouldIncludeZeroedEffect(item, zeroed));
  const baseOrder = TRADE_ORDER_LIMIT[facility.level] ?? 0;
  if (
    jieEffects.length === 0 &&
    netEffects.length === 0 &&
    orderEffects.length === 0
  ) {
    return { value: 0, orderLimitNet: state.rawOrderLimit, details: [] };
  }
  const cut = jieEffects.reduce((total, item) => {
    const per = item.effect.per;
    const perUnit = Number(per?.per ?? 10);
    const amount = Math.abs(Number(per?.value ?? 1));
    return total + Math.floor(Math.max(0, ordinarySkill) / perUnit) * amount;
  }, 0);
  const orderLimitNet =
    jieEffects.length > 0
      ? Math.max(1, state.rawOrderLimit - cut)
      : state.rawOrderLimit;
  const details: Array<{ item: ActiveEffect; value: number }> = [];
  let value = 0;
  netEffects.forEach((item) => {
    const specialData: EvaluationData = {
      ...data,
      capBoosts: { ...data.capBoosts, orderLimit: { linked: orderLimitNet } },
    };
    const specialValue = effectValue(
      item,
      facility,
      context,
      catalog,
      specialData,
    );
    value += specialValue;
    details.push({ item, value: specialValue });
  });
  orderEffects.forEach((item) => {
    const perValue = Number(item.effect.per?.value ?? item.effect.value ?? 0);
    const specialValue = baseOrder * perValue;
    value += specialValue;
    details.push({ item, value: specialValue });
  });
  return { value, orderLimitNet, details };
}

function detailRows(
  aggregate: { details: Array<{ item: ActiveEffect; value: number }> },
  facility: RoomKey,
  category: "base" | "combination",
  context: PlanContext,
): OperatorEfficiencyDetail[] {
  return aggregate.details
    .map(({ item, value }) => ({
      item,
      value,
      calculation: effectCalculation(item, context),
    }))
    .filter(
      ({ value, calculation }) =>
        Math.abs(value) > EPSILON || calculation !== undefined,
    )
    .map(({ item, value, calculation }) => ({
      operator: item.owner.name,
      skill: item.skill,
      stat: item.effect.stat,
      value,
      facility,
      ownerFacility: item.owner.facility.type,
      ...(item.effect.stack !== undefined ? { stack: item.effect.stack } : {}),
      category,
      ...(calculation ? { calculation } : {}),
    }));
}

function operatorBaseEfficiency(
  facility: EfficiencyFacility,
  placement: Placement,
): number {
  if (facility.type === "meeting") {
    return isCurrentlyWorking(placement) ? 5 : 0;
  }
  if (
    facility.type === "power" ||
    facility.type === "hire" ||
    facility.type === "trading" ||
    facility.type === "manufacture"
  ) {
    const value =
      facility.type === "trading" || facility.type === "manufacture" ? 1 : 5;
    return isCurrentlyWorking(placement) ? value : 0;
  }
  return 0;
}

function operatorTrainingEfficiency(placement: Placement): number {
  return (
    rarityEfficiency(placement.profile?.rarity ?? 0) +
    eliteEfficiency(placement.state.elite ?? 0)
  );
}

function isFacilitySkillDetail(detail: OperatorEfficiencyDetail): boolean {
  return (
    detail.stack === "max" && DIRECT_FACILITY_EFFICIENCY_STATS.has(detail.stat)
  );
}

function operatorContributions(
  placements: Placement[],
  combinationDetails: OperatorEfficiencyDetail[],
): OperatorEfficiencyContribution[] {
  const skillValues = new Map<string, number>();
  const sourceFacilities = new Map<string, RoomKey>();
  combinationDetails
    .filter((detail) => !isFacilitySkillDetail(detail))
    .forEach((detail) => {
      skillValues.set(
        detail.operator,
        (skillValues.get(detail.operator) ?? 0) + detail.value,
      );
      sourceFacilities.set(
        detail.operator,
        detail.ownerFacility ?? detail.facility,
      );
    });
  const contributions = new Map<string, OperatorEfficiencyContribution>();
  placements.forEach((placement) => {
    const baseEfficiency = operatorBaseEfficiency(
      placement.facility,
      placement,
    );
    const skillEfficiency = skillValues.get(placement.name) ?? 0;
    const contribution = {
      operator: placement.name,
      baseEfficiency,
      skillEfficiency,
      efficiency: baseEfficiency + skillEfficiency,
      sourceFacility: placement.facility.type,
    };
    if (Math.abs(contribution.efficiency) > EPSILON) {
      contributions.set(placement.name, contribution);
    }
  });
  skillValues.forEach((value, operator) => {
    if (contributions.has(operator) || Math.abs(value) <= EPSILON) {
      return;
    }
    contributions.set(operator, {
      operator,
      baseEfficiency: 0,
      skillEfficiency: value,
      efficiency: value,
      sourceFacility: sourceFacilities.get(operator),
    });
  });
  return Array.from(contributions.values());
}

function calculateFacility(
  context: PlanContext,
  facility: EfficiencyFacility,
  catalog: EfficiencyCatalog,
  attributeState: AttributeState,
  bonusByFacility: Record<string, Record<string, Record<string, number>>>,
): FacilityEfficiencyResult {
  const resolvedAssignment = resolveRoomAssignment(
    context.document,
    context.index,
    facility.type,
    facility.index,
  );
  const data: EvaluationData = {
    capBoosts: attributeState.capBoosts,
    bonusByFacility,
  };
  const zeroed = zeroedSkillOperators(context, facility);
  const baseAggregate = aggregateEffectValues(
    context,
    facility,
    catalog,
    context.active,
    data,
    new Set<string>(),
    new Set([...EFFICIENCY_STATS, "facBase"]),
    "base",
  );
  const combinationAggregate = aggregateEffectValues(
    context,
    facility,
    catalog,
    context.active,
    data,
    zeroed,
    EFFICIENCY_STATS,
    "combination",
  );
  const statAggregate = aggregateEffectValues(
    context,
    facility,
    catalog,
    context.active,
    data,
    zeroed,
    EFFICIENCY_STATS,
    "combination",
    "stat",
  );
  const placements = placementsInFacility(context, facility);
  const moodEfficiency = placements.reduce(
    (total, placement) => total + operatorBaseEfficiency(facility, placement),
    0,
  );
  let baseEfficiency = facilityBaseEfficiency(facility.type, facility.level);
  if (facility.type === "meeting") {
    const atmosphere = context.facilities
      .filter((candidate) => candidate.type === "dormitory")
      .reduce((total, candidate) => total + candidate.level * 1000, 0);
    baseEfficiency += meetingAtmosphereBonus(atmosphere);
  }
  baseEfficiency += baseAggregate.total;
  const special = tradeSpecialEfficiency(
    context,
    facility,
    catalog,
    attributeState,
    context.active,
    data,
    zeroed,
    combinationAggregate.total,
  );
  if (facility.type === "trading" && attributeState.attributes.orderLimit) {
    const raw = attributeState.rawOrderLimit;
    const skill = attributeState.linked ? special.orderLimitNet : raw;
    attributeState.attributes.orderLimit = {
      base: attributeState.attributes.orderLimit.base,
      skill,
      total: Math.max(1, attributeState.attributes.orderLimit.base + skill),
    };
  }
  const trainingDetails: OperatorEfficiencyDetail[] =
    facility.type === "meeting"
      ? placements
          .map((placement) => ({
            operator: placement.name,
            stat: "operatorTraining",
            value: operatorTrainingEfficiency(placement),
            facility: facility.type,
            ownerFacility: placement.facility.type,
            category: "combination" as const,
          }))
          .filter((detail) => Math.abs(detail.value) > EPSILON)
      : [];
  const trainingEfficiency = trainingDetails.reduce(
    (total, detail) => total + detail.value,
    0,
  );
  const skillEfficiency =
    combinationAggregate.total +
    statAggregate.total +
    special.value +
    trainingEfficiency;
  const baseDetails = detailRows(baseAggregate, facility.type, "base", context);
  const combinationDetails = [
    ...detailRows(combinationAggregate, facility.type, "combination", context),
    ...detailRows(statAggregate, facility.type, "combination", context),
    ...detailRows(special, facility.type, "combination", context),
    ...trainingDetails,
  ];
  const facilitySkillEfficiency = combinationDetails.reduce(
    (total, detail) =>
      total + (isFacilitySkillDetail(detail) ? detail.value : 0),
    0,
  );
  const operatorSkillEfficiency = skillEfficiency - facilitySkillEfficiency;
  const details = [...baseDetails, ...combinationDetails];
  const cluePreferences =
    facility.type === "meeting" ? cluePreferencesFor(context, facility) : [];
  const result: FacilityEfficiencyResult = {
    facility,
    inherited: resolvedAssignment.inherited,
    inheritedFromPlanIndex: resolvedAssignment.sourcePlanIndex,
    baseEfficiency,
    moodEfficiency,
    operatorEfficiency: moodEfficiency,
    skillEfficiency,
    operatorSkillEfficiency,
    facilitySkillEfficiency,
    combinationEfficiency: moodEfficiency + skillEfficiency,
    efficiency: baseEfficiency + moodEfficiency + skillEfficiency,
    attributes: attributeState.attributes,
    ...(cluePreferences.length > 0 ? { cluePreferences } : {}),
    details,
    baseDetails,
    combinationDetails,
    operatorContributions: operatorContributions(
      placements,
      combinationDetails,
    ),
  };
  result.production = decorateProduction(
    context,
    facility,
    attributeState.attributes,
    productionFor(
      context,
      facility,
      result.efficiency,
      catalog,
      context.active,
    ),
  );
  if (result.production && cluePreferences.length > 0) {
    result.production.cluePreferences = cluePreferences;
  }
  result.capacity = capacityFor(
    context,
    facility,
    attributeState.attributes,
    result.production,
  );
  return result;
}

function uniqueTradeOrders(
  active: ActiveEffect[],
  facility: EfficiencyFacility,
): EfficiencyEffect[] {
  return active
    .filter(
      (item) =>
        item.target?.id === facility.id && item.effect.stat === "tradeOrder",
    )
    .map((item) => item.effect);
}

function tradeProduction(
  context: PlanContext,
  facility: EfficiencyFacility,
  efficiency: number,
  active: ActiveEffect[],
): ProductionValue | undefined {
  const assignment = roomAssignments(context.document, context.index, facility);
  const product = assignment.product ?? "LMD";
  if (product === "Orundum") {
    const multiplier = efficiency / 100;
    const baseAmountPerHour = 20 / 2;
    return {
      product,
      baseAmountPerHour,
      baseAmountPerDay: baseAmountPerHour * 24,
      amountPerHour: baseAmountPerHour * multiplier,
      amountPerDay: baseAmountPerHour * multiplier * 24,
      itemRate: multiplier / 2,
      orderRule: "开采协力",
      orders: [
        {
          name: "源石订单",
          probability: 1,
          quantity: 20,
          time: 2,
          material: "Originium Shard",
          amount: 2,
        },
      ],
      materialPerHour: { "Originium Shard": (-2 / 2) * multiplier },
    };
  }
  const orders = uniqueTradeOrders(active, facility);
  const fixed = orders
    .filter((order) => order.order?.type === "fixed")
    .sort(
      (left, right) =>
        Number(left.order?.priority ?? 99) -
        Number(right.order?.priority ?? 99),
    )[0];
  const multiplier = efficiency / 100;
  if (fixed?.order) {
    const baseAmountPerHour =
      Number(fixed.order.qty ?? 0) / Number(fixed.order.time ?? 1);
    const amountPerHour =
      baseAmountPerHour * (fixed.order.ignoreEff ? 1 : multiplier);
    const material: Record<string, number> = {};
    if (fixed.order.material && fixed.order.amount) {
      material[fixed.order.material] =
        (Number(fixed.order.amount) / Number(fixed.order.time ?? 1)) *
        (fixed.order.ignoreEff ? 1 : multiplier);
    }
    return {
      product: "LMD",
      baseAmountPerHour,
      baseAmountPerDay: baseAmountPerHour * 24,
      amountPerHour,
      amountPerDay: amountPerHour * 24,
      itemRate:
        (fixed.order.ignoreEff ? 1 : multiplier) /
        Number(fixed.order.time ?? 1),
      orderRule: `固定订单：${fixed.order.orderName ?? "特殊订单"}`,
      orders: [
        {
          name: fixed.order.orderName ?? "特殊订单",
          probability: 1,
          quantity: Number(fixed.order.qty ?? 0),
          time: Number(fixed.order.time ?? 0),
          material: fixed.order.material,
          amount: Number(fixed.order.amount ?? 0),
          ignoreEfficiency: fixed.order.ignoreEff,
        },
      ],
      materialPerHour: material,
    };
  }
  const sourceOrders = (
    TRADE_ORDERS[facility.level] ??
    TRADE_ORDERS[1] ??
    []
  ).map((order) => ({ ...order }));
  const tailorAlpha = orders.filter(
    (order) => order.order?.type === "tailor" && order.order.level === "α",
  ).length;
  const tailorBeta = orders.filter(
    (order) => order.order?.type === "tailor" && order.order.level === "β",
  ).length;
  const tailorKey =
    tailorAlpha === 1 && tailorBeta === 0
      ? "1α"
      : tailorAlpha === 2 && tailorBeta === 0
        ? "2α"
        : tailorAlpha === 1 && tailorBeta === 1
          ? "1α1β"
          : "";
  if (facility.level === 3 && tailorKey) {
    const probabilities = TAILOR_PROBABILITIES[tailorKey];
    sourceOrders.forEach((order, index) => {
      order.probability = probabilities?.[index] ?? order.probability;
    });
  }
  const fixValues = orders.find(
    (order) => order.order?.type === "fixValues",
  )?.order;
  const breach = fixValues
    ? []
    : orders.filter((order) => order.order?.type === "breach");
  const invest = fixValues
    ? []
    : orders.filter((order) => order.order?.type === "invest");
  const breachByAmount = new Map<number, number>();
  breach.forEach((order) => {
    if (order.order?.amount !== undefined && order.order.qty !== undefined) {
      breachByAmount.set(Number(order.order.amount), Number(order.order.qty));
    }
  });
  const investAmount = invest.reduce(
    (total, order) => total + Number(order.order?.qty ?? 0),
    0,
  );
  let expectedGold = 0;
  let expectedTime = 0;
  let expectedMaterial = 0;
  const orderSummaries: TradeOrderSummary[] = [];
  sourceOrders.forEach((order) => {
    const gold =
      fixValues?.qty !== undefined
        ? Number(fixValues.qty)
        : Number(order.gold) +
          (breachByAmount.get(order.amount) ?? 0) +
          (order.amount === 4 ? investAmount : 0);
    const material =
      fixValues?.amount !== undefined ? Number(fixValues.amount) : order.amount;
    const notes: string[] = [];
    if (fixValues?.qty !== undefined) notes.push("金额替换");
    if (breachByAmount.has(order.amount)) notes.push("违约索赔");
    if (order.amount === 4 && investAmount > 0) notes.push("投资");
    expectedGold += order.probability * gold;
    expectedTime += order.probability * order.hours;
    expectedMaterial += order.probability * material;
    orderSummaries.push({
      name: order.name,
      probability: order.probability,
      quantity: gold,
      time: order.hours,
      material: "Pure Gold",
      amount: material,
      ...(notes.length ? { note: notes.join("、") } : {}),
    });
  });
  if (expectedTime <= EPSILON) return undefined;
  const baseAmountPerHour = expectedGold / expectedTime;
  const amountPerHour = baseAmountPerHour * multiplier;
  return {
    product: "LMD",
    baseAmountPerHour,
    baseAmountPerDay: baseAmountPerHour * 24,
    amountPerHour,
    amountPerDay: amountPerHour * 24,
    itemRate: multiplier / expectedTime,
    orderRule:
      fixValues || breach.length || invest.length || tailorKey
        ? "龙门商法（含特殊规则）"
        : "龙门商法",
    orders: orderSummaries,
    materialPerHour: {
      "Pure Gold": (expectedMaterial / expectedTime) * multiplier,
    },
  };
}

function productionFor(
  context: PlanContext,
  facility: EfficiencyFacility,
  efficiency: number,
  catalog: EfficiencyCatalog,
  active: ActiveEffect[],
): ProductionValue | undefined {
  const assignment = roomAssignments(context.document, context.index, facility);
  if (facility.type === "trading")
    return tradeProduction(context, facility, efficiency, active);
  if (facility.type === "manufacture") {
    const rule = manufactureRule(assignment.product, assignment.sourceMaterial);
    if (!rule) return undefined;
    const multiplier = efficiency / 100;
    const baseAmountPerHour = rule.amount / rule.hours;
    return {
      product: rule.product,
      baseAmountPerHour,
      baseAmountPerDay: baseAmountPerHour * 24,
      amountPerHour: baseAmountPerHour * multiplier,
      amountPerDay: baseAmountPerHour * multiplier * 24,
      itemRate: baseAmountPerHour * multiplier,
      materialPerHour: Object.fromEntries(
        Object.entries(rule.materials ?? {}).map(([material, amount]) => [
          material,
          (amount / rule.hours) * multiplier,
        ]),
      ),
    };
  }
  if (facility.type === "meeting") {
    const baseAmountPerHour = CLUE_OUTPUT_PER_HOUR;
    const amountPerHour = (baseAmountPerHour * efficiency) / 100;
    return {
      product: "Clue",
      conversion: {
        label: "信用点",
        amountPerUnit: CREDIT_PER_CLUE,
        sourceUnit: "线索",
        baseCycleHours: CLUE_BASE_TIME_HOURS,
      },
      baseAmountPerHour,
      baseAmountPerDay: baseAmountPerHour * 24,
      amountPerHour,
      amountPerDay: amountPerHour * 24,
      itemRate: amountPerHour,
    };
  }
  if (facility.type === "hire") {
    const baseAmountPerHour = HIRE_OUTPUT_PER_HOUR;
    const amountPerHour = (baseAmountPerHour * efficiency) / 100;
    return {
      product: "Recruit Refresh",
      baseAmountPerHour,
      baseAmountPerDay: baseAmountPerHour * 24,
      amountPerHour,
      amountPerDay: amountPerHour * 24,
      itemRate: amountPerHour,
    };
  }
  void catalog;
  return undefined;
}

function capacityFor(
  context: PlanContext,
  facility: EfficiencyFacility,
  attributes: FacilityAttributes,
  production: ProductionValue | undefined,
): FacilityCapacity | undefined {
  if (facility.type === "trading") {
    const value = attributes.orderLimit;
    if (!value) return undefined;
    return {
      label: "订单上限",
      unit: "单",
      base: value.base,
      skill: value.skill,
      total: value.total,
    };
  }
  if (facility.type === "manufacture") {
    const value = attributes.storageCap;
    if (!value) return undefined;
    const assignment = roomAssignments(
      context.document,
      context.index,
      facility,
    );
    const rule = manufactureRule(assignment.product, assignment.sourceMaterial);
    return {
      label: "仓库容量",
      unit: "格",
      base: value.base,
      skill: value.skill,
      total: value.total,
      itemVolume: rule?.volume,
    };
  }
  if (facility.type === "power") {
    return {
      label: "无人机上限",
      unit: "架",
      base: DRONE_LIMIT,
      skill: 0,
      total: DRONE_LIMIT,
    };
  }
  if (facility.type === "meeting") {
    return {
      label: "线索上限",
      unit: "条",
      base: CLUE_LIMIT,
      skill: 0,
      total: CLUE_LIMIT,
    };
  }
  if (facility.type === "hire") {
    return {
      label: "刷新次数上限",
      unit: "次",
      base: HIRE_LIMIT,
      skill: 0,
      total: HIRE_LIMIT,
    };
  }
  void production;
  return undefined;
}

function decorateProduction(
  context: PlanContext,
  facility: EfficiencyFacility,
  attributes: FacilityAttributes,
  production: ProductionValue | undefined,
): ProductionValue | undefined {
  if (!production) return undefined;
  const capacity = capacityFor(context, facility, attributes, production);
  if (!capacity || !production.itemRate || production.itemRate <= EPSILON) {
    return production;
  }
  const itemCapacity =
    facility.type === "manufacture" && capacity.itemVolume
      ? Math.floor(capacity.total / capacity.itemVolume)
      : capacity.total;
  const progress = firstItemProgress(context.settings, facility.id);
  const breachTime = Math.max(
    0,
    (itemCapacity - progress) / production.itemRate,
  );
  const overflowed = breachTime <= context.durationHours + EPSILON;
  if (!overflowed || context.settings.overflowMode !== "zero") {
    return {
      ...production,
      breachTime,
      overflowed,
    };
  }
  const effectiveHours = Math.max(
    0,
    Math.min(context.durationHours, breachTime),
  );
  const ratio =
    context.durationHours > EPSILON
      ? effectiveHours / context.durationHours
      : 0;
  const effectiveAmountPerHour = production.amountPerHour * ratio;
  const effectiveMaterialPerHour = Object.fromEntries(
    Object.entries(production.materialPerHour ?? {}).map(
      ([material, amount]) => [material, amount * ratio],
    ),
  );
  return {
    ...production,
    effectiveAmountPerHour,
    effectiveAmountPerDay: effectiveAmountPerHour * 24,
    effectiveMaterialPerHour,
    breachTime,
    overflowed,
  };
}

function calculatePowerGroup(
  context: PlanContext,
  catalog: EfficiencyCatalog,
  attributeStates: Map<string, AttributeState>,
  bonusByFacility: Record<string, Record<string, Record<string, number>>>,
): FacilityEfficiencyResult | undefined {
  const powerFacilities = context.facilities.filter(
    (facility) => facility.type === "power",
  );
  const first = powerFacilities[0];
  if (!first || !placementsInRoomType(context, "power").length) {
    return undefined;
  }
  const operatorEfficiency =
    placementsInRoomType(context, "power").filter((placement) =>
      isCurrentlyWorking(placement),
    ).length * 5;
  const seen = new Set<string>();
  const seenBase = new Set<string>();
  let skillEfficiency = 0;
  let facBase = 0;
  const skillDetails: OperatorEfficiencyDetail[] = [];
  const baseDetails: OperatorEfficiencyDetail[] = [];
  powerFacilities.forEach((facility) => {
    const data: EvaluationData = {
      capBoosts: attributeStates.get(facility.id)?.capBoosts ?? {},
      bonusByFacility,
    };
    const combination = aggregateEffectValues(
      context,
      facility,
      catalog,
      context.active,
      data,
      new Set(),
      new Set(["droneCharge", "abyssalBoost"]),
      "combination",
    );
    const base = aggregateEffectValues(
      context,
      facility,
      catalog,
      context.active,
      data,
      new Set(),
      new Set(["droneCharge", "abyssalBoost", "facBase"]),
      "base",
    );
    combination.details.forEach(({ item, value }) => {
      const key = `${item.owner.name}|${item.skill}|${item.effect.stat}|${JSON.stringify(item.effect.per ?? item.effect.value ?? null)}`;
      if (!seen.has(key)) {
        seen.add(key);
        skillEfficiency += value;
        skillDetails.push(
          ...detailRows(
            { details: [{ item, value }] },
            facility.type,
            "combination",
            context,
          ),
        );
      }
    });
    base.details.forEach(({ item, value }) => {
      const key = `${item.owner.name}|${item.skill}|${item.effect.stat}|${JSON.stringify(item.effect.per ?? item.effect.value ?? null)}`;
      if (!seenBase.has(key)) {
        seenBase.add(key);
        facBase += value;
        baseDetails.push(
          ...detailRows(
            { details: [{ item, value }] },
            facility.type,
            "base",
            context,
          ),
        );
      }
    });
  });
  const baseEfficiency = 100 + facBase;
  const combinationEfficiency = skillEfficiency;
  const facilitySkillEfficiency = skillDetails.reduce(
    (total, detail) =>
      total + (isFacilitySkillDetail(detail) ? detail.value : 0),
    0,
  );
  const operatorSkillEfficiency = skillEfficiency - facilitySkillEfficiency;
  const efficiency =
    baseEfficiency + operatorEfficiency + combinationEfficiency;
  const production: ProductionValue = {
    product: "Drone",
    baseAmountPerHour: POWER_OUTPUT_PER_HOUR,
    baseAmountPerDay: POWER_OUTPUT_PER_HOUR * 24,
    amountPerHour: (POWER_OUTPUT_PER_HOUR * efficiency) / 100,
    amountPerDay: ((POWER_OUTPUT_PER_HOUR * efficiency) / 100) * 24,
    itemRate: (POWER_OUTPUT_PER_HOUR * efficiency) / 100,
  };
  const capacity: FacilityCapacity = {
    label: "无人机上限",
    unit: "架",
    base: DRONE_LIMIT,
    skill: 0,
    total: DRONE_LIMIT,
  };
  return {
    facility: first,
    baseEfficiency,
    moodEfficiency: operatorEfficiency,
    operatorEfficiency,
    skillEfficiency,
    operatorSkillEfficiency,
    facilitySkillEfficiency,
    combinationEfficiency: operatorEfficiency + combinationEfficiency,
    efficiency,
    attributes: {},
    production: decorateProduction(context, first, {}, production),
    capacity,
    details: [...skillDetails, ...baseDetails],
    baseDetails,
    combinationDetails: skillDetails,
    operatorContributions: operatorContributions(
      placementsInRoomType(context, "power"),
      skillDetails,
    ),
  };
}

function calculatePlan(
  context: PlanContext,
  catalog: EfficiencyCatalog,
): EfficiencyPlanResult {
  const attributes = calculateAttributes(context, catalog);
  const bonusByFacility = collectBonusByFacility(context, catalog, attributes);
  const facilities: FacilityEfficiencyResult[] = [];
  const powerResult = calculatePowerGroup(
    context,
    catalog,
    attributes,
    bonusByFacility,
  );
  context.facilities.forEach((facility) => {
    if (
      facility.type === "control" ||
      facility.type === "processing" ||
      facility.type === "training" ||
      facility.type === "dormitory"
    )
      return;
    if (facility.type === "power") {
      if (facility.index === 0 && powerResult) facilities.push(powerResult);
      return;
    }
    if (!placementsInFacility(context, facility).length) return;
    const state = attributes.get(facility.id) ?? {
      attributes: {},
      rawOrderLimit: 0,
      capBoosts: {},
      linked: false,
      orderLimitNet: 0,
    };
    facilities.push(
      calculateFacility(context, facility, catalog, state, bonusByFacility),
    );
  });
  return {
    name: context.plan.name ?? `队列${context.index + 1}`,
    durationHours: context.durationHours,
    facilities,
    moods: context.placements
      .filter((placement) => isMoodContinuityPlacement(placement))
      .map((placement): MoodSnapshot => ({
        operator: placement.name,
        facility: placement.facility.type,
        facilityId: placement.facility.id,
        slotIndex: placement.index,
        start: placement.moodStart,
        end: placement.moodEnd,
        costRate: placement.costRate,
        working: isCurrentlyWorking(placement),
        rateDetails: placement.moodRateDetails,
      })),
    moodWarnings: context.moodWarnings,
    fiammetta: context.fiammetta,
    fiammettaWarnings: context.fiammettaWarnings,
    basePoints: context.basePoints,
    basePointDetails: context.basePointDetails,
    warnings: context.warnings,
  };
}

function aggregateDaily(
  plans: EfficiencyPlanResult[],
  totalHours: number,
): FacilityEfficiencyResult[] {
  const first = plans[0]?.facilities ?? [];
  return first.map((result) => {
    const amounts = plans
      .map(
        (plan) =>
          plan.facilities.find(
            (candidate) => candidate.facility.id === result.facility.id,
          )?.production,
      )
      .filter((production): production is ProductionValue => !!production);
    const cluePreferences = sortedCluePreferences(
      plans.flatMap(
        (plan) =>
          plan.facilities.find(
            (candidate) => candidate.facility.id === result.facility.id,
          )?.cluePreferences ?? [],
      ),
    );
    if (amounts.length === 0 || totalHours <= EPSILON) return result;
    const totals = plans.reduce(
      (sum, plan) => {
        const production = plan.facilities.find(
          (candidate) => candidate.facility.id === result.facility.id,
        )?.production;
        if (!production) return sum;
        sum.base += (production.baseAmountPerHour ?? 0) * plan.durationHours;
        sum.actual += production.amountPerHour * plan.durationHours;
        sum.effective +=
          (production.effectiveAmountPerHour ?? production.amountPerHour) *
          plan.durationHours;
        return sum;
      },
      { base: 0, actual: 0, effective: 0 },
    );
    const amountPerHour = totals.actual / totalHours;
    const effectiveAmountPerHour = totals.effective / totalHours;
    return {
      ...result,
      ...(cluePreferences.length > 0 ? { cluePreferences } : {}),
      production: {
        ...result.production,
        product: amounts[0]?.product ?? result.production?.product ?? "",
        ...(cluePreferences.length > 0 ? { cluePreferences } : {}),
        baseAmountPerHour: totals.base / totalHours,
        baseAmountPerDay: (totals.base / totalHours) * 24,
        amountPerHour,
        amountPerDay: amountPerHour * 24,
        ...(Math.abs(effectiveAmountPerHour - amountPerHour) > EPSILON
          ? {
              effectiveAmountPerHour,
              effectiveAmountPerDay: effectiveAmountPerHour * 24,
            }
          : {}),
      },
    };
  });
}

function aggregateDailyProductions(
  plans: EfficiencyPlanResult[],
  totalHours: number,
): ProductionValue[] {
  if (totalHours <= EPSILON) {
    return [];
  }

  const grouped = new Map<
    string,
    {
      basePerCycle: number;
      actualPerCycle: number;
      effectivePerCycle: number;
      conversion?: ProductionValue["conversion"];
      cluePreferences: CluePreference[];
      materialsPerCycle: Record<string, number>;
      effectiveMaterialsPerCycle: Record<string, number>;
    }
  >();
  plans.forEach((plan) => {
    plan.facilities.forEach((facility) => {
      const production = facility.production;
      if (!production) {
        return;
      }
      const rate =
        production.effectiveAmountPerHour ?? production.amountPerHour;
      const current = grouped.get(production.product) ?? {
        basePerCycle: 0,
        actualPerCycle: 0,
        effectivePerCycle: 0,
        conversion: production.conversion,
        cluePreferences: [],
        materialsPerCycle: {},
        effectiveMaterialsPerCycle: {},
      };
      if (!current.conversion && production.conversion) {
        current.conversion = production.conversion;
      }
      current.cluePreferences = sortedCluePreferences([
        ...current.cluePreferences,
        ...(production.cluePreferences ?? []),
      ]);
      current.basePerCycle +=
        (production.baseAmountPerHour ?? production.amountPerHour) *
        plan.durationHours;
      current.actualPerCycle += production.amountPerHour * plan.durationHours;
      current.effectivePerCycle += rate * plan.durationHours;
      Object.entries(production.materialPerHour ?? {}).forEach(
        ([material, amount]) => {
          current.materialsPerCycle[material] =
            (current.materialsPerCycle[material] ?? 0) +
            amount * plan.durationHours;
        },
      );
      Object.entries(
        production.effectiveMaterialPerHour ?? production.materialPerHour ?? {},
      ).forEach(([material, amount]) => {
        current.effectiveMaterialsPerCycle[material] =
          (current.effectiveMaterialsPerCycle[material] ?? 0) +
          amount * plan.durationHours;
      });
      grouped.set(production.product, current);
    });
  });

  return Array.from(grouped, ([product, value]) => {
    const baseAmountPerHour = value.basePerCycle / totalHours;
    const amountPerHour = value.actualPerCycle / totalHours;
    const effectiveAmountPerHour = value.effectivePerCycle / totalHours;
    const materialPerHour = Object.fromEntries(
      Object.entries(value.materialsPerCycle).map(([material, amount]) => [
        material,
        amount / totalHours,
      ]),
    );
    const effectiveMaterialPerHour = Object.fromEntries(
      Object.entries(value.effectiveMaterialsPerCycle).map(
        ([material, amount]) => [material, amount / totalHours],
      ),
    );
    return {
      product,
      ...(value.cluePreferences.length > 0
        ? { cluePreferences: value.cluePreferences }
        : {}),
      ...(value.conversion ? { conversion: value.conversion } : {}),
      baseAmountPerHour,
      baseAmountPerDay: baseAmountPerHour * 24,
      amountPerHour,
      amountPerDay: amountPerHour * 24,
      ...(Math.abs(effectiveAmountPerHour - amountPerHour) > EPSILON
        ? {
            effectiveAmountPerHour,
            effectiveAmountPerDay: effectiveAmountPerHour * 24,
          }
        : {}),
      ...(Object.keys(materialPerHour).length > 0 ? { materialPerHour } : {}),
      ...(Math.abs(effectiveAmountPerHour - amountPerHour) > EPSILON &&
      Object.keys(effectiveMaterialPerHour).length > 0
        ? { effectiveMaterialPerHour }
        : {}),
    };
  });
}

export function calculateEfficiency(
  document: ScheduleDocument,
  catalog: EfficiencyCatalog,
  options: EfficiencyCalculationOptions = {},
): EfficiencyResult {
  const contexts = createContexts(
    document,
    catalog,
    options.progressionProfile,
    options.treatSkillsAsUnlocked,
    options.dormitoryDefaultIncludesMoodRecovery,
  );
  const fiammetta = resolveMoods(contexts, catalog);
  const plans = contexts.map((context) => calculatePlan(context, catalog));
  const totalHours = plans.reduce(
    (total, plan) => total + plan.durationHours,
    0,
  );
  return {
    document,
    plans,
    dailyHours: totalHours,
    dailyFacilities: aggregateDaily(plans, totalHours),
    dailyProductions: aggregateDailyProductions(plans, totalHours),
    ...(fiammetta ? { fiammetta } : {}),
    fiammettaWarnings: plans.flatMap((plan) => plan.fiammettaWarnings),
    warnings: plans.flatMap((plan) => plan.warnings),
  };
}
