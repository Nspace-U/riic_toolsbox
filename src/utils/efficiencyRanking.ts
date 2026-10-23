import {
  calculateEfficiency,
  type CluePreference,
  type EfficiencyCatalog,
  type EfficiencyCondition,
  type EfficiencyEffect,
  type EfficiencyPer,
  type EfficiencyResult,
  type EfficiencySkillChain,
  type EfficiencySkillStage,
  type MoodRecoveryContribution,
  type OperatorProgressionProfile,
  facilityId,
  groupIncludesOperator,
} from "@arknights/riic-efficiency";
import specialRowsJson from "@/assets/efficiency-ranking-special-rows.json";

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
  meetingEfficiencyDisplay: "sum" | "average" | "both";
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
  meetingEfficiencyDisplay: "sum",
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
  meetingCategory?: "normal" | "independent" | "combo";
  basePointScenarios?: Record<string, string>;
  pairedOperators?: Array<{
    operator: Operator;
    progression: { elite: EliteLevel; level: number };
    progressionLabel: string;
  }>;
  dormitoryCategories?: DormitoryCategory[];
  schedule: ScheduleDocument;
}

export type DormitoryCategory =
  "shared" | "self" | "single" | "spread" | "specific";

interface EfficiencyRankingDormitoryRecoveryContribution {
  operator: string;
  skill?: string;
  value: number;
  distribution: DormitoryCategory;
}

interface EfficiencyRankingSupport {
  facility: RoomKey;
  name?: string;
  term?: string;
  scenarioTerm?: string;
  roomIndex?: number;
  count?: number;
  elite?: EliteLevel;
  level?: number;
  mood?: number;
}

interface EfficiencyRankingSpecialRow {
  unlock?: EfficiencySkillStage["unlock"];
  supports?: EfficiencyRankingSupport[];
}

const specialRows = specialRowsJson as Record<
  string,
  Partial<Record<RoomKey, EfficiencyRankingSpecialRow>>
>;

export interface EfficiencyRankingCalculationResult {
  id: string;
  efficiency?: number;
  dormitoryRecoveryByOperator: Record<string, MoodRecoveryContribution[]>;
  dormitoryRecoveryContributionsByOperator: Record<
    string,
    EfficiencyRankingDormitoryRecoveryContribution[]
  >;
  moodExtra?: number;
  operatorSkillEfficiencies: Record<string, number>;
  moodExtrasByOperator: Record<string, number>;
  cluePreferencesByOperator: Record<string, CluePreference[]>;
  notes: string[];
}

