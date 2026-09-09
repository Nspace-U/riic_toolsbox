import type {
  EfficiencyCatalog,
  EfficiencyCondition,
  EfficiencyEffect,
  EfficiencyFacility,
  EfficiencyOperator,
  EfficiencyPer,
  EfficiencyPlanResult,
  EfficiencyResult,
  FacilityAttributes,
  FacilityEfficiencyResult,
  MoodSnapshot,
  OperatorSkillFile,
  ProductionValue,
} from "@/types/efficiency";
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
import { roomSlotCount } from "@/utils/schedule";

const EPSILON = 0.000001;
const DEFAULT_DURATION_MINUTES = 720;
const DRONE_LIMIT = 235;
const POWER_OUTPUT_PER_HOUR = 10;
const CLUE_OUTPUT_PER_HOUR = 2;
const HIRE_OUTPUT_PER_HOUR = 1 / 12;
const EFFICIENCY_STATS = new Set([
  "tradeSpd",
  "manuProd",
  "clueSpeed",
  "hireSpd",
  "droneCharge",
  "abyssalBoost",
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
  working: boolean;
  workHoursBefore: number;
}

interface PlanContext {
  plan: Plan;
  settings: ScheduleSettings;
  index: number;
  durationHours: number;
  facilities: EfficiencyFacility[];
  placements: Placement[];
  byName: Map<string, Placement>;
  active: ActiveEffect[];
  basePoints: Record<string, number>;
  statValues: Map<string, number>;
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

function clampMood(value: number): number {
  return Math.max(0, Math.min(24, Number.isFinite(value) ? value : 24));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function roomAssignments(
  plan: Plan,
  facility: EfficiencyFacility,
): RoomAssignment {
  const rooms = plan.rooms[facility.type];
  const entries = Array.isArray(rooms) ? rooms : [];
  const assignment = entries[facility.index];
  return isRecord(assignment) ? (assignment as RoomAssignment) : {};
}

function stateOf(assignment: RoomAssignment, name: string): OperatorState {
  return assignment.operatorStates?.[name] ?? {};
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
      const assignment = roomAssignments(plan, facility);
      if (assignment.skip) {
        return;
      }
      (assignment.operators ?? []).forEach((name, operatorIndex) => {
        const profile = catalogOperator(catalog, name);
        if (!profile) {
          warnings.push(`队列 ${index + 1}：找不到干员“${name}”的技能数据`);
        }
        const state = stateOf(assignment, name);
        placements.push({
          name,
          facility,
          assignment,
          index: operatorIndex,
          state,
          profile,
          skillFile: profile?.skillFile,
          selected: selectedSkills(profile?.skillFile, facility.type, state),
          explicitMood: Object.prototype.hasOwnProperty.call(state, "mood"),
          moodStart: clampMood(state.mood ?? 24),
          moodEnd: clampMood(state.mood ?? 24),
          costRate: 0,
          working: (state.mood ?? 24) > 0,
          workHoursBefore: 0,
        });
      });
    });
    return {
      plan,
      settings: document.settings ?? {},
      index,
      durationHours,
      facilities,
      placements,
      byName: new Map(
        placements.map((placement) => [placement.name, placement]),
      ),
      active: [],
      basePoints: {},
      statValues: new Map(),
      warnings,
    };
  });
}

