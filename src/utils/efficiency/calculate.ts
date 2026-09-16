import type {
  EfficiencyCatalog,
  EfficiencyCondition,
  EfficiencyEffect,
  EfficiencyCalculationOptions,
  EfficiencyFacility,
  BasePointSource,
  OperatorEfficiencyCalculation,
  FacilityCapacity,
  EfficiencyPer,
  EfficiencyPlanResult,
  EfficiencyResult,
  FiammettaCalculation,
  FiammettaPlanResult,
  FacilityCapacitySegment,
  FacilityAttributes,
  FacilityEfficiencyResult,
  CluePreference,
  CurveCalculationStep,
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
  RoomAssignment,
  RoomKey,
  ScheduleSettings,
  ScheduleDocument,
} from "@/types/schedule";
import {
  buildFacilities,
  CLUE_BASE_TIME_HOURS,
  CREDIT_PER_CLUE,
  eliteEfficiency,
  facilityBaseEfficiency,
  MANUFACTURE_STORAGE,
  manufactureRule,
  meetingAtmosphereBonus,
  rarityEfficiency,
  ORUNDUM_TRADE_ORDER,
  TRADE_ORDER_LIMIT,
  TRADE_ORDERS,
  TAILOR_PROBABILITIES,
  WORK_ROOM_KEYS,
} from "@/utils/efficiency/baseRules";
import { catalogOperator } from "@/utils/efficiency/catalog";
import {
  canonicalResourceKey,
  resolveRoomAssignment,
  roomSlotCount,
} from "@/utils/schedule";
import {
  compareBasePointDetails,
  compareBasePointSources,
} from "@/utils/efficiency/basePoints";
import {
  groupIncludesOperator,
  isSpecialOperator,
  percentageOperatorValue,
} from "@/utils/specialOperators";
import {
  ATTRIBUTE_STATS,
  CLUE_LIMIT,
  CLUE_OUTPUT_PER_HOUR,
  CLUE_PREFERENCE_BY_FACTION,
  DEFAULT_DURATION_MINUTES,
  DIRECT_FACILITY_EFFICIENCY_STATS,
  DRONE_LIMIT,
  EFFICIENCY_STATS,
  EPSILON,
  EMPTY_ZEROED_SKILL_STATE,
  FIAMMETTA_NAME,
  FLOW_GOLD_TERM,
  HIRE_LIMIT,
  HIRE_OUTPUT_PER_HOUR,
  POINT_STATS,
  POWER_OUTPUT_PER_HOUR,
  PERCENTAGE_EFFICIENCY_STATS,
  firstItemProgress,
  hasFlowGoldDisplayOperator,
  roomAssignments,
  stateOf,
  clampMood,
} from "@/utils/efficiency/model";
import type {
  ActiveEffect,
  AttributeState,
  BasePointState,
  CapacityCalculation,
  CapacityEvaluationSegment,
  CurveEvaluation,
  EffectDetail,
  EvaluationData,
  PerValue,
  Placement,
  PlanContext,
  ZeroedSkillState,
} from "@/utils/efficiency/model";
import {
  aggregateDaily,
  aggregateDailyOutputs,
  aggregateDailyProductions,
} from "@/utils/efficiency/aggregate";

function isFacilityBaseEffect(item: ActiveEffect): boolean {
  return item.effect.stat === "facBase" || isFacilitySkillEffect(item);
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
  name: string,
  skillFile: OperatorSkillFile | undefined,
  facility: RoomKey,
  state: OperatorState,
): Array<{ skill: string; effect: EfficiencyEffect }> {
  const selected = skillFile
    ? skillFile.chains
        .filter((chain) => chain.room === facility)
        .flatMap((chain) => {
          const stage = chain.stages
            .filter((candidate) => unlocksStage(candidate, state))
            .at(-1);
          return stage
            ? stage.effects.map((effect) => ({ skill: stage.name, effect }))
            : [];
        })
    : [];
  const percentage = percentageOperatorValue(name);
  const stat = PERCENTAGE_EFFICIENCY_STATS[facility];
  return percentage !== undefined && stat !== undefined
    ? [
        ...selected,
        {
          skill: `${name}效率`,
          effect: { target: facility, stat, value: percentage },
        },
      ]
    : selected;
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
        if (!profile && !isSpecialOperator(name, catalog)) {
          warnings.push(`队列 ${index + 1}：找不到干员“${name}”的技能数据`);
        }
        const state = stateOf(assignment, name);
        const special = isSpecialOperator(name, catalog);
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
            name,
            profile?.skillFile,
            facility.type,
            effectiveState,
          ),
          explicitMood:
            !special && Object.prototype.hasOwnProperty.call(state, "mood"),
          moodStart: special ? 24 : clampMood(state.mood ?? 24),
          moodEnd: special ? 24 : clampMood(state.mood ?? 24),
          costRate: 0,
          moodRateDetails: [],
          working: true,
          workHoursBefore: 0,
          owned: profile ? progression.owned : true,
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