export interface EfficiencyRankingRowView extends EfficiencyRankingEntry {
  result?: EfficiencyRankingCalculationResult;
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

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function catalogForEfficiencyRankingEntry(
  catalog: EfficiencyCatalog,
  entry: EfficiencyRankingEntry,
): EfficiencyCatalog {
  let nextOperators = catalog.operators;
  let changed = false;
  rankingOperators(entry).forEach(({ operator: entryOperator }) => {
    const operator = nextOperators[entryOperator.name];
    const skillFile = operator?.skillFile;
    if (!operator || !skillFile) return;
    const scenarioTerm = entry.basePointScenarios?.[entryOperator.id];
    const correctPowerCondition =
      entry.facility === "power" &&
      ["char_4227_gallus", "char_4188_confes"].includes(entryOperator.id);
    if (!scenarioTerm && !correctPowerCondition) return;
    let operatorChanged = false;
    const chains = skillFile.chains.map((chain) => {
      if (
        scenarioTerm &&
        chain.room === entry.facility &&
        chain.stages.some((stage) =>
          stage.effects.some(
            (effect) =>
              effectAffectsRanking(effect, entry.facility) &&
              effect.per?.source === "basePoint" &&
              effect.per.term !== scenarioTerm,
          ),
        )
      ) {
        operatorChanged = true;
        return {
          ...chain,
          stages: chain.stages.map((stage) => ({
            ...stage,
            effects: stage.effects.filter(
              (effect) =>
                !(
                  effectAffectsRanking(effect, entry.facility) &&
                  effect.per?.source === "basePoint" &&
                  effect.per.term !== scenarioTerm
                ),
            ),
          })),
        };
      }
      if (!correctPowerCondition || chain.room !== "power") return chain;
      const stages = chain.stages.map((stage) => {
        let stageChanged = false;
        const effects = stage.effects.map((effect) => {
          const condition = effect.condition;
          if (
            condition?.type !== "opGroupInFacility" ||
            condition.facility !== "same" ||
            !condition.other
          ) {
            return effect;
          }
          stageChanged = true;
          operatorChanged = true;
          return {
            ...effect,
            condition: { ...condition, facility: "power" as const },
          };
        });
        return stageChanged ? { ...stage, effects } : stage;
      });
      return stages.some((stage, index) => stage !== chain.stages[index])
        ? { ...chain, stages }
        : chain;
    });
    if (!operatorChanged) return;
    changed = true;
    nextOperators = {
      ...nextOperators,
      [entryOperator.name]: {
        ...operator,
        skillFile: { ...skillFile, chains },
      },
    };
  });
  if (!changed) return catalog;
  return {
    ...catalog,
    operators: nextOperators,
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

function specialRowForProgression(
  entry: Omit<EfficiencyRankingEntry, "schedule">,
): EfficiencyRankingSpecialRow | undefined {
  const specialRow = specialRows[entry.operator.id]?.[entry.facility];
  if (!specialRow?.unlock) return specialRow;
  const minimumProgression = progressionFromUnlock(specialRow.unlock);
  return minimumProgression &&
    compareProgression(entry.progression, minimumProgression) >= 0
    ? specialRow
    : undefined;
}

function progressionLabel(
  progression: { elite: EliteLevel; level: number },
  skillFileHasLevelNode: boolean,
): string {
  const eliteLabel =
    progression.elite === 1 ? "Ⅰ" : progression.elite === 2 ? "Ⅱ" : "";
  return `${eliteLabel}${progression.elite === 0 && progression.level >= 30 && skillFileHasLevelNode ? "(Lv30)" : ""}`;
}

function maximumLevelForProgression(rarity: number, elite: number): number {
  if (rarity >= 6) return [50, 80, 90][elite] ?? 90;
  if (rarity === 5) return [50, 70, 80][elite] ?? 80;
  if (rarity === 4) return [45, 60, 70][elite] ?? 70;
  if (rarity === 3) return [40, 55][elite] ?? 55;
  return 30;
}

function progressionsForOperator(
  operator: Operator,
  catalog: EfficiencyCatalog,
  facility: RoomKey,
  includeWithoutSkills: boolean = false,
): Array<{
  progression: { elite: EliteLevel; level: number };
  progressionLabel: string;
}> {
  const skillFile = catalog.operators[operator.name]?.skillFile;
  const chains =
    skillFile?.chains.filter((chain) => chain.room === facility) ?? [];
  if (
    facility === "meeting" &&
    !includeWithoutSkills &&
    !chains.some((chain) =>
      chain.stages.some((stage) => stage.effects.length > 0),
    )
  ) {
    return [];
  }
  const progressions = new Map<string, { elite: EliteLevel; level: number }>();
  chains.forEach((chain) => {
    chain.stages.forEach((stage) => {
      if (stage.effects.length === 0) return;
      const progression = progressionFromUnlock(stage.unlock);
      if (!progression) return;
      const displayProgression =
        facility === "meeting" && progression.elite === 2
          ? {
              ...progression,
              level: maximumLevelForProgression(
                operator.rarity,
                progression.elite,
              ),
            }
          : progression;
      progressions.set(progressionKey(displayProgression), displayProgression);
    });
  });
  if (facility === "meeting") {
    const maxElite =
      operator.maxEliteLevel ??
      (operator.rarity >= 4 ? 2 : operator.rarity === 3 ? 1 : 0);
    for (let elite = 0; elite <= maxElite; elite += 1) {
      const progression = {
        elite: elite as EliteLevel,
        level: maximumLevelForProgression(operator.rarity, elite),
      };
      progressions.set(progressionKey(progression), progression);
    }
  }
  const allProgressions = [...progressions.values()].sort(compareProgression);
  const hasLevelNode = chains.some((chain) =>
    chain.stages.some((stage) => stage.unlock.type === "level"),
  );
  return allProgressions.map((progression) => ({
    progression,
    progressionLabel: progressionLabel(progression, hasLevelNode),
  }));
}

function meetingCategoryForOperator(
  operator: Operator,
  catalog: EfficiencyCatalog,
): "normal" | "independent" {
  const skillFile = catalog.operators[operator.name]?.skillFile;
  return skillFile?.chains.some(
    (chain) =>
      chain.room === "meeting" &&
      chain.stages.some((stage) =>
        stage.effects.some((effect) => effect.condition?.type === "onlySelf"),
      ),
  )
    ? "independent"
    : "normal";
}

export function dormitoryRecoveryDistributionForEffect(
  effect: Pick<
    MoodRecoveryContribution,
    "maxGroup" | "subjects" | "scope" | "op" | "moodBelow" | "scopeGroup"
  >,
): DormitoryCategory {
  if (
    effect.maxGroup === "dormRec-overall" ||
    effect.maxGroup === "dormRec-target"
  ) {
    return "shared";
  }
  if (effect.subjects === "single") return "single";
  if (effect.subjects === "spread") return "spread";
  if (effect.scope === "self") return "self";
  if (
    effect.scope === "op" ||
    effect.op !== undefined ||
    effect.moodBelow !== undefined ||
    effect.scopeGroup !== undefined
  ) {
    return "specific";
  }
  return "shared";
}

export function dormitoryRecoveryValueForCategory(
  contributions:
    readonly EfficiencyRankingDormitoryRecoveryContribution[] | undefined,
  category: DormitoryCategory,
): number | undefined {
  if (!contributions) return undefined;
  const matching = contributions.filter(
    (contribution) => contribution.distribution === category,
  );
  return matching.length > 0
    ? matching.reduce((total, contribution) => total + contribution.value, 0)
    : undefined;
}

export function dormitoryRecoveryEffectValueForCategory(
  effects: readonly MoodRecoveryContribution[] | undefined,
  category: DormitoryCategory,
): number | undefined {
  if (!effects) return undefined;
  const matching = effects.filter(
    (effect) => dormitoryRecoveryDistributionForEffect(effect) === category,
  );
  return matching.length > 0
    ? matching.reduce((total, effect) => total + effect.value, 0)
    : undefined;
}

function dormitoryCategoriesForEntry(
  operator: Operator,
  progression: { elite: EliteLevel; level: number },
  catalog: EfficiencyCatalog,
): DormitoryCategory[] {
  const skillFile = catalog.operators[operator.name]?.skillFile;
  const chains =
    skillFile?.chains.filter((chain) => chain.room === "dormitory") ?? [];
  const categories = new Set<DormitoryCategory>();
  selectedStages(
    chains.map((chain, chainIndex) => ({ chain, chainIndex })),
    progression,
  ).forEach(({ stage }) => {
    stage.effects.forEach((effect) => {
      if (effect.stat !== "moodRecover") return;
      const value = Number(effect.value ?? effect.baseValue);
      if (Number.isFinite(value) && value <= 0) return;
      categories.add(dormitoryRecoveryDistributionForEffect(effect));
    });
  });
  return [...categories];
}

function basePointTermsForOperator(
  operator: Operator,
  progression: { elite: EliteLevel; level: number },
  facility: RoomKey,
  catalog: EfficiencyCatalog,
): string[] {
  const chains = (catalog.operators[operator.name]?.skillFile?.chains ?? [])
    .map((chain, chainIndex) => ({ chain, chainIndex }))
    .filter(({ chain }) => chain.room === facility);
  const terms = new Set<string>();
  selectedStages(chains, progression).forEach(({ stage }) => {
    stage.effects.forEach((effect) => {
      if (
        effectAffectsRanking(effect, facility) &&
        effect.per?.source === "basePoint" &&
        effect.per.term
      ) {
        terms.add(effect.per.term);
      }
    });
  });
  return [...terms].sort();
}

function expandBasePointScenarios(
  entry: Omit<EfficiencyRankingEntry, "schedule">,
  catalog: EfficiencyCatalog,
): Omit<EfficiencyRankingEntry, "schedule">[] {
  const dimensions = [
    { operator: entry.operator, progression: entry.progression },
    ...(entry.pairedOperators ?? []).map(({ operator, progression }) => ({
      operator,
      progression,
    })),
  ]
    .map(({ operator, progression }) => ({
      operator,
      terms: basePointTermsForOperator(
        operator,
        progression,
        entry.facility,
        catalog,
      ),
    }))
    .filter(({ terms }) => terms.length > 1);
  if (!dimensions.length) return [entry];
  const scenarios = dimensions.reduce<Record<string, string>[]>(
    (current, { operator, terms }) =>
      current.flatMap((scenario) =>
        terms.map((term) => ({ ...scenario, [operator.id]: term })),
      ),
    [{}],
  );
  return scenarios.map((basePointScenarios) => ({
    ...entry,
    id: `${entry.id}:base-point:${Object.entries(basePointScenarios)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([id, term]) => `${id}=${term}`)
      .join(",")}`,
    basePointScenarios,
  }));
}

export function buildEfficiencyRankingEntries(
  operators: Operator[],
  catalog: EfficiencyCatalog,
): Omit<EfficiencyRankingEntry, "schedule">[] {
  const operatorIndexes = new Map(
    operators.map((operator, index) => [operator.name, index]),
  );
  const operatorByName = new Map(
    operators.map((operator) => [operator.name, operator]),
  );
  const entries: Omit<EfficiencyRankingEntry, "schedule">[] = [];
  const comboEntryIds = new Set<string>();
  EFFICIENCY_RANKING_FACILITIES.forEach(({ key: facility }) => {
    operators.forEach((operator, sourceIndex) => {
      const progressions = progressionsForOperator(operator, catalog, facility);
      progressions.forEach(({ progression, progressionLabel: suffix }) => {
        const entry: Omit<EfficiencyRankingEntry, "schedule"> = {
          id: `${facility}:${operator.id}:${progressionKey(progression)}`,
          facility,
          operator,
          progression,
          progressionLabel: suffix,
          sourceIndex: operatorIndexes.get(operator.name) ?? sourceIndex,
        };
        if (facility === "meeting") {
          entry.meetingCategory = meetingCategoryForOperator(operator, catalog);
        }
        if (facility === "dormitory") {
          entry.dormitoryCategories = dormitoryCategoriesForEntry(
            operator,
            progression,
            catalog,
          );
        }
        entries.push({
          ...entry,
        });
      });
    });
  });
  operators.forEach((leader) => {
    const leaderChains = (
      catalog.operators[leader.name]?.skillFile?.chains ?? []
    )
      .map((chain, chainIndex) => ({ chain, chainIndex }))
      .filter(({ chain }) => chain.room === "meeting");
    const leaderProgressions = progressionsForOperator(
      leader,
      catalog,
      "meeting",
    );
    leaderProgressions.forEach((leaderProgression) => {
      const explicitPartnerNames = new Set<string>();
      const groupPartnerNames = new Set<string>();
      selectedStages(leaderChains, leaderProgression.progression).forEach(
        ({ stage }) => {
          stage.effects.forEach((effect) => {
            if (
              effect.target !== "meeting" ||
              !["clueSpeed", "clueChance"].includes(effect.stat)
            )
              return;
            const condition = effect.condition;
            if (condition?.negate) return;
            if (
              condition?.type === "opAtFacility" &&
              (condition.facility === "meeting" ||
                condition.facility === "same") &&
              typeof condition.op === "string"
            ) {
              explicitPartnerNames.add(condition.op);
            }
            if (
              condition?.type === "opGroupInFacility" &&
              (condition.facility === "meeting" ||
                condition.facility === "same") &&
              condition.group
            ) {
              operators
                .filter((operator) =>
                  groupIncludesOperator(
                    catalog,
                    condition.group,
                    operator.name,
                  ),
                )
                .forEach((operator) => groupPartnerNames.add(operator.name));
            }
          });
        },
      );
      [...new Set([...explicitPartnerNames, ...groupPartnerNames])]
        .filter((name) => {
          const candidate = operatorByName.get(name);
          return (
            name !== leader.name &&
            Boolean(candidate) &&
            (explicitPartnerNames.has(name) ||
              progressionsForOperator(candidate!, catalog, "meeting").length >
                0)
          );
        })
        .map((name) => operatorByName.get(name))
        .filter((operator): operator is Operator => Boolean(operator))
        .forEach((candidate) => {
          const partnerProgressions = progressionsForOperator(
            candidate,
            catalog,
            "meeting",
            true,
          );
          partnerProgressions.forEach((partnerProgression) => {
            const members: Array<{
              operator: Operator;
              progression: { elite: EliteLevel; level: number };
              progressionLabel: string;
            }> = [
              {
                operator: leader,
                progression: leaderProgression.progression,
                progressionLabel: leaderProgression.progressionLabel,
              },
              {
                operator: candidate,
                progression: partnerProgression.progression,
                progressionLabel: partnerProgression.progressionLabel,
              },
            ].sort((left, right) =>
              left.operator.id.localeCompare(right.operator.id),
            );
            const primary = members[0]!;
            const paired = members[1]!;
            const id = `meeting:combo:${primary.operator.id}:${progressionKey(primary.progression)}:${paired.operator.id}:${progressionKey(paired.progression)}`;
            if (comboEntryIds.has(id)) return;
            comboEntryIds.add(id);
            entries.push({
              id,
              facility: "meeting",
              operator: primary.operator,
              progression: primary.progression,
              progressionLabel: primary.progressionLabel,
              sourceIndex: operatorIndexes.get(primary.operator.name) ?? 0,
              meetingCategory: "combo",
              pairedOperators: [
                {
                  operator: paired.operator,
                  progression: paired.progression,
                  progressionLabel: paired.progressionLabel,
                },
              ],
            });
          });
        });
    });
  });
  return entries.flatMap((entry) => expandBasePointScenarios(entry, catalog));
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
  options: { allowDuplicate?: boolean; roomIndex?: number } = {},
): RoomAssignment | undefined {
  const assignments = rooms[facility];
  if (!Array.isArray(assignments)) return undefined;
  if (
    !options.allowDuplicate &&
    (assignments as RoomAssignment[]).some((assignment) =>
      assignment.operators?.includes(name),
    )
  ) {
    return undefined;
  }
  const entries = layout.filter((entry) => entry.type === facility);
  for (const [index, assignment] of (
    assignments as RoomAssignment[]
  ).entries()) {
    if (options.roomIndex !== undefined && index !== options.roomIndex)
      continue;
    const capacity = roomSlotCount(facility, entries[index]?.level ?? 1);
    const operators = [...(assignment.operators ?? [])];
    const emptyIndex = operators.findIndex((operator) => !operator);
    if (emptyIndex >= 0) {
      operators[emptyIndex] = name;
      assignment.operators = operators;
      return assignment;
    }
    if (operators.length < capacity) {
      operators.push(name);
      assignment.operators = operators;
      return assignment;
    }
  }
  return undefined;
}

function placeDefaultSupports(
  entry: Omit<EfficiencyRankingEntry, "schedule">,
  rooms: Record<string, RoomAssignment[] | unknown>,
  layout: LayoutEntry[],
  catalog: EfficiencyCatalog,
): void {
  const defaults = specialRowForProgression(entry);
  (defaults?.supports ?? [])
    .filter(
      (support) =>
        !support.scenarioTerm ||
        support.scenarioTerm === entry.basePointScenarios?.[entry.operator.id],
    )
    .forEach((support) => {
      const name = support.name ?? catalog.terms[support.term ?? ""]?.name;
      if (!name) return;
      const count = Math.max(1, Math.floor(support.count ?? 1));
      for (let index = 0; index < count; index += 1) {
        const assignment = addOperatorToFacility(
          rooms,
          layout,
          support.facility,
          name,
          {
            allowDuplicate: Boolean(support.term),
            roomIndex: support.roomIndex,
          },
        );
        if (
          !assignment ||
          (support.elite === undefined &&
            support.level === undefined &&
            support.mood === undefined)
        )
          continue;
        assignment.operatorStates = {
          ...assignment.operatorStates,
          [name]: {
            ...assignment.operatorStates?.[name],
            ...(support.elite !== undefined ? { elite: support.elite } : {}),
            ...(support.level !== undefined ? { level: support.level } : {}),
            ...(support.mood !== undefined ? { mood: support.mood } : {}),
          },
        };
      }
    });
}

export function createEfficiencyRankingSchedule(
  entry: Omit<EfficiencyRankingEntry, "schedule">,
  options: EfficiencyRankingScheduleOptions,
): ScheduleDocument {
  const rooms = options.savedRooms
    ? clone(options.savedRooms)
    : roomsForLayout(options.layout);
  const plan = {
    name: [
      `${entry.operator.name}${entry.progressionLabel}`,
      ...(entry.pairedOperators ?? []).map(
        (item) => `${item.operator.name}${item.progressionLabel}`,
      ),
    ].join(" + "),
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
      if (!options.savedRooms && entry.pairedOperators?.length) {
        const names = targetAssignment.operators ?? [];
        entry.pairedOperators.forEach(({ operator, progression }) => {
          if (names.includes(operator.name) || names.length >= capacity) return;
          names.push(operator.name);
          targetAssignment.operatorStates = {
            ...targetAssignment.operatorStates,
            [operator.name]: {
              ...targetAssignment.operatorStates?.[operator.name],
              elite: progression.elite,
              level: progression.level,
            },
          };
        });
        targetAssignment.operators = names;
      }
    }
  }
  if (!options.savedRooms) {
    placeDefaultSupports(entry, plan.rooms, options.layout, options.catalog);
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

function rankingOperators(entry: EfficiencyRankingEntry): Array<{
  operator: Operator;
  progression: { elite: EliteLevel; level: number };
}> {
  return [
    { operator: entry.operator, progression: entry.progression },
    ...(entry.pairedOperators ?? []).map((item) => ({
      operator: item.operator,
      progression: item.progression,
    })),
  ];
}

function operatorIsAssigned(
  entry: EfficiencyRankingEntry,
  operatorName: string,
): boolean {
  const assignments = entry.schedule.plans[0]?.rooms[entry.facility];
  return (
    Array.isArray(assignments) &&
    (assignments as RoomAssignment[]).some((assignment) =>
      assignment.operators?.includes(operatorName),
    )
  );
}

function efficiencyDetailsForOperator(
  facility: EfficiencyResult["plans"][number]["facilities"][number],
  entry: EfficiencyRankingEntry,
  operatorName: string,
  includeOperatorTraining: boolean = true,
): number {
  return facility.details
    .filter(
      (detail) =>
        detail.operator === operatorName &&
        detail.facility === entry.facility &&
        (detail.ownerFacility ?? detail.facility) === entry.facility &&
        (includeOperatorTraining || detail.stat !== "operatorTraining") &&
        !["moodCost", "moodRecover", "clueChance"].includes(detail.stat),
    )
    .reduce((total, detail) => total + detail.value, 0);
}

function dormitoryRecoveryByOperator(
  result: EfficiencyResult,
  entry: EfficiencyRankingEntry,
): Record<string, MoodRecoveryContribution[]> {
  if (entry.facility !== "dormitory") return {};
  const plan = result.plans[0];
  if (!plan) return {};
  const dormitoryId = facilityId("dormitory", 0);
  return Object.fromEntries(
    rankingOperators(entry).map(({ operator }) => {
      const unique = new Map<string, MoodRecoveryContribution>();
      plan.moodRecoveryContributions
        .filter(
          (item) =>
            item.operator === operator.name &&
            item.facilityId === dormitoryId &&
            item.value > 0,
        )
        .forEach((item) => {
          unique.set(
            JSON.stringify([
              item.skill,
              item.scope,
              item.subjects,
              item.scopeGroup,
              item.value,
            ]),
            item,
          );
        });
      return [operator.name, [...unique.values()]];
    }),
  );
}

function dormitoryRecoveryContributionsByOperator(
  result: EfficiencyResult,
  entry: EfficiencyRankingEntry,
): Record<string, EfficiencyRankingDormitoryRecoveryContribution[]> {
  if (entry.facility !== "dormitory") return {};
  const recoveries = result.plans[0]?.dormitoryRecoveries ?? [];
  return Object.fromEntries(
    rankingOperators(entry).map(({ operator }) => {
      const unique = new Map<
        string,
        EfficiencyRankingDormitoryRecoveryContribution
      >();
      recoveries
        .flatMap((recovery) =>
          recovery.operators.flatMap((item) => item.contributions),
        )
        .filter((item) => item.operator === operator.name && item.value > 0)
        .forEach((item) => {
          unique.set(
            JSON.stringify([item.skill, item.distribution, item.value]),
            item,
          );
        });
      return [operator.name, [...unique.values()]];
    }),
  );
}

function targetEfficiency(
  result: EfficiencyResult,
  entry: EfficiencyRankingEntry,
): number | undefined {
  const plan = result.plans[0];
  if (!plan) return undefined;
  if (entry.facility === "dormitory") {
    const contributions =
      dormitoryRecoveryContributionsByOperator(result, entry)[
        entry.operator.name
      ] ?? [];
    return contributions.length > 0
      ? contributions.reduce((total, item) => total + item.value, 0)
      : undefined;
  }
  const facility = plan.facilities.find(
    (item) => item.facility.type === entry.facility,
  );
  if (!facility) return undefined;
  const contributors = rankingOperators(entry).filter(({ operator }) =>
    operatorIsAssigned(entry, operator.name),
  );
  return contributors.reduce(
    (total, { operator }) =>
      total + efficiencyDetailsForOperator(facility, entry, operator.name),
    0,
  );
}

function skillEfficiencyByOperator(
  result: EfficiencyResult,
  entry: EfficiencyRankingEntry,
): Record<string, number> {
  const facility = result.plans[0]?.facilities.find(
    (item) => item.facility.type === entry.facility,
  );
  if (!facility || entry.facility === "dormitory") return {};
  return Object.fromEntries(
    rankingOperators(entry)
      .filter(({ operator }) => operatorIsAssigned(entry, operator.name))
      .map(({ operator }) => [
        operator.name,
        efficiencyDetailsForOperator(facility, entry, operator.name, false),
      ]),
  );
}

function moodExtrasByOperator(
  result: EfficiencyResult,
  entry: EfficiencyRankingEntry,
): Record<string, number> {
  const plan = result.plans[0];
  if (!plan) return {};
  return Object.fromEntries(
    rankingOperators(entry).flatMap(({ operator }) => {
      const details = plan.moods.flatMap((mood) =>
        mood.rateDetails.filter(
          (detail) =>
            mood.facility === entry.facility &&
            detail.kind === "skill" &&
            detail.operator === operator.name,
        ),
      );
      return details.length > 0
        ? [
            [
              operator.name,
              details.reduce((total, detail) => total + detail.value, 0),
            ],
          ]
        : [];
    }),
  );
}

function cluePreferencesByOperator(
  entry: EfficiencyRankingEntry,
  result: EfficiencyResult,
): Record<string, CluePreference[]> {
  if (entry.facility !== "meeting") return {};
  const facility = result.plans[0]?.facilities.find(
    (item) => item.facility.type === "meeting",
  );
  if (!facility) return {};
  return Object.fromEntries(
    rankingOperators(entry).map(({ operator }) => [
      operator.name,
      facility.cluePreferencesByOperator?.[operator.name] ?? [],
    ]),
  );
}

function rankingResultValues(
  result: EfficiencyResult,
  entry: EfficiencyRankingEntry,
): Omit<EfficiencyRankingCalculationResult, "id" | "notes" | "moodExtra"> {
  return {
    efficiency: targetEfficiency(result, entry),
    dormitoryRecoveryByOperator: dormitoryRecoveryByOperator(result, entry),
    dormitoryRecoveryContributionsByOperator:
      dormitoryRecoveryContributionsByOperator(result, entry),
    operatorSkillEfficiencies: skillEfficiencyByOperator(result, entry),
    moodExtrasByOperator: moodExtrasByOperator(result, entry),
    cluePreferencesByOperator: cluePreferencesByOperator(entry, result),
  };
}

function rankingResultSignature(
  result: Omit<EfficiencyRankingCalculationResult, "id" | "notes">,
): string {
  return JSON.stringify([
    result.efficiency,
    Object.entries(result.operatorSkillEfficiencies)
      .filter(([, value]) => value !== 0)
      .sort(),
    Object.entries(result.moodExtrasByOperator)
      .filter(([, value]) => value !== 0)
      .sort(),
    Object.entries(result.cluePreferencesByOperator)
      .filter(([, values]) => values.length > 0)
      .map(([name, values]) => [name, [...new Set(values)].sort()])
      .sort(),
    Object.entries(result.dormitoryRecoveryByOperator)
      .filter(([, values]) => values.length > 0)
      .map(([name, values]) => [
        name,
        values
          .map((item) =>
            JSON.stringify([
              item.scope,
              item.subjects,
              item.scopeGroup,
              item.op,
              item.moodBelow,
              item.value,
            ]),
          )
          .sort(),
      ])
      .sort(),
    Object.entries(result.dormitoryRecoveryContributionsByOperator)
      .filter(([, contributions]) => contributions.length > 0)
      .map(([name, contributions]) => [
        name,
        contributions
          .map((item) =>
            JSON.stringify([item.skill, item.distribution, item.value]),
          )
          .sort(),
      ])
      .sort(),
  ]);
}

function progressionOrder(row: EfficiencyRankingRowView): number[] {
  return rankingOperators(row).flatMap(({ progression }) => [
    progression.elite,
    progression.level,
  ]);
}

function compareRowProgression(
  left: EfficiencyRankingRowView,
  right: EfficiencyRankingRowView,
): number {
  const leftProgression = progressionOrder(left);
  const rightProgression = progressionOrder(right);
  for (const offset of [0, 1]) {
    const difference =
      leftProgression
        .filter((_, index) => index % 2 === offset)
        .reduce((sum, value) => sum + value, 0) -
      rightProgression
        .filter((_, index) => index % 2 === offset)
        .reduce((sum, value) => sum + value, 0);
    if (difference !== 0) return difference;
  }
  for (let index = 0; index < leftProgression.length; index += 1) {
    const difference =
      (leftProgression[index] ?? 0) - (rightProgression[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

export function selectEfficiencyRankingRows(
  rows: EfficiencyRankingRowView[],
  treatSkillsAsUnlocked: boolean,
): EfficiencyRankingRowView[] {
  const groups = new Map<string, EfficiencyRankingRowView[]>();
  rows.forEach((row) => {
    const key = [
      row.facility,
      row.operator.id,
      row.meetingCategory ?? "",
      ...(row.pairedOperators ?? []).map((item) => item.operator.id),
      ...Object.entries(row.basePointScenarios ?? {})
        .sort(([left], [right]) => left.localeCompare(right))
        .flatMap(([operatorId, term]) => [operatorId, term]),
    ].join(":");
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  });
  const displayedIds = new Set<string>();
  groups.forEach((group) => {
    if (group.some((row) => !row.result)) {
      group.forEach((row) => displayedIds.add(row.id));
      return;
    }
    const ordered = [...group].sort(compareRowProgression);
    const highestSignature = rankingResultSignature(ordered.at(-1)!.result!);
    const signatures = new Set<string>();
    ordered.forEach((row) => {
      const signature = rankingResultSignature(row.result!);
      if (treatSkillsAsUnlocked && signature !== highestSignature) return;
      if (signatures.has(signature)) return;
      signatures.add(signature);
      displayedIds.add(row.id);
    });
  });
  return rows.filter((row) => displayedIds.has(row.id));
}

function effectAffectsRanking(
  effect: EfficiencyEffect,
  facility: RoomKey,
): boolean {
  return (
    (effect.target === facility ||
      effect.target === "any" ||
      Boolean(effect.facilities?.includes(facility))) &&
    [
      "droneCharge",
      "clueSpeed",
      "clueChance",
      "hireSpd",
      "recycleSpd",
      "moodCost",
      "moodRecover",
    ].includes(effect.stat)
  );
}

function effectIncludedInBasePointScenario(
  entry: Pick<EfficiencyRankingEntry, "basePointScenarios">,
  operator: Operator,
  effect: EfficiencyEffect,
): boolean {
  const term = entry.basePointScenarios?.[operator.id];
  return (
    !term ||
    effect.per?.source !== "basePoint" ||
    !effect.per.term ||
    effect.per.term === term
  );
}

function conditionProvidedByMeetingCombo(
  condition: EfficiencyCondition,
  entry: Omit<EfficiencyRankingEntry, "schedule">,
  ownerName: string,
  catalog: EfficiencyCatalog,
): boolean {
  if (
    entry.facility !== "meeting" ||
    entry.meetingCategory !== "combo" ||
    condition.negate ||
    !["same", "meeting"].includes(String(condition.facility))
  ) {
    return false;
  }
  const members = [
    entry.operator,
    ...(entry.pairedOperators ?? []).map((item) => item.operator),
  ];
  return members.some((operator) => {
    if (condition.other && operator.name === ownerName) return false;
    if (condition.type === "opAtFacility")
      return operator.name === condition.op;
    return (
      condition.type === "opGroupInFacility" &&
      Boolean(condition.group) &&
      groupIncludesOperator(catalog, condition.group!, operator.name)
    );
  });
}

export function defaultEfficiencyRankingNote(
  entry: Omit<EfficiencyRankingEntry, "schedule">,
  catalog: EfficiencyCatalog,
): string {
  const notes = new Set<string>();
  const operators = [
    { operator: entry.operator, progression: entry.progression },
    ...(entry.pairedOperators ?? []).map((item) => ({
      operator: item.operator,
      progression: item.progression,
    })),
  ];
  operators.forEach(({ operator, progression }) => {
    const chains = (catalog.operators[operator.name]?.skillFile?.chains ?? [])
      .map((chain, chainIndex) => ({ chain, chainIndex }))
      .filter(({ chain }) => chain.room === entry.facility);
    selectedStages(chains, progression).forEach(({ stage }) => {
      stage.effects.forEach((effect) => {
        if (
          !effectAffectsRanking(effect, entry.facility) ||
          !effectIncludedInBasePointScenario(entry, operator, effect)
        ) {
          return;
        }
        if (effect.condition) {
          const reason = conditionDescription(effect.condition, catalog);
          if (
            conditionProvidedByMeetingCombo(
              effect.condition,
              entry,
              operator.name,
              catalog,
            )
          ) {
            if (effect.condition.moodCheck) notes.add("联动干员心情需大于0");
            if (effect.condition.fullMood) notes.add("联动干员需满心情");
          } else {
            const recoveryType =
              entry.facility === "dormitory" && effect.stat === "moodRecover"
                ? `${dormitoryRecoveryLabel(
                    dormitoryRecoveryDistributionForEffect(effect),
                  )}条件：`
                : "";
            notes.add(`${recoveryType}${reason}`);
          }
        }
        const per = effect.per;
        if (per?.group) {
          const group = catalog.terms[per.group]?.name ?? per.group;
          const subject = `${per.other ? "除自身以外的" : ""}${group}干员`;
          const count = groupRequirementCount(per);
          if (per.source === "opGroupInBase") {
            notes.add(
              per.cap === undefined
                ? `基建内每${per.per}名${subject}提供增益`
                : `满额增益需要基建内有${count}名${subject}`,
            );
          }
          if (per.source === "baseFacilityWithGroup") {
            notes.add(
              per.cap === undefined
                ? `每${per.per}间有${subject}的设施提供增益`
                : `满额增益需要${count}间设施有${subject}`,
            );
          }
          if (per.source === "opGroupInFacility") {
            const facility =
              per.facility && per.facility !== "same"
                ? ROOM_LABELS[per.facility]
                : "同一设施";
            notes.add(`${facility}内每${per.per}名${subject}提供增益`);
          }
          if (per.moodCheck) notes.add("计数干员心情需大于0");
          if (per.fullMood) notes.add("计数干员需满心情");
          if (per.exclude?.length) {
            notes.add(
              `不计入${per.exclude.map((room) => ROOM_LABELS[room]).join("、")}`,
            );
          }
        }
        if (per?.source === "basePoint" && per.term) {
          notes.add(
            `增益取决于${catalog.terms[per.term]?.name ?? per.term}基建点`,
          );
        }
        if (
          effect.curve?.type === "ramp" &&
          Number.isFinite(effect.curve.startValue) &&
          Number.isFinite(effect.curve.cap) &&
          Number.isFinite(effect.curve.step) &&
          effect.curve.step > 0
        ) {
          const warmupHours = Math.ceil(
            (effect.curve.cap - effect.curve.startValue) / effect.curve.step,
          );
          if (warmupHours > 0) notes.add(`${warmupHours}小时暖机`);
        }
      });
    });
  });
  if (entry.facility !== "dormitory") return [...notes].join("\n");
  const chains = (
    catalog.operators[entry.operator.name]?.skillFile?.chains ?? []
  )
    .map((chain, chainIndex) => ({ chain, chainIndex }))
    .filter(({ chain }) => chain.room === "dormitory");
  selectedStages(chains, entry.progression).forEach(({ stage }) => {
    stage.effects.forEach((effect) => {
      if (effect.stat !== "moodRecover") return;
      const value = Number(effect.value ?? effect.baseValue ?? 0);
      const recoveryType = `${dormitoryRecoveryLabel(
        dormitoryRecoveryDistributionForEffect(effect),
      )}条件：`;
      const bonus = value ? `，恢复效果额外+${value}/小时` : "";
      if (effect.scopeGroup) {
        const group =
          catalog.terms[effect.scopeGroup]?.name ?? effect.scopeGroup;
        notes.add(`${recoveryType}目标需为${group}干员${bonus}`);
      }
      if (effect.moodBelow !== undefined) {
        notes.add(`${recoveryType}目标心情需低于${effect.moodBelow}${bonus}`);
      }
    });
  });
  return [...notes].join("\n");
}

export function dormitoryRecoveryLabel(
  distribution: DormitoryCategory,
): string {
  const labels: Record<DormitoryCategory, string> = {
    shared: "群体恢复",
    self: "自身恢复",
    single: "单体恢复",
    spread: "分摊恢复",
    specific: "特定恢复",
  };
  return labels[distribution];
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
      return "同设施不能有其他心情大于0的工作干员";
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

function groupRequirementCount(per: EfficiencyPer): number {
  const times =
    per.capUnit === "value"
      ? Number(per.cap ?? per.value) / Math.max(Number.EPSILON, per.value)
      : Number(per.cap ?? 1);
  return Math.ceil(times * per.per);
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
  const notes = new Set<string>();
  rankingOperators(entry).forEach(({ operator, progression }) => {
    const chains = (catalog.operators[operator.name]?.skillFile?.chains ?? [])
      .map((chain, chainIndex) => ({ chain, chainIndex }))
      .filter(({ chain }) => chain.room === entry.facility);
    const activeStages = selectedStages(chains, progression);
    activeStages.forEach(({ chainIndex, stageIndex, stage }) => {
      stage.effects.forEach((effect, effectIndex) => {
        if (
          !effect.condition ||
          !effectAffectsRanking(effect, entry.facility) ||
          !effectIncludedInBasePointScenario(entry, operator, effect)
        )
          return;
        const nextCatalog = catalogWithoutEffectCondition(
          catalog,
          operator.name,
          chainIndex,
          stageIndex,
          effectIndex,
        );
        const withoutCondition = calculateEfficiency(entry.schedule, {
          catalog: nextCatalog,
        });
        if (
          rankingResultSignature(
            rankingResultValues(withoutCondition, entry),
          ) === rankingResultSignature(rankingResultValues(result, entry))
        ) {
          return;
        }
        const reason = conditionDescription(effect.condition, catalog);
        if (reason) notes.add(reason);
      });
    });
  });
  return [...notes];
}

function unmetGroupCountNotes(
  catalog: EfficiencyCatalog,
  entry: EfficiencyRankingEntry,
  result: EfficiencyResult,
): string[] {
  const schedulePlan = entry.schedule.plans[0];
  const resultPlan = result.plans[0];
  if (!schedulePlan || !resultPlan) return [];
  const notes = new Set<string>();
  rankingOperators(entry).forEach(({ operator, progression }) => {
    const skillFile = catalog.operators[operator.name]?.skillFile;
    const chains = (skillFile?.chains ?? [])
      .map((chain, chainIndex) => ({ chain, chainIndex }))
      .filter(({ chain }) => chain.room === entry.facility);
    selectedStages(chains, progression).forEach(({ stage }) => {
      stage.effects.forEach((effect) => {
        if (
          !effectAffectsRanking(effect, entry.facility) ||
          !effectIncludedInBasePointScenario(entry, operator, effect)
        ) {
          return;
        }
        const per = effect.per;
        if (per?.source === "basePoint" && per.term) {
          if ((resultPlan.basePoints[per.term] ?? 0) <= 0) {
            const termName = catalog.terms[per.term]?.name ?? per.term;
            notes.add(`需要${termName}基建点`);
          }
          return;
        }
        if (
          !per?.group ||
          (per.source !== "opGroupInBase" &&
            per.source !== "baseFacilityWithGroup")
        ) {
          return;
        }
        const required = groupRequirementCount(per);
        const count = entry.schedule.layout.reduce(
          (total, layoutEntry, layoutIndex) => {
            if (per.exclude?.includes(layoutEntry.type)) return total;
            const roomIndex = entry.schedule.layout
              .slice(0, layoutIndex)
              .filter((item) => item.type === layoutEntry.type).length;
            const assignments = schedulePlan.rooms[layoutEntry.type];
            if (!Array.isArray(assignments)) return total;
            const assignment = (assignments as RoomAssignment[])[roomIndex];
            const matching = (assignment?.operators ?? []).filter(
              (name) =>
                name &&
                (!per.other || name !== operator.name) &&
                groupIncludesOperator(catalog, per.group, name),
            );
            return (
              total +
              (per.source === "baseFacilityWithGroup"
                ? Number(matching.length > 0)
                : matching.length)
            );
          },
          0,
        );
        if (count >= required) return;
        const groupName = catalog.terms[per.group]?.name ?? per.group;
        notes.add(
          per.source === "baseFacilityWithGroup"
            ? `需要${required}间设施有${groupName}干员，还差${required - count}间`
            : `需要额外${required - count}名${groupName}干员`,
        );
      });
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
  const values = rankingResultValues(result, entry);
  const moodValues = Object.values(values.moodExtrasByOperator);
  const notes = new Set(
    [
      ...unmetConditionNotes(calculationCatalog, entry, result),
      ...unmetGroupCountNotes(calculationCatalog, entry, result),
    ].map((note) => `条件未满足：${note}`),
  );
  if (!entry.schedule.layout.some((item) => item.type === entry.facility)) {
    notes.add(`共享布局未配置${ROOM_LABELS[entry.facility]}`);
  }
  return {
    id: entry.id,
    ...values,
    ...(moodValues.length > 0
      ? {
          moodExtra: moodValues.reduce((total, value) => total + value, 0),
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
