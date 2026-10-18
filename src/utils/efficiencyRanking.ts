import {
  calculateEfficiency,
  type EfficiencyCatalog,
  type EfficiencyCondition,
  type EfficiencyResult,
  type EfficiencySkillChain,
  type EfficiencySkillStage,
  type OperatorProgressionProfile,
  groupIncludesOperator,
} from "@arknights/riic-efficiency";

import type { EliteLevel, Operator } from "@/types/baseData";
import type {
  LayoutEntry,
  OperatorState,
  RoomAssignment,
  RoomKey,
  ScheduleDocument,
} from "@/types/schedule";
import {
  LAYOUT_PRESETS,
  layoutWithBuildChain,
  roomsForLayout,
  resizeRoomsForLayout,
} from "@/utils/simulator/layout";
import { parseLayoutText, ROOM_LABELS, roomSlotCount } from "@/utils/schedule";

export const EFFICIENCY_RANKING_FACILITIES: ReadonlyArray<{
  key: RoomKey;
  label: string;
}> = [
  { key: "power", label: "发电站" },
  { key: "meeting", label: "会客室" },
  { key: "hire", label: "办公室" },
  { key: "recycle", label: "回收站" },
  { key: "dormitory", label: "宿舍" },
];

export interface EfficiencyRankingSettings {
  avatar: {
    showAvatar: boolean;
    showProfession: boolean;
    showEliteLevel: boolean;
    showRarity: boolean;
  };
  showOperatorProgressionInNames: boolean;
  mergeIdenticalEfficiencyCells: boolean;
  clueExchanging: boolean;
  workHours: number;
  treatSkillsAsUnlocked: boolean;
}

export const DEFAULT_EFFICIENCY_RANKING_SETTINGS: EfficiencyRankingSettings = {
  avatar: {
    showAvatar: false,
    showProfession: false,
    showEliteLevel: false,
    showRarity: false,
  },
  showOperatorProgressionInNames: true,
  mergeIdenticalEfficiencyCells: true,
  clueExchanging: true,
  workHours: 24,
  treatSkillsAsUnlocked: false,
};

export interface EfficiencyRankingEntry {
  id: string;
  facility: RoomKey;
  operator: Operator;
  progression: { elite: EliteLevel; level: number };
  progressionLabel: string;
  sourceIndex: number;
  schedule: ScheduleDocument;
}

export interface EfficiencyRankingCalculationResult {
  id: string;
  efficiency?: number;
  moodExtra?: number;
  notes: string[];
}

export interface EfficiencyRankingScheduleOptions {
  layout: LayoutEntry[];
  savedRooms?: Record<string, RoomAssignment[]>;
  workHours: number;
  clueExchanging: boolean;
  treatSkillsAsUnlocked: boolean;
  progressionProfile?: OperatorProgressionProfile;
  dormitoryDefaultIncludesMoodRecovery: boolean;
  catalog: EfficiencyCatalog;
}

export const EFFICIENCY_RANKING_OPERATOR_NOTES: Readonly<
  Record<string, string>