function isWorkPlacement(placement: Placement): boolean {
  return WORK_ROOM_KEYS.includes(placement.facility.type);
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
        (placement) => isWorkPlacement(placement) && placement.working,
      );
      result = working.length === 1 && working[0]?.name === owner.name;
      break;
    }
    case "clueExchanging":
      result =
        context.plan.rooms.meeting !== undefined &&
        context.settings.clueExchanging === true;
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
  context: PlanContext,
  catalog: EfficiencyCatalog,
  data: EvaluationData,
): PerValue {
  const sameFacility = owner.facility;
  const countInFacility = (type: RoomKey | "same" | undefined): Placement[] => {
    const facilityType = type === "same" || !type ? sameFacility.type : type;
    return placementsInRoomType(context, facilityType);
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
      const facility =
        per.facility === "same" &&
        owner.name === "灵知" &&
        per.group === "cc.g.karlan" &&
        target?.type === "trading"
          ? "trading"
          : per.facility;
      count = countInFacility(facility)
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
      const members = catalog.terms[per.tag ?? ""]?.members ?? [];
      count = countInFacility(per.facility)
        .filter((placement) => workingPlacement(placement, per.moodCheck))
        .reduce(
          (total, placement) =>
            total +
            placement.selected.filter((item) => members.includes(item.skill))
              .length,
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
            const assignment = roomAssignments(context.plan, facility);
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
  const times = per.floor
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

function curveAverage(
  curve: NonNullable<EfficiencyEffect["curve"]>,
  duration: number,
  start: number,
): number {
  let total = 0;
  for (let hour = 1; hour <= Math.ceil(duration); hour += 1) {
    const weight = Math.max(0, Math.min(1, duration - (hour - 1)));
    const value = Math.min(
      curve.startValue + (start + hour - curve.startHours) * curve.step,
      curve.cap,
    );
    total += value * weight;
  }
  return duration > EPSILON ? total / duration : 0;
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
    value = curveAverage(
      effect.curve,
      context.durationHours,
      owner.workHoursBefore,
    );
  } else if (effect.per) {
    value = perCount(effect.per, owner, target, context, catalog, data).value;
  } else {
    value = Number(effect.value ?? 0) + Number(effect.baseValue ?? 0);
  }
  if (effect.condition?.type === "workHours") {
    const threshold = Number(effect.condition.value ?? 0);
    const activeHours = Math.max(
      0,
      Math.min(
        context.durationHours,
        owner.workHoursBefore + context.durationHours - threshold,
      ),
    );
    value *=
      context.durationHours > EPSILON ? activeHours / context.durationHours : 0;
  }
  return value;
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
    .filter((placement) => placement.working)
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

function computeBasePoints(
  context: PlanContext,
  active: ActiveEffect[],
  catalog: EfficiencyCatalog,
  data: EvaluationData,
): Record<string, number> {
  const points: Record<string, number> = {};
  active
    .filter((item) => item.effect.stat === "basePointGain")
    .forEach((item) => {
      const term = item.effect.term;
      if (!term) return;
      points[term] =
        (points[term] ?? 0) +
        effectValue(item, item.target, context, catalog, data);
    });
  active
    .filter((item) => item.effect.stat === "basePointConvert")
    .forEach((item) => {
      const from = item.effect.from;
      const to = item.effect.to;
      if (!from || !to) return;
      const amount = Math.max(
        0,
        (points[from] ?? 0) * Number(item.effect.rate ?? 0),
      );
      points[from] = Math.max(0, (points[from] ?? 0) - amount);
      points[to] = (points[to] ?? 0) + amount;
    });
  return points;
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
): number {
  if (!placement.working || !isWorkPlacement(placement)) return 0;
  const controlWorkers = placementsInRoomType(context, "control").filter(
    (candidate) => candidate.working,
  ).length;
  let rate = 1 - controlWorkers * 0.05;
  if (
    placement.facility.type === "trading" ||
    placement.facility.type === "manufacture"
  ) {
    const count = placementsInFacility(context, placement.facility).filter(
      (candidate) => candidate.working,
    ).length;
    if (count >= 3) rate -= 0.1;
    else if (count === 2) rate -= 0.05;
  }
  const skillCosts: number[] = [];
  const zeroMood = context.active
    .filter((item) => item.effect.stat === "zeroOpMood")
    .some(
      (item) =>
        effectAppliesToSubject(item, placement, placement.facility, catalog) ||
        (item.effect.group &&
          membersFor(catalog, item.effect.group).includes(placement.name)),
    );
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
      skillCosts.push(item.effect.stat === "moodRecover" ? -value : value);
    });
  const skillCost = zeroMood
    ? skillCosts
        .filter((value) => value <= 0)
        .reduce((total, value) => total + value, 0)
    : skillCosts.reduce((total, value) => total + value, 0);
  rate += skillCost;
  return Math.max(0, rate);
}

function resolveMoods(
  contexts: PlanContext[],
  catalog: EfficiencyCatalog,
): void {
  contexts.forEach((context, index) => {
    context.placements.forEach((placement) => {
      const previousContext = index > 0 ? contexts[index - 1] : undefined;
      const previous = previousContext?.byName.get(placement.name);
      const explicit = placement.explicitMood;
      if (explicit) {
        placement.moodStart = clampMood(placement.state.mood ?? 24);
      } else if (previous?.working && previous.moodEnd > EPSILON) {
        placement.moodStart = previous.moodEnd;
      } else {
        placement.moodStart = 24;
      }
      placement.working = placement.moodStart > EPSILON;
      placement.workHoursBefore = previous?.working
        ? previous.workHoursBefore + (previousContext?.durationHours ?? 0)
        : 0;
    });
    if (index === 0 && contexts.length > 1) {
      const last = contexts.at(-1);
      context.placements.forEach((placement) => {
        const previousLast = last?.byName.get(placement.name);
        if (
          !placement.explicitMood &&
          previousLast?.working &&
          previousLast.moodEnd > EPSILON
        ) {
          placement.moodStart = previousLast.moodEnd;
          placement.working = true;
        }
      });
    }
  });

  for (let round = 0; round < 3; round += 1) {
    contexts.forEach((context) => {
      const emptyData: EvaluationData = { capBoosts: {}, bonusByFacility: {} };
      context.active = collectActive(context, catalog, true);
      context.basePoints = computeBasePoints(
        context,
        context.active,
        catalog,
        emptyData,
      );
      context.active = collectActive(context, catalog, false);
      context.basePoints = computeBasePoints(
        context,
        context.active,
        catalog,
        emptyData,
      );
      context.statValues = preliminaryStatValues(
        context,
        context.active,
        catalog,
      );
      context.active = collectActive(context, catalog, false);
      context.placements.forEach((placement) => {
        placement.costRate = resolveMoodRate(
          context,
          placement,
          catalog,
          emptyData,
        );
        placement.moodEnd = isWorkPlacement(placement)
          ? clampMood(
              placement.moodStart - placement.costRate * context.durationHours,
            )
          : placement.moodStart;
      });
    });
  }
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
  const assignment = roomAssignments(context.plan, facility);
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
        (item.effect.stat === "tradeNetEff" ||
          item.effect.per?.source === "stat"),
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

function zeroedOperators(
  context: PlanContext,
  facility: EfficiencyFacility,
): Set<string> {
  const zero = new Set<string>();
  context.active
    .filter(
      (item) =>
        item.target?.id === facility.id && item.effect.stat === "zeroOpBonus",
    )
    .forEach((item) => {
      placementsInFacility(context, facility).forEach((placement) => {
        if (placement.name !== item.owner.name) zero.add(placement.name);
      });
    });
  return zero;
}

function isCountEffect(effect: EfficiencyEffect): boolean {
  const source = effect.per?.source;
  return (
    source === "facilityCount" ||
    source === "facilityLevel" ||
    source === "facilityLevelTotal"
  );
}

function aggregateEffectValues(
  context: PlanContext,
  facility: EfficiencyFacility,
  catalog: EfficiencyCatalog,
  active: ActiveEffect[],
  data: EvaluationData,
  zeroed: Set<string>,
  stats: Set<string>,
): { total: number; details: Array<{ item: ActiveEffect; value: number }> } {
  const normal: Array<{ item: ActiveEffect; value: number }> = [];
  active
    .filter(
      (item) => item.target?.id === facility.id && stats.has(item.effect.stat),
    )
    .filter((item) =>
      recipeMatches(item.effect, roomAssignments(context.plan, facility)),
    )
    .filter((item) => item.effect.stat !== "tradeNetEff")
    .filter(
      (item) =>
        item.effect.per?.source !== "stat" &&
        item.effect.per?.source !== "orderCount",
    )
    .filter((item) => !["moodCost", "moodRecover"].includes(item.effect.stat))
    .filter((item) => item.effect.stack !== "max")
    .filter(
      (item) => !zeroed.has(item.owner.name) || isCountEffect(item.effect),
    )
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
    .filter((item) =>
      recipeMatches(item.effect, roomAssignments(context.plan, facility)),
    )
    .filter((item) => item.effect.stack === "max")
    .filter((item) => item.effect.stat !== "tradeNetEff")
    .filter(
      (item) => !zeroed.has(item.owner.name) || isCountEffect(item.effect),
    )
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
    const zeroed = zeroedOperators(context, facility);
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
      context.active,
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
  const netEffects = active.filter(
    (item) =>
      item.target?.id === facility.id && item.effect.stat === "tradeNetEff",
  );
  const orderEffects = active.filter(
    (item) =>
      item.target?.id === facility.id &&
      item.effect.stat === "tradeSpd" &&
      item.effect.per?.source === "orderCount",
  );
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
  const orderLimitNet = Math.max(1, state.rawOrderLimit - cut);
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
    const diff =
      jieEffects.length > 0
        ? orderLimitNet
        : Math.max(1, baseOrder + state.rawOrderLimit);
    const specialValue = diff * perValue;
    value += specialValue;
    details.push({ item, value: specialValue });
  });
  return { value, orderLimitNet, details };
}