function isMoodContinuityPlacement(
  placement: Placement,
  catalog: EfficiencyCatalog,
): boolean {
  return (
    placement.facility.type !== "dormitory" &&
    !isSpecialOperator(placement.name, catalog)
  );
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

function placementsInConditionFacility(
  context: PlanContext,
  conditionFacility: string | undefined,
  owner: Placement,
): Placement[] {
  if (conditionFacility === "same") {
    return placementsInFacility(context, owner.facility);
  }
  return conditionFacility
    ? placementsInRoomType(context, conditionFacility as RoomKey)
    : [];
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
  switch (condition.type) {
    case "opAtFacility": {
      const placements = placementsInConditionFacility(
        context,
        condition.facility,
        owner,
      );
      result = placements.some(
        (placement) =>
          placement.name === String(condition.op ?? "") &&
          workingPlacement(placement, condition.moodCheck),
      );
      break;
    }
    case "opInBase": {
      result = context.placements.some(
        (placement) =>
          placement.name === String(condition.op ?? "") &&
          (!condition.facilities?.length ||
            condition.facilities.includes(placement.facility.type)) &&
          workingPlacement(placement, condition.moodCheck),
      );
      break;
    }
    case "opInFacilityAndTarget": {
      result = context.placements.some(
        (placement) =>
          placement.name === String(condition.op ?? "") &&
          placement.facility.type === condition.facility &&
          placement.facility.id === target?.id &&
          workingPlacement(placement, condition.moodCheck),
      );
      break;
    }
    case "opGroupInFacility":
    case "opGroupNotInFacility": {
      const placements = placementsInConditionFacility(
        context,
        condition.facility,
        owner,
      )
        .filter((placement) => workingPlacement(placement, condition.moodCheck))
        .filter(
          (placement) => !condition.other || placement.name !== owner.name,
        );
      const found = placements.some((placement) =>
        groupIncludesOperator(catalog, condition.group, placement.name),
      );
      result = condition.type === "opGroupNotInFacility" ? !found : found;
      break;
    }
    case "opGroupCountInFacility": {
      const count = placementsInConditionFacility(
        context,
        condition.facility,
        owner,
      )
        .filter((placement) => workingPlacement(placement, condition.moodCheck))
        .filter((placement) =>
          groupIncludesOperator(catalog, condition.group, placement.name),
        )
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
        .filter((placement) =>
          groupIncludesOperator(catalog, condition.group, placement.name),
        )
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
      result = compare(
        moodDropAverage(owner, context.durationHours),
        Number(condition.value ?? 0),
        condition.op ?? "gt",
      );
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

function isMoodSensitiveSkill(placement: Placement, skill: string): boolean {
  return placement.selected.some(
    (selected) =>
      selected.skill === skill &&
      (selected.effect.per?.source === "moodDrop" ||
        selected.effect.condition?.type === "moodDrop"),
  );
}

function isMoodSensitiveEffect(item: ActiveEffect): boolean {
  return isMoodSensitiveSkill(item.owner, item.skill);
}

function moodWorkingEnd(placement: Placement, duration: number): number {
  if (placement.moodStart <= EPSILON) {
    return 0;
  }
  if (placement.costRate > EPSILON) {
    return Math.min(duration, placement.moodStart / placement.costRate);
  }
  return duration;
}

function moodAtTime(placement: Placement, time: number): number {
  return clampMood(placement.moodStart - placement.costRate * time);
}

function moodDropAtTime(placement: Placement, time: number): number {
  return 24 - moodAtTime(placement, time);
}

function moodDropAverage(placement: Placement, duration: number): number {
  if (duration <= EPSILON) {
    return 0;
  }
  const workingEnd = moodWorkingEnd(placement, duration);
  if (workingEnd <= EPSILON) {
    return 0;
  }
  return (
    ((moodDropAtTime(placement, 0) + moodDropAtTime(placement, workingEnd)) /
      2) *
    (workingEnd / duration)
  );
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
      count = context.placements
        .filter((placement) => !per.exclude?.includes(placement.facility.type))
        .filter((placement) => workingPlacement(placement, per.moodCheck))
        .filter((placement) =>
          groupIncludesOperator(catalog, per.group, placement.name),
        )
        .filter(
          (placement) => !per.other || placement.name !== owner.name,
        ).length;
      break;
    }
    case "opGroupInFacility": {
      count = countInFacility(per.facility)
        .filter((placement) => workingPlacement(placement, per.moodCheck))
        .filter((placement) =>
          groupIncludesOperator(catalog, per.group, placement.name),
        )
        .filter((placement) => !per.other || placement.name !== owner.name)
        .filter(
          (placement) => !per.fullMood || placement.moodStart >= 24 - EPSILON,
        ).length;
      break;
    }
    case "baseFacilityWithGroup": {
      count = context.facilities.filter((facility) =>
        placementsInFacility(context, facility).some(
          (placement) =>
            groupIncludesOperator(catalog, per.group, placement.name) &&
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
      count = moodDropAverage(owner, context.durationHours);
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
      const local = countInFacility("same").filter(
        (placement) =>
          groupIncludesOperator(catalog, per.group, placement.name) &&
          workingPlacement(placement, per.moodCheck),
      ).length;
      const total = context.placements
        .filter((placement) => placement.facility.type === "manufacture")
        .filter(
          (placement) =>
            groupIncludesOperator(catalog, per.group, placement.name) &&
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

function moodDropPerValue(per: EfficiencyPer, moodDrop: number): number {
  const perUnit = Math.max(EPSILON, Number(per.per) || 1);
  const shouldFloor = per.floor ?? true;
  const times = shouldFloor
    ? Math.max(0, Math.floor(moodDrop / perUnit))
    : Math.max(0, moodDrop / perUnit);
  const raw = times * (Number(per.value) || 0);
  if (per.capUnit === "value") {
    return Math.min(raw, Number(per.cap ?? Infinity));
  }
  return per.cap === undefined
    ? raw
    : Math.min(times, per.cap) * (Number(per.value) || 0);
}

function moodConditionValue(
  condition: EfficiencyCondition,
  moodDrop: number,
): boolean {
  const matched = compare(
    moodDrop,
    Number(condition.value ?? 0),
    condition.op ?? "gt",
  );
  return condition.negate ? !matched : matched;
}

function moodEffectValueAtTime(
  item: ActiveEffect,
  target: EfficiencyFacility | undefined,
  context: PlanContext,
  catalog: EfficiencyCatalog,
  data: EvaluationData,
  time: number,
): number {
  const { effect, owner } = item;
  const timeData = evaluationDataAtTime(data, time);
  const workingEnd = moodWorkingEnd(owner, context.durationHours);
  if (
    time > workingEnd + EPSILON ||
    (time >= workingEnd - EPSILON && moodAtTime(owner, time) <= EPSILON)
  ) {
    return 0;
  }
  let value: number;
  if (effect.per?.source === "moodDrop") {
    value = moodDropPerValue(effect.per, moodDropAtTime(owner, time));
  } else if (effect.curve) {
    value = Math.min(
      effect.curve.startValue +
        (owner.workHoursBefore + time - effect.curve.startHours) *
          effect.curve.step,
      effect.curve.cap,
    );
  } else if (effect.per) {
    value = perCount(
      effect.per,
      owner,
      target,
      effect.target,
      context,
      catalog,
      timeData,
    ).value;
  } else {
    value = Number(effect.value ?? 0) + Number(effect.baseValue ?? 0);
  }
  if (effect.condition?.type === "moodDrop") {
    if (!moodConditionValue(effect.condition, moodDropAtTime(owner, time))) {
      return 0;
    }
  }
  if (effect.condition?.type === "workHours") {
    const threshold = Number(effect.condition.value ?? 0);
    if (owner.workHoursBefore + time < threshold) {
      return 0;
    }
  }
  return value;
}

function moodEffectBoundaries(item: ActiveEffect, duration: number): number[] {
  const { effect, owner } = item;
  const workingEnd = moodWorkingEnd(owner, duration);
  const boundaries = [0, workingEnd];
  const rate = owner.costRate;
  if (Math.abs(rate) > EPSILON) {
    const initialDrop = moodDropAtTime(owner, 0);
    const addDropBoundary = (moodDrop: number): void => {
      const time = (moodDrop - initialDrop) / rate;
      if (time > EPSILON && time < workingEnd - EPSILON) {
        boundaries.push(time);
      }
    };
    if (effect.per?.source === "moodDrop") {
      const perUnit = Math.max(EPSILON, Number(effect.per.per) || 1);
      for (let moodDrop = 0; moodDrop <= 24 + EPSILON; moodDrop += perUnit) {
        addDropBoundary(moodDrop);
      }
    }
    if (effect.condition?.type === "moodDrop") {
      addDropBoundary(Number(effect.condition.value ?? 0));
    }
  }
  if (effect.condition?.type === "workHours") {
    const time = Number(effect.condition.value ?? 0) - owner.workHoursBefore;
    if (time > EPSILON && time < workingEnd - EPSILON) {
      boundaries.push(time);
    }
  }
  return Array.from(
    new Set(boundaries.map((value) => Math.max(0, value))),
  ).sort((left, right) => left - right);
}

function moodEffectAverage(
  item: ActiveEffect,
  target: EfficiencyFacility | undefined,
  context: PlanContext,
  catalog: EfficiencyCatalog,
  data: EvaluationData,
): number {
  const duration = context.durationHours;
  if (duration <= EPSILON) {
    return 0;
  }
  const boundaries = Array.from(
    new Set([
      ...moodEffectBoundaries(item, duration),
      ...(data.capacitySegments ?? []).flatMap(({ startHours, endHours }) => [
        startHours,
        endHours,
      ]),
    ]),
  ).sort((left, right) => left - right);
  let integral = 0;
  for (let index = 1; index < boundaries.length; index += 1) {
    const start = boundaries[index - 1] ?? 0;
    const end = boundaries[index] ?? start;
    if (end <= start + EPSILON) {
      continue;
    }
    integral +=
      moodEffectValueAtTime(
        item,
        target,
        context,
        catalog,
        data,
        (start + end) / 2,
      ) *
      (end - start);
  }
  return integral / duration;
}

function evaluationDataAtTime(
  data: EvaluationData,
  time: number,
): EvaluationData {
  const segments = data.capacitySegments;
  if (!segments || segments.length === 0) {
    return data;
  }
  const segment =
    segments.find(
      (candidate) =>
        time >= candidate.startHours - EPSILON &&
        time < candidate.endHours - EPSILON,
    ) ??
    (time <= (segments.at(-1)?.endHours ?? 0) + EPSILON
      ? segments.at(-1)
      : undefined);
  return segment ? { ...data, capBoosts: segment.capBoosts } : data;
}

function capacityEffectAverage(
  item: ActiveEffect,
  target: EfficiencyFacility | undefined,
  context: PlanContext,
  catalog: EfficiencyCatalog,
  data: EvaluationData,
): number {
  const duration = context.durationHours;
  const segments = data.capacitySegments;
  if (duration <= EPSILON || !segments || segments.length === 0) {
    return 0;
  }
  return (
    segments.reduce((total, segment) => {
      const segmentHours = Math.max(0, segment.endHours - segment.startHours);
      if (segmentHours <= EPSILON) {
        return total;
      }
      const time = (segment.startHours + segment.endHours) / 2;
      const timeData = evaluationDataAtTime(data, time);
      const perValue = perCount(
        item.effect.per!,
        item.owner,
        target,
        item.effect.target,
        context,
        catalog,
        timeData,
      );
      return total + perValue.value * segmentHours;
    }, 0) / duration
  );
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
  if (isMoodSensitiveEffect(item)) {
    return moodEffectAverage(item, target, context, catalog, data);
  }
  if (
    (item.effect.per?.source === "facCap" ||
      item.effect.per?.source === "capTier") &&
    (data.capacitySegments?.length ?? 0) > 1
  ) {
    return capacityEffectAverage(item, target, context, catalog, data);
  }
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
    !groupIncludesOperator(catalog, effect.scopeGroup, subject.name)
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
            !(
              effect.condition?.type === "moodDrop" &&
              (EFFICIENCY_STATS.has(effect.stat) ||
                ATTRIBUTE_STATS.has(effect.stat))
            ) &&
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

function isSelfReferentialBasePointGain(item: ActiveEffect): boolean {
  return (
    item.effect.stat === "basePointGain" &&
    item.effect.per?.source === "basePoint" &&
    item.effect.per.term === item.effect.term
  );
}

function computeBasePointState(
  context: PlanContext,
  active: ActiveEffect[],
  catalog: EfficiencyCatalog,
  data: EvaluationData,
): BasePointState {
  const points: Record<string, number> = {};
  const sources: Record<string, BasePointSource[]> = {};
  context.basePoints = points;
  context.facilities
    .filter((facility) => facility.type === "manufacture")
    .filter((facility) => {
      const assignment = roomAssignments(
        context.document,
        context.index,
        facility,
      );
      return (
        manufactureRule(assignment.product, assignment.sourceMaterial)
          ?.recipe === "贵金属"
      );
    })
    .forEach((facility) => {
      points["cc.t.flow_gold"] = (points["cc.t.flow_gold"] ?? 0) + 1;
      appendBasePointSource(sources, "cc.t.flow_gold", {
        kind: "gain",
        operator: "生产赤金",
        facility: "manufacture",
        facilityIndex: facility.index,
        slotIndex: 0,
        value: 1,
      });
    });
  const initialPoints = { ...points };
  context.basePoints = initialPoints;
  active.filter(isSelfReferentialBasePointGain).forEach((item) => {
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
  context.basePoints = points;
  active
    .filter((item) => item.effect.stat === "basePointGain")
    .filter((item) => !isSelfReferentialBasePointGain(item))
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
      .filter(
        ([term, value]) =>
          value > EPSILON &&
          (term !== FLOW_GOLD_TERM || hasFlowGoldDisplayOperator(context)),
      )
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
  if (
    isSpecialOperator(placement.name, catalog) ||
    !isCurrentlyWorking(placement) ||
    !isWorkPlacement(placement)
  ) {
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
          groupIncludesOperator(catalog, item.effect.group, placement.name)),
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
  return { rate, details };
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
  const previousPlacement = (
    index: number,
    matches: (placement: Placement) => boolean,
  ): { placement?: Placement; context?: PlanContext } => {
    if (contexts.length <= 1) {
      return {};
    }
    const previousIndex = (index - 1 + contexts.length) % contexts.length;
    const context = contexts[previousIndex];
    return {
      placement: context?.placements.find(matches),
      context,
    };
  };
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
    return previousPlacement(
      index,
      (candidate) => candidate.name === placement.name,
    );
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
  const fiammettaAnchoredOperators = new Set(
    contexts.flatMap((context) =>
      context.placements
        .filter((placement) => placement.fiammettaForced)
        .map((placement) => placement.name),
    ),
  );
  const unanchoredCycleOperators = new Set(
    contexts.length > 1
      ? contexts[0]?.placements
          .map((placement) => placement.name)
          .filter(
            (name) =>
              !fiammettaAnchoredOperators.has(name) &&
              contexts.every((context) => {
                const placement = context.placements.find(
                  (candidate) => candidate.name === name,
                );
                return (
                  !!placement &&
                  isMoodContinuityPlacement(placement, catalog) &&
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
  const steadyMoodStarts = new Map<string, number>();
  const canInheritMood = (
    previous: Placement | undefined,
    current: Placement,
  ): previous is Placement =>
    !!previous &&
    isMoodContinuityPlacement(previous, catalog) &&
    isMoodContinuityPlacement(current, catalog);
  const canContinueWork = (
    previous: Placement | undefined,
    current: Placement,
  ): previous is Placement =>
    !!previous &&
    isCurrentlyWorking(previous) &&
    previous.moodEnd > EPSILON &&
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
      const steadyMoodStart = steadyMoodStarts.get(placement.name);
      placement.moodStart = placement.fiammettaForced
        ? 24
        : placement.explicitMood
          ? clampMood(placement.state.mood ?? 24)
          : steadyMoodStart !== undefined
            ? steadyMoodStart
            : inheritsMood
              ? previousOperator.moodEnd
              : 24;
      placement.working = true;
      placement.workHoursBefore = continuesWork
        ? previousWorkOperator.workHoursBefore +
          (previousWork.context?.durationHours ?? 0)
        : 0;
      placement.moodEnd = placement.moodStart;
    });
  });

  for (let round = 0; round < 16; round += 1) {
    let maxStartDelta = 0;
    let maxEndDelta = 0;
    contexts.forEach((context, index) => {
      context.placements.forEach((placement) => {
        const previousMood = previousMoodPlacement(index, placement);
        const previousOperator = previousMood.placement;
        const inheritsMood = canInheritMood(previousOperator, placement);
        const previousWork = previousWorkPlacement(index, placement);
        const previousWorkOperator = previousWork.placement;
        const continuesWork = canContinueWork(previousWorkOperator, placement);
        const steadyMoodStart = steadyMoodStarts.get(placement.name);
        const nextStart = placement.fiammettaForced
          ? 24
          : placement.explicitMood
            ? clampMood(placement.state.mood ?? 24)
            : steadyMoodStart !== undefined
              ? steadyMoodStart
              : inheritsMood
                ? previousOperator.moodEnd
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
        const nextEnd = isWorkPlacement(placement)
          ? clampMood(
              placement.moodStart - placement.costRate * context.durationHours,
            )
          : placement.moodStart;
        maxEndDelta = Math.max(
          maxEndDelta,
          Math.abs(nextEnd - placement.moodEnd),
        );
        placement.moodEnd = nextEnd;
      });
    });
    if (round === 7 && unanchoredCycleOperators.size > 0) {
      unanchoredCycleOperators.forEach((name) => {
        const netChange = contexts.reduce((total, context) => {
          const placement = context.placements.find(
            (candidate) => candidate.name === name,
          );
          return total + (placement?.costRate ?? 0) * context.durationHours;
        }, 0);
        steadyMoodStarts.set(name, netChange < -EPSILON ? 24 : 0);
      });
      maxStartDelta = Infinity;
    }
    if (
      maxStartDelta <= EPSILON &&
      maxEndDelta <= EPSILON &&
      (unanchoredCycleOperators.size === 0 ||
        steadyMoodStarts.size === unanchoredCycleOperators.size)
    ) {
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
        !isMoodContinuityPlacement(previous, catalog) ||
        !isMoodContinuityPlacement(placement, catalog) ||
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

function attributeEffectValue(
  item: ActiveEffect,
  target: EfficiencyFacility,
  context: PlanContext,
  catalog: EfficiencyCatalog,
  data: EvaluationData,
): number {
  if (!isMoodSensitiveEffect(item)) {
    return effectValue(item, target, context, catalog, data);
  }
  return moodEffectValueAtTime(
    item,
    target,
    context,
    catalog,
    data,
    context.durationHours,
  );
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
  const suppressedSkills = suppressedSkillsFor(context, facility);
  active
    .filter(
      (item) =>
        item.target?.id === facility.id &&
        ATTRIBUTE_STATS.has(item.effect.stat),
    )
    .filter((item) => !suppressedSkills.has(item.skill))
    .filter(
      (item) =>
        item.effect.per?.source !== "stat" &&
        item.effect.per?.source !== "facCap" &&
        item.effect.per?.source !== "capTier",
    )
    .filter((item) => recipeMatches(item.effect, assignment))
    .forEach((item) => {
      const value = attributeEffectValue(
        item,
        facility,
        context,
        catalog,
        data,
      );
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
    .filter((item) => !suppressedSkills.has(item.skill))
    .filter((item) =>
      ["facCap", "capTier"].includes(item.effect.per?.source ?? ""),
    )
    .filter((item) => recipeMatches(item.effect, assignment))
    .forEach((item) => {
      const value = attributeEffectValue(
        item,
        facility,
        context,
        catalog,
        capData,
      );
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
        !suppressedSkills.has(item.skill) &&
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
): ZeroedSkillState {
  const zeroingEffects = context.active.filter(
    (item) =>
      item.target?.id === facility.id && item.effect.stat === "zeroOpBonus",
  );
  const zeroingOperators = new Set(
    zeroingEffects.map((item) => item.owner.name),
  );
  if (zeroingOperators.size === 0) {
    return EMPTY_ZEROED_SKILL_STATE;
  }
  return {
    operators: new Set(
      context.active
        .filter(
          (item) =>
            item.target?.id === facility.id &&
            !zeroingOperators.has(item.owner.name),
        )
        .map((item) => item.owner.name),
    ),
    exceptSources: new Set(
      zeroingEffects.flatMap((item) => item.effect.except ?? []),
    ),
  };
}

function suppressedSkillsFor(
  context: PlanContext,
  facility: EfficiencyFacility,
): Set<string> {
  return new Set(
    context.active
      .filter((item) => item.target?.id === facility.id)
      .flatMap((item) => item.effect.suppresses ?? []),
  );
}

function isFacilitySkillEffect(item: ActiveEffect): boolean {
  return (
    item.effect.stack === "max" &&
    DIRECT_FACILITY_EFFICIENCY_STATS.has(item.effect.stat)
  );
}

function isZeroExemptEffect(
  item: ActiveEffect,
  exceptSources: Set<string>,
): boolean {
  const source = item.effect.per?.source;
  return (
    isFacilityBaseEffect(item) ||
    (typeof source === "string" && exceptSources.has(source))
  );
}

function shouldIncludeZeroedEffect(
  item: ActiveEffect,
  zeroed: ZeroedSkillState,
): boolean {
  return (
    !zeroed.operators.has(item.owner.name) ||
    isZeroExemptEffect(item, zeroed.exceptSources)
  );
}

function aggregateEffectValues(
  context: PlanContext,
  facility: EfficiencyFacility,
  catalog: EfficiencyCatalog,
  active: ActiveEffect[],
  data: EvaluationData,
  zeroed: ZeroedSkillState,
  stats: Set<string>,
  category: "all" | "base" | "combination" = "all",
  source: "regular" | "stat" = "regular",
): { total: number; details: Array<{ item: ActiveEffect; value: number }> } {
  const suppressedSkills = suppressedSkillsFor(context, facility);
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
    .filter((item) => !suppressedSkills.has(item.skill))
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
    .filter((item) => !suppressedSkills.has(item.skill))
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
  capacityCalculations: Map<string, CapacityCalculation>,
): Record<string, Record<string, Record<string, number>>> {
  const result: Record<string, Record<string, Record<string, number>>> = {};
  context.facilities.forEach((facility) => {
    const capacityCalculation = capacityCalculations.get(facility.id);
    const data = {
      capBoosts: attributeStates.get(facility.id)?.capBoosts ?? {},
      bonusByFacility: result,
      ...(capacityCalculation
        ? { capacitySegments: capacityCalculation.segments }
        : {}),
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
  zeroed: ZeroedSkillState,
  ordinarySkill: number,
  baseEfficiencyWithoutSpecial: number,
): {
  value: number;
  orderLimitNet: number;
  details: EffectDetail[];
} {
  if (facility.type !== "trading") {
    return { value: 0, orderLimitNet: state.rawOrderLimit, details: [] };
  }
  const suppressedSkills = suppressedSkillsFor(context, facility);
  const jieEffects = active.filter(
    (item) =>
      item.target?.id === facility.id &&
      !suppressedSkills.has(item.skill) &&
      item.effect.stat === "orderLimit" &&
      item.effect.per?.source === "stat",
  );
  const netEffects = active
    .filter(
      (item) =>
        item.target?.id === facility.id && item.effect.stat === "tradeNetEff",
    )
    .filter((item) => !suppressedSkills.has(item.skill))
    .filter((item) => shouldIncludeZeroedEffect(item, zeroed));
  const orderEffects = active
    .filter(
      (item) =>
        item.target?.id === facility.id &&
        !suppressedSkills.has(item.skill) &&
        item.effect.stat === "tradeSpd" &&
        item.effect.per?.source === "orderCount",
    )
    .filter((item) => shouldIncludeZeroedEffect(item, zeroed));
  const gapEffects = active
    .filter(
      (item) =>
        item.target?.id === facility.id &&
        !suppressedSkills.has(item.skill) &&
        item.effect.stat === "tradeGapEff",
    )
    .filter((item) => shouldIncludeZeroedEffect(item, zeroed));
  const baseOrder = TRADE_ORDER_LIMIT[facility.level] ?? 0;
  if (
    jieEffects.length === 0 &&
    netEffects.length === 0 &&
    orderEffects.length === 0 &&
    gapEffects.length === 0
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
      ? Math.max(0, state.rawOrderLimit - cut)
      : state.rawOrderLimit;
  const details: EffectDetail[] = [];
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
  if (gapEffects.length > 0) {
    const gapBase =
      orderEffects.length > 0
        ? orderLimitNet
        : Math.max(1, baseOrder + state.rawOrderLimit);
    const gapValues = gapEffects.map(
      (item) => gapBase * Number(item.effect.value ?? 0),
    );
    const maxGapValue = gapValues.reduce((total, item) => total + item, 0);
    const initialEfficiency =
      baseEfficiencyWithoutSpecial + value + maxGapValue;
    const preferMax = context.settings.preferMaxJieEfficiency !== false;
    const orderProduction = preferMax
      ? undefined
      : tradeProduction(context, facility, 100, active);
    const orders = orderProduction?.orders ?? [];
    const expectedOrderHours = orders.reduce(
      (total, order) => total + order.probability * order.time,
      0,
    );
    const fixedOrder = orders.length === 1 && orders[0]?.ignoreEfficiency;
    const fallbackReason = fixedOrder
      ? "fixedOrder"
      : orders.length === 0 || expectedOrderHours <= EPSILON
        ? "missingOrders"
        : undefined;
    const shouldIntegrate =
      !preferMax && !fallbackReason && context.durationHours > EPSILON;
    let averageEfficiency = initialEfficiency;
    let completedOrders = 0;
    const progress = firstItemProgress(context.settings, facility.id);
    const decrement = gapEffects.reduce(
      (total, item) => total + Number(item.effect.value ?? 0),
      0,
    );
    if (shouldIntegrate) {
      let elapsed = 0;
      let currentEfficiency = initialEfficiency;
      let integratedEfficiency = 0;
      while (
        elapsed < context.durationHours - EPSILON &&
        currentEfficiency > EPSILON
      ) {
        const remainingProgress = completedOrders === 0 ? 1 - progress : 1;
        const orderHours =
          (expectedOrderHours / (currentEfficiency / 100)) * remainingProgress;
        if (orderHours <= EPSILON) {
          completedOrders += 1;
          currentEfficiency -= decrement;
          continue;
        }
        if (elapsed + orderHours > context.durationHours + EPSILON) {
          break;
        }
        integratedEfficiency += currentEfficiency * orderHours;
        elapsed += orderHours;
        completedOrders += 1;
        currentEfficiency -= decrement;
      }
      averageEfficiency =
        (integratedEfficiency +
          Math.max(0, currentEfficiency) *
            Math.max(0, context.durationHours - elapsed)) /
        context.durationHours;
    }
    const averageGapValue = shouldIntegrate
      ? averageEfficiency - baseEfficiencyWithoutSpecial - value
      : maxGapValue;
    const calculation: OperatorEfficiencyCalculation = {
      type: "tradeGap",
      mode: shouldIntegrate ? "integral" : "max",
      durationHours: context.durationHours,
      gapBase,
      gapValue: maxGapValue,
      initialEfficiency,
      averageEfficiency: shouldIntegrate
        ? averageEfficiency
        : initialEfficiency,
      ...(shouldIntegrate || fallbackReason ? { expectedOrderHours } : {}),
      firstItemProgress: progress,
      completedOrders,
      decrement,
      ...(fallbackReason ? { fallbackReason } : {}),
    };
    gapEffects.forEach((item, index) => {
      const maxValue = gapValues[index] ?? 0;
      const ratio =
        Math.abs(maxGapValue) > EPSILON ? maxValue / maxGapValue : 0;
      details.push({
        item,
        value: shouldIntegrate ? averageGapValue * ratio : maxValue,
        calculation,
      });
    });
    value += shouldIntegrate ? averageGapValue : maxGapValue;
  }
  return { value, orderLimitNet, details };
}

function detailRows(
  aggregate: { details: EffectDetail[] },
  facility: RoomKey,
  category: "base" | "combination",
  context: PlanContext,
): OperatorEfficiencyDetail[] {
  return aggregate.details
    .map(({ item, value, calculation }) => ({
      item,
      value,
      calculation: calculation ?? effectCalculation(item, context),
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

function operatorContributions(
  placements: Placement[],
  combinationDetails: OperatorEfficiencyDetail[],
): OperatorEfficiencyContribution[] {
  const skillValues = new Map<string, number>();
  const sourceFacilities = new Map<string, RoomKey>();
  combinationDetails.forEach((detail) => {
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
  capacityCalculation: CapacityCalculation | undefined,
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
    ...(capacityCalculation
      ? { capacitySegments: capacityCalculation.segments }
      : {}),
  };
  const zeroed = zeroedSkillOperators(context, facility);
  const baseAggregate = aggregateEffectValues(
    context,
    facility,
    catalog,
    context.active,
    data,
    EMPTY_ZEROED_SKILL_STATE,
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
  const special = tradeSpecialEfficiency(
    context,
    facility,
    catalog,
    attributeState,
    context.active,
    data,
    zeroed,
    combinationAggregate.total,
    baseEfficiency +
      moodEfficiency +
      combinationAggregate.total +
      statAggregate.total +
      trainingEfficiency,
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
  const operatorSkillEfficiency = skillEfficiency;
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
  const production = productionFor(
    context,
    facility,
    result.efficiency,
    catalog,
    context.active,
  );
  result.capacity = capacityCalculationFor(
    context,
    facility,
    attributeState,
    catalog,
    context.active,
  )?.capacity;
  result.production = decorateProduction(
    context,
    facility,
    production,
    result.capacity,
  );
  if (result.production && cluePreferences.length > 0) {
    result.production.cluePreferences = cluePreferences;
  }
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
  const product = canonicalResourceKey(assignment.product ?? "龙门币");
  if (product === "合成玉") {
    const multiplier = efficiency / 100;
    const baseAmountPerHour =
      ORUNDUM_TRADE_ORDER.productAmount / ORUNDUM_TRADE_ORDER.hours;
    return {
      product,
      baseAmountPerHour,
      baseAmountPerDay: baseAmountPerHour * 24,
      amountPerHour: baseAmountPerHour * multiplier,
      amountPerDay: baseAmountPerHour * multiplier * 24,
      itemRate: multiplier / ORUNDUM_TRADE_ORDER.hours,
      orderRule: "开采协力",
      orders: [
        {
          name: "源石订单",
          probability: 1,
          quantity: ORUNDUM_TRADE_ORDER.productAmount,
          time: ORUNDUM_TRADE_ORDER.hours,
          material: "源石碎片",
          amount: ORUNDUM_TRADE_ORDER.materialAmount,
        },
      ],
      materialPerHour: {
        源石碎片:
          (-ORUNDUM_TRADE_ORDER.materialAmount / ORUNDUM_TRADE_ORDER.hours) *
          multiplier,
      },
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
    const fixedMaterial = fixed.order.material
      ? canonicalResourceKey(fixed.order.material)
      : null;
    const material: Record<string, number> = {};
    if (fixedMaterial && fixed.order.amount) {
      material[fixedMaterial] = -(
        (Number(fixed.order.amount) / Number(fixed.order.time ?? 1)) *
        (fixed.order.ignoreEff ? 1 : multiplier)
      );
    }
    return {
      product: "龙门币",
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
          material: fixedMaterial,
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
  const breachAmount = breach.reduce(
    (total, order) => total + Number(order.order?.amount ?? 0),
    0,
  );
  const breachGold = breach.reduce(
    (total, order) => total + Number(order.order?.qty ?? 0),
    0,
  );
  const investAmount = invest.reduce(
    (total, order) => total + Number(order.order?.qty ?? 0),
    0,
  );
  let expectedGold = 0;
  let expectedTime = 0;
  let expectedMaterial = 0;
  const orderSummaries: TradeOrderSummary[] = [];
  sourceOrders.forEach((order) => {
    const isBreachOrder = breach.length > 0 && [2, 3].includes(order.amount);
    const gold =
      fixValues?.qty !== undefined
        ? Number(fixValues.qty)
        : Number(order.gold) +
          (isBreachOrder ? breachGold : 0) +
          (order.amount === 4 ? investAmount : 0);
    const material =
      fixValues?.amount !== undefined
        ? Number(fixValues.amount)
        : order.amount + (isBreachOrder ? breachAmount : 0);
    const notes: string[] = [];
    if (fixValues?.qty !== undefined) notes.push("金额替换");
    if (isBreachOrder && (breachAmount !== 0 || breachGold !== 0)) {
      notes.push("违约索赔");
    }
    if (order.amount === 4 && investAmount > 0) notes.push("投资");
    expectedGold += order.probability * gold;
    expectedTime += order.probability * order.hours;
    expectedMaterial += order.probability * material;
    orderSummaries.push({
      name: order.name,
      probability: order.probability,
      quantity: gold,
      time: order.hours,
      material: "赤金",
      amount: material,
      ...(notes.length ? { note: notes.join("、") } : {}),
    });
  });
  if (expectedTime <= EPSILON) return undefined;
  const baseAmountPerHour = expectedGold / expectedTime;
  const amountPerHour = baseAmountPerHour * multiplier;
  return {
    product: "龙门币",
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
      赤金: -((expectedMaterial / expectedTime) * multiplier),
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
          -(amount / rule.hours) * multiplier,
        ]),
      ),
    };
  }
  if (facility.type === "meeting") {
    const baseAmountPerHour = CLUE_OUTPUT_PER_HOUR;
    const amountPerHour = (baseAmountPerHour * efficiency) / 100;
    return {
      product: "线索",
      conversion: {
        label: "信用",
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
      product: "公开招募标签刷新次数",
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

function capacityBoostsEqual(
  left: Record<string, Record<string, number>>,
  right: Record<string, Record<string, number>>,
): boolean {
  const stats = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...stats].every((stat) => {
    const leftValues = left[stat] ?? {};
    const rightValues = right[stat] ?? {};
    const operators = new Set([
      ...Object.keys(leftValues),
      ...Object.keys(rightValues),
    ]);
    return [...operators].every(
      (operator) =>
        Math.abs((leftValues[operator] ?? 0) - (rightValues[operator] ?? 0)) <=
        EPSILON,
    );
  });
}

function copyCapacityBoosts(
  boosts: Record<string, Record<string, number>>,
): Record<string, Record<string, number>> {
  return Object.fromEntries(
    Object.entries(boosts).map(([stat, values]) => [stat, { ...values }]),
  );
}

function publicCapacitySegments(
  segments: CapacityEvaluationSegment[],
): FacilityCapacitySegment[] {
  return segments.map((segment) => ({
    startHours: segment.startHours,
    endHours: segment.endHours,
    base: segment.base,
    skill: segment.skill,
    total: segment.total,
  }));
}

function capacityEvaluationAtTime(
  context: PlanContext,
  facility: EfficiencyFacility,
  attributeState: AttributeState,
  active: ActiveEffect[],
  catalog: EfficiencyCatalog,
  time: number,
): { skill: number; capBoosts: Record<string, Record<string, number>> } {
  const assignment = roomAssignments(context.document, context.index, facility);
  const data: EvaluationData = {
    capBoosts: attributeState.capBoosts,
    bonusByFacility: {},
  };
  const suppressedSkills = suppressedSkillsFor(context, facility);
  const capBoosts: Record<string, Record<string, number>> = {};
  const skill = active
    .filter(
      (item) =>
        item.target?.id === facility.id &&
        ATTRIBUTE_STATS.has(item.effect.stat),
    )
    .filter((item) => !suppressedSkills.has(item.skill))
    .filter((item) => item.effect.per?.source !== "stat")
    .filter((item) => recipeMatches(item.effect, assignment))
    .reduce((total, item) => {
      const value = isMoodSensitiveEffect(item)
        ? moodEffectValueAtTime(item, facility, context, catalog, data, time)
        : effectValue(item, facility, context, catalog, data);
      const statBoosts =
        capBoosts[item.effect.stat] ?? (capBoosts[item.effect.stat] = {});
      statBoosts[item.owner.name] = (statBoosts[item.owner.name] ?? 0) + value;
      return total + value;
    }, 0);
  return { skill, capBoosts };
}

function capacitySegmentsFor(
  context: PlanContext,
  facility: EfficiencyFacility,
  attributeState: AttributeState,
  active: ActiveEffect[],
  catalog: EfficiencyCatalog,
  base: number,
  skill: number,
  minimum = 0,
): CapacityEvaluationSegment[] {
  const duration = context.durationHours;
  const dynamic = active.filter(
    (item) =>
      item.target?.id === facility.id &&
      ATTRIBUTE_STATS.has(item.effect.stat) &&
      isMoodSensitiveEffect(item) &&
      item.effect.per?.source !== "stat" &&
      !suppressedSkillsFor(context, facility).has(item.skill) &&
      recipeMatches(
        item.effect,
        roomAssignments(context.document, context.index, facility),
      ),
  );
  if (dynamic.length === 0) {
    return [
      {
        startHours: 0,
        endHours: duration,
        base,
        skill,
        total: Math.max(minimum, base + skill),
        capBoosts: copyCapacityBoosts(attributeState.capBoosts),
      },
    ];
  }
  const boundaries = [0, duration];
  dynamic.forEach((item) => {
    boundaries.push(...moodEffectBoundaries(item, duration));
  });
  const points = Array.from(
    new Set(
      boundaries
        .map((value) => Math.max(0, Math.min(duration, value)))
        .sort((left, right) => left - right),
    ),
  );
  const segments: CapacityEvaluationSegment[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const startHours = points[index - 1] ?? 0;
    const endHours = points[index] ?? startHours;
    if (endHours <= startHours + EPSILON) {
      continue;
    }
    const evaluation = capacityEvaluationAtTime(
      context,
      facility,
      attributeState,
      active,
      catalog,
      (startHours + endHours) / 2,
    );
    const total = Math.max(minimum, base + evaluation.skill);
    const previous = segments[segments.length - 1];
    if (
      previous &&
      Math.abs(previous.total - total) <= EPSILON &&
      capacityBoostsEqual(previous.capBoosts, evaluation.capBoosts)
    ) {
      previous.endHours = endHours;
      continue;
    }
    segments.push({
      startHours,
      endHours,
      base,
      skill: evaluation.skill,
      total,
      capBoosts: evaluation.capBoosts,
    });
  }
  return segments.length > 0
    ? segments
    : [
        {
          startHours: 0,
          endHours: duration,
          base,
          skill,
          total: Math.max(minimum, base + skill),
          capBoosts: copyCapacityBoosts(attributeState.capBoosts),
        },
      ];
}

function capacityCalculationFor(
  context: PlanContext,
  facility: EfficiencyFacility,
  attributeState: AttributeState,
  catalog: EfficiencyCatalog,
  active: ActiveEffect[],
): CapacityCalculation | undefined {
  const attributes = attributeState.attributes;
  if (facility.type === "trading") {
    const value = attributes.orderLimit;
    if (!value) return undefined;
    const segments = capacitySegmentsFor(
      context,
      facility,
      attributeState,
      active,
      catalog,
      value.base,
      value.skill,
      1,
    );
    return {
      capacity: {
        label: "订单上限",
        unit: "单",
        base: value.base,
        skill: value.skill,
        total: value.total,
        segments: publicCapacitySegments(segments),
      },
      segments,
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
    const segments = capacitySegmentsFor(
      context,
      facility,
      attributeState,
      active,
      catalog,
      value.base,
      value.skill,
    );
    const hasDynamicCapacity = active.some(
      (item) =>
        item.target?.id === facility.id &&
        ATTRIBUTE_STATS.has(item.effect.stat) &&
        isMoodSensitiveEffect(item) &&
        item.effect.per?.source !== "stat" &&
        !suppressedSkillsFor(context, facility).has(item.skill) &&
        recipeMatches(item.effect, assignment),
    );
    const endSkill = hasDynamicCapacity
      ? capacityEvaluationAtTime(
          context,
          facility,
          attributeState,
          active,
          catalog,
          context.durationHours,
        ).skill
      : value.skill;
    return {
      capacity: {
        label: "仓库容量",
        unit: "格",
        base: value.base,
        skill: endSkill,
        total: value.base + endSkill,
        segments: publicCapacitySegments(segments),
        itemVolume: rule?.volume,
      },
      segments,
    };
  }
  if (facility.type === "power") {
    const segments: CapacityEvaluationSegment[] = [
      {
        startHours: 0,
        endHours: context.durationHours,
        base: DRONE_LIMIT,
        skill: 0,
        total: DRONE_LIMIT,
        capBoosts: {},
      },
    ];
    return {
      capacity: {
        label: "无人机上限",
        unit: "架",
        base: DRONE_LIMIT,
        skill: 0,
        total: DRONE_LIMIT,
        segments: publicCapacitySegments(segments),
      },
      segments,
    };
  }
  if (facility.type === "meeting") {
    const segments: CapacityEvaluationSegment[] = [
      {
        startHours: 0,
        endHours: context.durationHours,
        base: CLUE_LIMIT,
        skill: 0,
        total: CLUE_LIMIT,
        capBoosts: {},
      },
    ];
    return {
      capacity: {
        label: "线索上限",
        unit: "条",
        base: CLUE_LIMIT,
        skill: 0,
        total: CLUE_LIMIT,
        segments: publicCapacitySegments(segments),
      },
      segments,
    };
  }
  if (facility.type === "hire") {
    const segments: CapacityEvaluationSegment[] = [
      {
        startHours: 0,
        endHours: context.durationHours,
        base: HIRE_LIMIT,
        skill: 0,
        total: HIRE_LIMIT,
        capBoosts: {},
      },
    ];
    return {
      capacity: {
        label: "刷新次数上限",
        unit: "次",
        base: HIRE_LIMIT,
        skill: 0,
        total: HIRE_LIMIT,
        segments: publicCapacitySegments(segments),
      },
      segments,
    };
  }
  return undefined;
}

function decorateProduction(
  context: PlanContext,
  facility: EfficiencyFacility,
  production: ProductionValue | undefined,
  capacity: FacilityCapacity | undefined,
): ProductionValue | undefined {
  if (!production) return undefined;
  if (!capacity || !production.itemRate || production.itemRate <= EPSILON) {
    return production;
  }
  const itemRate = production.itemRate;
  const progress = firstItemProgress(context.settings, facility.id);
  let inventory = progress;
  let breachTime = Number.POSITIVE_INFINITY;
  capacity.segments.forEach((segment) => {
    if (Number.isFinite(breachTime)) {
      return;
    }
    const itemCapacity =
      facility.type === "manufacture" && capacity.itemVolume
        ? Math.floor(segment.total / capacity.itemVolume)
        : segment.total;
    const startHours = segment.startHours;
    const segmentHours = Math.max(0, segment.endHours - startHours);
    if (inventory >= itemCapacity - EPSILON) {
      breachTime = startHours;
      return;
    }
    const timeToBreach = (itemCapacity - inventory) / itemRate;
    if (timeToBreach <= segmentHours + EPSILON) {
      breachTime = startHours + Math.max(0, timeToBreach);
      return;
    }
    inventory += itemRate * segmentHours;
  });
  if (!Number.isFinite(breachTime)) {
    const itemCapacity =
      facility.type === "manufacture" && capacity.itemVolume
        ? Math.floor(capacity.total / capacity.itemVolume)
        : capacity.total;
    breachTime =
      inventory >= itemCapacity - EPSILON
        ? context.durationHours
        : context.durationHours + (itemCapacity - inventory) / itemRate;
  }
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

function powerEffectKey(item: ActiveEffect): string {
  return [
    item.owner.facility.id,
    item.owner.index,
    item.owner.name,
    item.skill,
    item.effect.stat,
    JSON.stringify(item.effect.per ?? item.effect.value ?? null),
  ].join("|");
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
  const powerPlacements = placementsInRoomType(context, "power");
  const operatorEfficiency =
    powerPlacements.filter((placement) => isCurrentlyWorking(placement))
      .length * 5;
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
      EMPTY_ZEROED_SKILL_STATE,
      new Set(["droneCharge", "abyssalBoost"]),
      "combination",
    );
    const base = aggregateEffectValues(
      context,
      facility,
      catalog,
      context.active,
      data,
      EMPTY_ZEROED_SKILL_STATE,
      new Set(["droneCharge", "abyssalBoost", "facBase"]),
      "base",
    );
    combination.details.forEach(({ item, value }) => {
      const key = powerEffectKey(item);
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
      const key = powerEffectKey(item);
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
  const operatorSkillEfficiency = skillEfficiency;
  const efficiency =
    baseEfficiency + operatorEfficiency + combinationEfficiency;
  const production: ProductionValue = {
    product: "无人机",
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
    segments: [
      {
        startHours: 0,
        endHours: context.durationHours,
        base: DRONE_LIMIT,
        skill: 0,
        total: DRONE_LIMIT,
      },
    ],
  };
  const decoratedProduction = decorateProduction(
    context,
    first,
    production,
    capacity,
  );
  return {
    facility: first,
    baseEfficiency,
    moodEfficiency: operatorEfficiency,
    operatorEfficiency,
    skillEfficiency,
    operatorSkillEfficiency,
    combinationEfficiency: operatorEfficiency + combinationEfficiency,
    efficiency,
    attributes: {},
    production: decoratedProduction,
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
  const capacityCalculations = new Map<string, CapacityCalculation>();
  context.facilities.forEach((facility) => {
    const calculation = capacityCalculationFor(
      context,
      facility,
      attributes.get(facility.id) ?? {
        attributes: {},
        rawOrderLimit: 0,
        capBoosts: {},
        linked: false,
        orderLimitNet: 0,
      },
      catalog,
      context.active,
    );
    if (calculation) {
      capacityCalculations.set(facility.id, calculation);
    }
  });
  const bonusByFacility = collectBonusByFacility(
    context,
    catalog,
    attributes,
    capacityCalculations,
  );
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
      calculateFacility(
        context,
        facility,
        catalog,
        state,
        bonusByFacility,
        capacityCalculations.get(facility.id),
      ),
    );
  });
  return {
    name: context.plan.name ?? `队列${context.index + 1}`,
    durationHours: context.durationHours,
    facilities,
    moods: context.placements
      .filter((placement) => isMoodContinuityPlacement(placement, catalog))
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
  const dailyProductions = aggregateDailyProductions(plans, totalHours);
  return {
    document,
    plans,
    dailyHours: totalHours,
    dailyFacilities: aggregateDaily(plans, totalHours),
    dailyProductions,
    dailyOutputs: aggregateDailyOutputs(document, dailyProductions),
    ...(fiammetta ? { fiammetta } : {}),
    fiammettaWarnings: plans.flatMap((plan) => plan.fiammettaWarnings),
    warnings: plans.flatMap((plan) => plan.warnings),
  };
}