> = {
  char_4218_aigis: "结城理进驻在制造站",
  char_4227_gallus: "其他作业平台进驻在发电站",
  char_4188_confes: "其他拉特兰干员（空构）进驻在发电站",
  char_4136_phonor: "逻各斯进驻在训练室",
  char_4015_spuria: "5小时暖机",
  char_4093_frston: "凯尔希进驻在控制中枢",
  char_249_mlyss: "额外5名莱茵生命挂件",
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function catalogForEfficiencyRankingEntry(
  catalog: EfficiencyCatalog,
  entry: EfficiencyRankingEntry,
): EfficiencyCatalog {
  if (
    entry.facility !== "power" ||
    !["char_4227_gallus", "char_4188_confes"].includes(entry.operator.id)
  ) {
    return catalog;
  }
  const operator = catalog.operators[entry.operator.name];
  const skillFile = operator?.skillFile;
  if (!operator || !skillFile) return catalog;
  return {
    ...catalog,
    operators: {
      ...catalog.operators,
      [entry.operator.name]: {
        ...operator,
        skillFile: {
          ...skillFile,
          chains: skillFile.chains.map((chain) =>
            chain.room !== "power"
              ? chain
              : {
                  ...chain,
                  stages: chain.stages.map((stage) => ({
                    ...stage,
                    effects: stage.effects.map((effect) => {
                      const condition = effect.condition;
                      if (
                        condition?.type !== "opGroupInFacility" ||
                        condition.facility !== "same" ||
                        !condition.other
                      ) {
                        return effect;
                      }
                      return {
                        ...effect,
                        condition: { ...condition, facility: "power" },
                      };
                    }),
                  })),
                },
          ),
        },
      },
    },
  };
}

function progressionFromUnlock(
  unlock: EfficiencySkillStage["unlock"],
): { elite: EliteLevel; level: number } | undefined {
  const value = Number(unlock.value);
  if (!Number.isInteger(value)) return undefined;
  if (unlock.type === "level") {
    return { elite: 0, level: Math.max(1, value) };
  }
  if (value < 0 || value > 2) return undefined;
  return { elite: value as EliteLevel, level: 1 };
}

function compareProgression(
  left: { elite: EliteLevel; level: number },
  right: { elite: EliteLevel; level: number },
): number {
  return left.elite - right.elite || left.level - right.level;
}

function progressionKey(value: { elite: EliteLevel; level: number }): string {
  return `${value.elite}:${value.level}`;
}

function progressionLabel(
  progression: { elite: EliteLevel; level: number },
  skillFileHasLevelNode: boolean,
): string {
  const eliteLabel =
    progression.elite === 1 ? "Ⅰ" : progression.elite === 2 ? "Ⅱ" : "";
  return `${eliteLabel}${progression.level >= 30 && skillFileHasLevelNode ? "(Lv30)" : ""}`;
}

export function buildEfficiencyRankingEntries(
  operators: Operator[],
  catalog: EfficiencyCatalog,
  treatSkillsAsUnlocked: boolean,
): Omit<EfficiencyRankingEntry, "schedule">[] {
  const operatorIndexes = new Map(
    operators.map((operator, index) => [operator.name, index]),
  );
  const entries: Omit<EfficiencyRankingEntry, "schedule">[] = [];
  EFFICIENCY_RANKING_FACILITIES.forEach(({ key: facility }) => {
    operators.forEach((operator, sourceIndex) => {
      const skillFile = catalog.operators[operator.name]?.skillFile;
      const chains =
        skillFile?.chains.filter((chain) => chain.room === facility) ?? [];
      if (chains.length === 0) return;
      const progressions = new Map<
        string,
        { elite: EliteLevel; level: number }
      >();
      chains.forEach((chain) => {
        chain.stages.forEach((stage) => {
          if (stage.effects.length === 0) return;
          const progression = progressionFromUnlock(stage.unlock);
          if (progression)
            progressions.set(progressionKey(progression), progression);
        });
      });
      const allProgressions = [...progressions.values()].sort(
        compareProgression,
      );
      const selectedProgressions = treatSkillsAsUnlocked
        ? allProgressions.slice(-1)
        : allProgressions;
      const hasLevelNode = chains.some((chain) =>
        chain.stages.some((stage) => stage.unlock.type === "level"),
      );
      selectedProgressions.forEach((progression) => {
        const suffix = progressionLabel(progression, hasLevelNode);
        entries.push({
          id: `${facility}:${operator.id}:${progressionKey(progression)}`,
          facility,
          operator,
          progression,
          progressionLabel: suffix,
          sourceIndex: operatorIndexes.get(operator.name) ?? sourceIndex,
        });
      });
    });
  });
  return entries;
}

export function createDefaultEfficiencyRankingLayout(): LayoutEntry[] {
  const preset = LAYOUT_PRESETS.find((item) => item.id === "243");
  if (!preset) throw new Error("找不到243预设布局");
  return layoutWithBuildChain(parseLayoutText(preset.layoutText));
}

function addOperatorToFacility(
  rooms: Record<string, RoomAssignment[] | unknown>,
  layout: LayoutEntry[],
  facility: RoomKey,
  name: string,
  allowDuplicate = false,
): void {
  const assignments = rooms[facility];
  if (!Array.isArray(assignments)) return;
  if (
    !allowDuplicate &&
    (assignments as RoomAssignment[]).some((assignment) =>
      assignment.operators?.includes(name),
    )
  ) {
    return;
  }
  const entries = layout.filter((entry) => entry.type === facility);
  for (const [index, assignment] of (
    assignments as RoomAssignment[]
  ).entries()) {
    const capacity = roomSlotCount(facility, entries[index]?.level ?? 1);
    const operators = [...(assignment.operators ?? [])];
    const emptyIndex = operators.findIndex((operator) => !operator);
    if (emptyIndex >= 0) {
      operators[emptyIndex] = name;
      assignment.operators = operators;
      return;
    }
    if (operators.length < capacity) {
      operators.push(name);
      assignment.operators = operators;
      return;
    }
  }
}

function placeDefaultSupports(
  operator: Operator,
  rooms: Record<string, RoomAssignment[] | unknown>,
  layout: LayoutEntry[],
  catalog: EfficiencyCatalog,
): void {
  if (operator.id === "char_4218_aigis") {
    addOperatorToFacility(rooms, layout, "manufacture", "结城理");
  }
  if (operator.id === "char_4227_gallus") {
    addOperatorToFacility(
      rooms,
      layout,
      "power",
      catalog.terms["cc.tag.op"]?.name ?? "作业平台",
    );
  }
  if (operator.id === "char_4188_confes") {
    addOperatorToFacility(rooms, layout, "power", "空构");
  }
  if (operator.id === "char_4136_phonor") {
    addOperatorToFacility(rooms, layout, "training", "逻各斯");
  }
  if (operator.id === "char_4093_frston") {
    addOperatorToFacility(rooms, layout, "control", "凯尔希");
  }
  if (operator.id === "char_249_mlyss") {
    const memberTerm = catalog.terms["cc.g.rh"]?.name ?? "莱茵生命";
    for (let index = 0; index < 5; index += 1) {
      addOperatorToFacility(rooms, layout, "dormitory", memberTerm, true);
    }
  }
}

export function createEfficiencyRankingSchedule(
  entry: Omit<EfficiencyRankingEntry, "schedule">,
  options: EfficiencyRankingScheduleOptions,
): ScheduleDocument {
  const rooms = options.savedRooms
    ? clone(options.savedRooms)
    : roomsForLayout(options.layout);
  const plan = {
    name: `${entry.operator.name}${entry.progressionLabel}`,
    duration: Math.round(options.workHours * 60),
    rooms,
  };
  resizeRoomsForLayout(plan, options.layout);
  const assignments = plan.rooms[entry.facility];
  if (Array.isArray(assignments)) {
    const targetAssignment = (assignments as RoomAssignment[])[0];
    if (targetAssignment) {
      const facilityEntry = options.layout.find(
        (item) => item.type === entry.facility,
      );
      const capacity = roomSlotCount(entry.facility, facilityEntry?.level ?? 1);
      targetAssignment.operators = [
        entry.operator.name,
        ...(targetAssignment.operators ?? [])
          .filter((name) => name && name !== entry.operator.name)
          .slice(0, Math.max(0, capacity - 1)),
      ];
      targetAssignment.operatorStates = {
        ...targetAssignment.operatorStates,
        [entry.operator.name]: {
          ...targetAssignment.operatorStates?.[entry.operator.name],
          elite: entry.progression.elite,
          level: entry.progression.level,
        },
      };
    }
  }
  if (!options.savedRooms) {
    placeDefaultSupports(
      entry.operator,
      plan.rooms,
      options.layout,
      options.catalog,
    );
  }
  return {
    layout: clone(options.layout),
    plans: [plan],
    settings: {
      clueExchanging: options.clueExchanging,
      treatSkillsAsUnlocked: options.treatSkillsAsUnlocked,
      dormitoryDefaultIncludesMoodRecovery:
        options.dormitoryDefaultIncludesMoodRecovery,
      ...(options.progressionProfile
        ? { progressionProfile: clone(options.progressionProfile) }
        : {}),
    },
  };
}

function targetEfficiency(
  result: EfficiencyResult,
  entry: EfficiencyRankingEntry,
): number | undefined {
  const plan = result.plans[0];
  if (!plan) return undefined;
  if (entry.facility === "dormitory") {
    const moodDetails = plan.moods.flatMap((mood) =>
      mood.rateDetails.filter(
        (detail) =>
          mood.facility === "dormitory" &&
          detail.kind === "skill" &&
          detail.operator === entry.operator.name,
      ),
    );
    return moodDetails.length > 0
      ? -moodDetails.reduce((total, detail) => total + detail.value, 0)
      : undefined;
  }
  const facility = plan.facilities.find(
    (item) => item.facility.type === entry.facility,
  );
  if (!facility) return undefined;
  return facility.details
    .filter(
      (detail) =>
        detail.operator === entry.operator.name &&
        detail.facility === entry.facility &&
        (detail.ownerFacility ?? detail.facility) === entry.facility,
    )
    .reduce((total, detail) => total + detail.value, 0);
}

function selectedStages(
  chains: Array<{ chain: EfficiencySkillChain; chainIndex: number }>,
  progression: { elite: EliteLevel; level: number },
): Array<{
  chainIndex: number;
  stageIndex: number;
  stage: EfficiencySkillStage;
}> {
  const stages: Array<{
    chainIndex: number;
    stageIndex: number;
    stage: EfficiencySkillStage;
  }> = [];
  chains.forEach(({ chain, chainIndex }) => {
    let stageIndex = -1;
    chain.stages.forEach((stage, index) => {
      const unlockValue = Number(stage.unlock.value);
      const unlocked =
        stage.unlock.type === "level"
          ? progression.level >= unlockValue
          : progression.elite >= unlockValue;
      if (unlocked) stageIndex = index;
    });
    const stage = chain.stages[stageIndex];
    if (stage) stages.push({ chainIndex, stageIndex, stage });
  });
  return stages;
}

function conditionDescription(
  condition: EfficiencyCondition,
  catalog: EfficiencyCatalog,
): string {
  const facility =
    condition.facility === "same"
      ? "同一设施"
      : (ROOM_LABELS[condition.facility as RoomKey] ?? "基建");
  const group = condition.group
    ? (catalog.terms[condition.group]?.name ?? condition.group)
    : "指定";
  switch (condition.type) {
    case "clueExchanging":
      return "需要开启线索交流";
    case "opAtFacility":
      return `需要${String(condition.op ?? "指定干员")}进驻${facility}`;
    case "opInBase":
      return `需要${String(condition.op ?? "指定干员")}进驻基建`;
    case "opInFacilityAndTarget":
      return `需要${String(condition.op ?? "指定干员")}进驻同一${facility}`;
    case "opGroupInFacility":
      return `需要${condition.other ? "其他" : ""}${group}干员进驻${facility}`;
    case "opGroupNotInFacility":
      return `需要${group}干员不在${facility}`;
    case "opGroupCountInFacility":
      return `需要${facility}有至少${condition.min ?? 1}名${group}干员`;
    case "opGroupCountInBase":
      return `需要基建内有至少${condition.min ?? 1}名${group}干员`;
    case "opCountInFacility":
      return `需要${facility}达到指定干员数量`;
    case "onlySelf":
      return "需要同一设施仅进驻该干员";
    case "workHours":
      return `需要工作时长达到${condition.value ?? 0}小时`;
    case "moodCmp":
      return `需要心情${condition.op ?? "满足条件"}${condition.value ?? ""}`;
    case "moodDrop":
      return `需要心情下降达到${condition.value ?? 0}`;
    case "statCmp":
      return `需要${condition.stat ?? "指定属性"}满足技能条件`;
    case "termCmp":
      return "需要满足基建术语条件";
    default:
      return `技能条件“${condition.type}”未满足`;
  }
}

function catalogWithoutEffectCondition(
  catalog: EfficiencyCatalog,
  operatorName: string,
  chainIndex: number,
  stageIndex: number,
  effectIndex: number,
): EfficiencyCatalog {
  const operator = catalog.operators[operatorName];
  const skillFile = operator?.skillFile;
  if (!operator || !skillFile) return catalog;
  return {
    ...catalog,
    operators: {
      ...catalog.operators,
      [operatorName]: {
        ...operator,
        skillFile: {
          ...skillFile,
          chains: skillFile.chains.map((chain, currentChainIndex) =>
            currentChainIndex !== chainIndex
              ? chain
              : {
                  ...chain,
                  stages: chain.stages.map((stage, currentStageIndex) =>
                    currentStageIndex !== stageIndex
                      ? stage
                      : {
                          ...stage,
                          effects: stage.effects.map(
                            (effect, currentEffectIndex) => {
                              if (currentEffectIndex !== effectIndex)
                                return effect;
                              const unconditional = { ...effect };
                              delete unconditional.condition;
                              return unconditional;
                            },
                          ),
                        },
                  ),
                },
          ),
        },
      },
    },
  };
}

function unmetConditionNotes(
  catalog: EfficiencyCatalog,
  entry: EfficiencyRankingEntry,
  result: EfficiencyResult,
): string[] {
  const skillFile = catalog.operators[entry.operator.name]?.skillFile;
  const chains = (skillFile?.chains ?? [])
    .map((chain, chainIndex) => ({ chain, chainIndex }))
    .filter(({ chain }) => chain.room === entry.facility);
  const activeStages = selectedStages(chains, entry.progression);
  const currentValue = targetEfficiency(result, entry);
  if (currentValue === undefined) return [];
  const notes = new Set<string>();
  activeStages.forEach(({ chainIndex, stageIndex, stage }) => {
    stage.effects.forEach((effect, effectIndex) => {
      if (!effect.condition) return;
      const nextCatalog = catalogWithoutEffectCondition(
        catalog,
        entry.operator.name,
        chainIndex,
        stageIndex,
        effectIndex,
      );
      const withoutCondition = calculateEfficiency(entry.schedule, {
        catalog: nextCatalog,
      });
      const nextValue = targetEfficiency(withoutCondition, entry);
      if (
        nextValue !== undefined &&
        Math.abs(nextValue - currentValue) <= 0.0001
      ) {
        return;
      }
      const reason = conditionDescription(effect.condition, catalog);
      if (reason) notes.add(reason);
    });
  });
  return [...notes];
}

function hasActiveCondition(
  catalog: EfficiencyCatalog,
  entry: EfficiencyRankingEntry,
): boolean {
  const skillFile = catalog.operators[entry.operator.name]?.skillFile;
  const chains = (skillFile?.chains ?? [])
    .map((chain, chainIndex) => ({ chain, chainIndex }))
    .filter(({ chain }) => chain.room === entry.facility);
  return selectedStages(chains, entry.progression).some(({ stage }) =>
    stage.effects.some((effect) => effect.condition !== undefined),
  );
}

function unmetGroupCountNotes(
  catalog: EfficiencyCatalog,
  entry: EfficiencyRankingEntry,
): string[] {
  const skillFile = catalog.operators[entry.operator.name]?.skillFile;
  const chains = (skillFile?.chains ?? [])
    .map((chain, chainIndex) => ({ chain, chainIndex }))
    .filter(({ chain }) => chain.room === entry.facility);
  const activeStages = selectedStages(chains, entry.progression);
  const plan = entry.schedule.plans[0];
  if (!plan) return [];
  const notes = new Set<string>();
  activeStages.forEach(({ stage }) => {
    stage.effects.forEach((effect) => {
      const per = effect.per;
      if (
        per?.source !== "opGroupInBase" ||
        !per.group ||
        per.cap === undefined
      ) {
        return;
      }
      const required = Math.ceil(Number(per.cap) * Number(per.per ?? 1));
      const count = entry.schedule.layout.reduce((total, layoutEntry) => {
        if (per.exclude?.includes(layoutEntry.type)) return total;
        const assignments = plan.rooms[layoutEntry.type];
        if (!Array.isArray(assignments)) return total;
        const roomIndex = entry.schedule.layout
          .slice(0, entry.schedule.layout.indexOf(layoutEntry))
          .filter((item) => item.type === layoutEntry.type).length;
        const assignment = (assignments as RoomAssignment[])[roomIndex];
        return (
          total +
          (assignment?.operators ?? []).filter(
            (name) =>
              name &&
              (!per.other || name !== entry.operator.name) &&
              groupIncludesOperator(catalog, per.group, name),
          ).length
        );
      }, 0);
      if (count < required) {
        const groupName = catalog.terms[per.group]?.name ?? per.group;
        notes.add(`需要额外${required - count}名${groupName}干员`);
      }
    });
  });
  return [...notes];
}

export function calculateEfficiencyRankingEntry(
  catalog: EfficiencyCatalog,
  entry: EfficiencyRankingEntry,
): EfficiencyRankingCalculationResult {
  const calculationCatalog = catalogForEfficiencyRankingEntry(catalog, entry);
  const result = calculateEfficiency(entry.schedule, {
    catalog: calculationCatalog,
  });
  const plan = result.plans[0];
  const mood = plan?.moods.find(
    (item) =>
      item.operator === entry.operator.name && item.facility === entry.facility,
  );
  const moodDetails =
    mood?.rateDetails.filter((detail) => detail.kind === "skill") ?? [];
  const efficiency = targetEfficiency(result, entry);
  const notes = new Set(
    [
      ...unmetConditionNotes(calculationCatalog, entry, result),
      ...unmetGroupCountNotes(calculationCatalog, entry),
    ].map((note) => `条件未满足：${note}`),
  );
  if (!entry.schedule.layout.some((item) => item.type === entry.facility)) {
    notes.add(`共享布局未配置${ROOM_LABELS[entry.facility]}`);
  }
  const staticNote = EFFICIENCY_RANKING_OPERATOR_NOTES[entry.operator.id];
  if (
    staticNote &&
    entry.facility === "power" &&
    (entry.operator.id === "char_4015_spuria" ||
      entry.operator.id === "char_249_mlyss" ||
      hasActiveCondition(calculationCatalog, entry))
  ) {
    notes.add(staticNote);
  }
  return {
    id: entry.id,
    efficiency,
    ...(moodDetails.length > 0
      ? {
          moodExtra: moodDetails.reduce(
            (total, detail) => total + detail.value,
            0,
          ),
        }
      : {}),
    notes: [...notes],
  };
}

export function cloneRoomsForLayout(
  rooms: Record<string, RoomAssignment[]>,
  layout: LayoutEntry[],
): Record<string, RoomAssignment[]> {
  const plan = { rooms: clone(rooms) };
  resizeRoomsForLayout(plan, layout);
  return plan.rooms as Record<string, RoomAssignment[]>;
}

export function emptyEfficiencyRankingSchedule(
  layout: LayoutEntry[],
  workHours: number,
  clueExchanging: boolean,
  treatSkillsAsUnlocked: boolean,
): ScheduleDocument {
  return {
    layout: clone(layout),
    plans: [
      {
        duration: Math.round(workHours * 60),
        rooms: roomsForLayout(layout),
      },
    ],
    settings: { clueExchanging, treatSkillsAsUnlocked },
  };
}

export function operatorStateForSchedule(
  schedule: ScheduleDocument | undefined,
  name: string,
  facility: RoomKey,
): OperatorState | undefined {
  const rooms = schedule?.plans[0]?.rooms[facility];
  if (!Array.isArray(rooms)) return undefined;
  for (const room of rooms as RoomAssignment[]) {
    const state = room.operatorStates?.[name];
    if (state) return state;
  }
  return undefined;
}