function detailRows(
  aggregate: { details: Array<{ item: ActiveEffect; value: number }> },
  facility: RoomKey,
): Array<{
  operator: string;
  skill?: string;
  stat: string;
  value: number;
  facility: RoomKey;
}> {
  return aggregate.details
    .filter(({ value }) => Math.abs(value) > EPSILON)
    .map(({ item, value }) => ({
      operator: item.owner.name,
      skill: item.skill,
      stat: item.effect.stat,
      value,
      facility,
    }));
}

function calculateFacility(
  context: PlanContext,
  facility: EfficiencyFacility,
  catalog: EfficiencyCatalog,
  attributeState: AttributeState,
  bonusByFacility: Record<string, Record<string, Record<string, number>>>,
): FacilityEfficiencyResult {
  const data: EvaluationData = {
    capBoosts: attributeState.capBoosts,
    bonusByFacility,
  };
  const zeroed = zeroedOperators(context, facility);
  const aggregate = aggregateEffectValues(
    context,
    facility,
    catalog,
    context.active,
    data,
    zeroed,
    EFFICIENCY_STATS,
  );
  const facBase = aggregateEffectValues(
    context,
    facility,
    catalog,
    context.active,
    data,
    new Set<string>(),
    new Set(["facBase"]),
  );
  const placements = placementsInFacility(context, facility);
  let operatorEfficiency = 0;
  placements.forEach((placement) => {
    if (facility.type === "meeting") {
      operatorEfficiency +=
        (placement.working ? 5 : 0) +
        rarityEfficiency(placement.profile?.rarity ?? 0) +
        eliteEfficiency(placement.state.elite ?? 0);
    } else if (facility.type === "power" || facility.type === "hire") {
      operatorEfficiency += placement.working ? 5 : 0;
    } else if (facility.type === "trading" || facility.type === "manufacture") {
      operatorEfficiency += placement.working ? 1 : 0;
    }
  });
  let baseEfficiency = facilityBaseEfficiency(facility.type, facility.level);
  if (facility.type === "meeting") {
    const atmosphere = context.facilities
      .filter((candidate) => candidate.type === "dormitory")
      .reduce((total, candidate) => total + candidate.level * 1000, 0);
    baseEfficiency += meetingAtmosphereBonus(atmosphere);
  }
  baseEfficiency += facBase.total;
  const special = tradeSpecialEfficiency(
    context,
    facility,
    catalog,
    attributeState,
    context.active,
    data,
    aggregate.total,
  );
  const skillEfficiency = aggregate.total + special.value;
  if (facility.type === "trading" && attributeState.attributes.orderLimit) {
    const raw = attributeState.rawOrderLimit;
    const skill = attributeState.linked ? special.orderLimitNet : raw;
    attributeState.attributes.orderLimit = {
      base: attributeState.attributes.orderLimit.base,
      skill,
      total: Math.max(1, attributeState.attributes.orderLimit.base + skill),
    };
  }
  const details = [
    ...detailRows(aggregate, facility.type),
    ...detailRows(facBase, facility.type),
    ...detailRows(special, facility.type),
  ];
  const result: FacilityEfficiencyResult = {
    facility,
    baseEfficiency,
    operatorEfficiency,
    skillEfficiency,
    efficiency: baseEfficiency + operatorEfficiency + skillEfficiency,
    attributes: attributeState.attributes,
    details,
  };
  result.production = productionFor(
    context,
    facility,
    result.efficiency,
    catalog,
    context.active,
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
  const assignment = roomAssignments(context.plan, facility);
  const product = assignment.product ?? "LMD";
  if (product === "Orundum") {
    const multiplier = efficiency / 100;
    return {
      product,
      amountPerHour: (20 / 2) * multiplier,
      amountPerDay: (20 / 2) * multiplier * 24,
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
    const amountPerHour =
      (Number(fixed.order.qty ?? 0) / Number(fixed.order.time ?? 1)) *
      (fixed.order.ignoreEff ? 1 : multiplier);
    const material: Record<string, number> = {};
    if (fixed.order.material && fixed.order.amount) {
      material[fixed.order.material] =
        (Number(fixed.order.amount) / Number(fixed.order.time ?? 1)) *
        (fixed.order.ignoreEff ? 1 : multiplier);
    }
    return {
      product: "LMD",
      amountPerHour,
      amountPerDay: amountPerHour * 24,
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
  sourceOrders.forEach((order) => {
    const gold =
      fixValues?.qty !== undefined
        ? Number(fixValues.qty)
        : Number(order.gold) +
          (breachByAmount.get(order.amount) ?? 0) +
          (order.amount === 4 ? investAmount : 0);
    const material =
      fixValues?.amount !== undefined ? Number(fixValues.amount) : order.amount;
    expectedGold += order.probability * gold;
    expectedTime += order.probability * order.hours;
    expectedMaterial += order.probability * material;
  });
  if (expectedTime <= EPSILON) return undefined;
  const amountPerHour = (expectedGold / expectedTime) * multiplier;
  return {
    product: "LMD",
    amountPerHour,
    amountPerDay: amountPerHour * 24,
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
  const assignment = roomAssignments(context.plan, facility);
  if (facility.type === "trading")
    return tradeProduction(context, facility, efficiency, active);
  if (facility.type === "manufacture") {
    const rule = manufactureRule(assignment.product, assignment.sourceMaterial);
    if (!rule) return undefined;
    const multiplier = efficiency / 100;
    return {
      product: rule.product,
      amountPerHour: (rule.amount / rule.hours) * multiplier,
      amountPerDay: (rule.amount / rule.hours) * multiplier * 24,
      materialPerHour: Object.fromEntries(
        Object.entries(rule.materials ?? {}).map(([material, amount]) => [
          material,
          (amount / rule.hours) * multiplier,
        ]),
      ),
    };
  }
  if (facility.type === "meeting") {
    const amountPerHour = (CLUE_OUTPUT_PER_HOUR * efficiency) / 100;
    return { product: "Clue", amountPerHour, amountPerDay: amountPerHour * 24 };
  }
  if (facility.type === "hire") {
    const amountPerHour = (HIRE_OUTPUT_PER_HOUR * efficiency) / 100;
    return {
      product: "Recruit Refresh",
      amountPerHour,
      amountPerDay: amountPerHour * 24,
    };
  }
  void catalog;
  return undefined;
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
  if (!first) return undefined;
  const operatorEfficiency =
    placementsInRoomType(context, "power").filter(
      (placement) => placement.working,
    ).length * 5;
  const seen = new Set<string>();
  const seenBase = new Set<string>();
  let skillEfficiency = 0;
  let facBase = 0;
  powerFacilities.forEach((facility) => {
    const data: EvaluationData = {
      capBoosts: attributeStates.get(facility.id)?.capBoosts ?? {},
      bonusByFacility,
    };
    const aggregate = aggregateEffectValues(
      context,
      facility,
      catalog,
      context.active,
      data,
      new Set(),
      new Set(["droneCharge", "abyssalBoost"]),
    );
    aggregate.details.forEach(({ item, value }) => {
      const key = `${item.owner.name}|${item.skill}|${item.effect.stat}|${JSON.stringify(item.effect.per ?? item.effect.value ?? null)}`;
      if (!seen.has(key)) {
        seen.add(key);
        skillEfficiency += value;
      }
    });
    const base = aggregateEffectValues(
      context,
      facility,
      catalog,
      context.active,
      data,
      new Set(),
      new Set(["facBase"]),
    );
    base.details.forEach(({ item, value }) => {
      const key = `${item.owner.name}|${item.skill}|${item.effect.stat}|${JSON.stringify(item.effect.per ?? item.effect.value ?? null)}`;
      if (!seenBase.has(key)) {
        seenBase.add(key);
        facBase += value;
      }
    });
  });
  const baseEfficiency = 100 + facBase;
  const efficiency = baseEfficiency + operatorEfficiency + skillEfficiency;
  const production: ProductionValue = {
    product: "Drone",
    amountPerHour: (POWER_OUTPUT_PER_HOUR * efficiency) / 100,
    amountPerDay: ((POWER_OUTPUT_PER_HOUR * efficiency) / 100) * 24,
  };
  return {
    facility: first,
    baseEfficiency,
    operatorEfficiency,
    skillEfficiency,
    efficiency,
    attributes: {},
    production,
    details: [],
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
    if (facility.type === "processing" || facility.type === "training") return;
    if (facility.type === "power") {
      if (facility.index === 0 && powerResult) facilities.push(powerResult);
      return;
    }
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
      .filter((placement) => isWorkPlacement(placement))
      .map((placement): MoodSnapshot => ({
        operator: placement.name,
        facility: placement.facility.type,
        start: placement.moodStart,
        end: placement.moodEnd,
        costRate: placement.costRate,
        working: placement.working,
      })),
    basePoints: context.basePoints,
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
    if (amounts.length === 0 || totalHours <= EPSILON) return result;
    const total = plans.reduce((sum, plan) => {
      const production = plan.facilities.find(
        (candidate) => candidate.facility.id === result.facility.id,
      )?.production;
      return sum + (production?.amountPerHour ?? 0) * plan.durationHours;
    }, 0);
    return {
      ...result,
      production: {
        ...result.production,
        product: amounts[0]?.product ?? result.production?.product ?? "",
        amountPerHour: total / totalHours,
        amountPerDay: (total / totalHours) * 24,
      },
    };
  });
}

export function calculateEfficiency(
  document: ScheduleDocument,
  catalog: EfficiencyCatalog,
): EfficiencyResult {
  const contexts = createContexts(document, catalog);
  resolveMoods(contexts, catalog);
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
    warnings: plans.flatMap((plan) => plan.warnings),
  };
}
