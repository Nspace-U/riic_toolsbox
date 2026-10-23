<script setup lang="ts">
import { EditOutlined, ReloadOutlined } from "@ant-design/icons-vue";
import { Modal } from "ant-design-vue";
import { computed, h, onBeforeUnmount, onMounted, ref, watch } from "vue";

import type { OperatorPickerCandidateView } from "@/components/OperatorPickerPanel.vue";
import BasicCalculatorScheduleEditor from "@/components/BasicCalculatorScheduleEditor.vue";
import OperatorAvatarDisplay from "@/components/OperatorAvatarDisplay.vue";
import OperatorSkillTooltip from "@/components/OperatorSkillTooltip.vue";
import { useBaseData } from "@/composables/useBaseData";
import { useOperatorProgression } from "@/composables/useOperatorProgression";
import type { EliteLevel, Operator } from "@/types/baseData";
import type {
  LayoutEntry,
  OperatorState,
  RoomAssignment,
  RoomKey,
  ScheduleDocument,
} from "@/types/schedule";
import {
  buildRecycleRules,
  getRiicEfficiencyCatalog,
} from "@/adapters/riicEfficiencyData";
import {
  progressionNodesForFacility,
  resolveOperatorProgression,
  type OperatorProgressionNode,
} from "@arknights/riic-efficiency";
import {
  formatEfficiencyNumber,
  formatNumber,
} from "@arknights/riic-efficiency";
import {
  cloneRoomsForLayout,
  createDefaultEfficiencyRankingLayout,
  createEfficiencyRankingSchedule,
  buildEfficiencyRankingEntries,
  DEFAULT_EFFICIENCY_RANKING_SETTINGS,
  defaultEfficiencyRankingNote,
  dormitoryRecoveryEffectValueForCategory,
  dormitoryRecoveryLabel,
  dormitoryRecoveryValueForCategory,
  emptyEfficiencyRankingSchedule,
  EFFICIENCY_RANKING_FACILITIES,
  operatorStateForSchedule,
  selectEfficiencyRankingRows,
  type EfficiencyRankingRowView,
  type EfficiencyRankingCalculationResult,
  type EfficiencyRankingEntry,
  type EfficiencyRankingSettings,
  type DormitoryCategory,
} from "@/utils/efficiencyRanking";

const STORAGE_KEY = "riic-tools:efficiency-ranking:v2";

interface StoredEfficiencyRankingState {
  version: 2;
  settings: EfficiencyRankingSettings;
  layout: LayoutEntry[];
  rowRooms: Record<string, Record<string, RoomAssignment[]>>;
  rowNotes: Record<string, string>;
}

interface EfficiencyRankingWorkerResponse {
  requestId: number;
  results?: Record<string, EfficiencyRankingCalculationResult>;
  error?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function readStoredState(): StoredEfficiencyRankingState {
  const defaults: StoredEfficiencyRankingState = {
    version: 2,
    settings: clone(DEFAULT_EFFICIENCY_RANKING_SETTINGS),
    layout: createDefaultEfficiencyRankingLayout(),
    rowRooms: {},
    rowNotes: {},
  };
  if (typeof window === "undefined") return defaults;
  try {
    const value: unknown = JSON.parse(
      window.localStorage.getItem(STORAGE_KEY) ?? "null",
    );
    if (!isRecord(value) || value.version !== 2) return defaults;
    const storedSettings = isRecord(value.settings) ? value.settings : {};
    const storedAvatar = isRecord(storedSettings.avatar)
      ? storedSettings.avatar
      : {};
    const workHours = Number(storedSettings.workHours);
    return {
      version: 2,
      settings: {
        ...defaults.settings,
        ...storedSettings,
        avatar: { ...defaults.settings.avatar, ...storedAvatar },
        workHours:
          Number.isFinite(workHours) && workHours > 0
            ? workHours
            : defaults.settings.workHours,
      } as EfficiencyRankingSettings,
      layout: Array.isArray(value.layout)
        ? (value.layout as LayoutEntry[])
        : defaults.layout,
      rowRooms: isRecord(value.rowRooms)
        ? (value.rowRooms as Record<string, Record<string, RoomAssignment[]>>)
        : {},
      rowNotes: isRecord(value.rowNotes)
        ? (value.rowNotes as Record<string, string>)
        : {},
    };
  } catch {
    return defaults;
  }
}

const storedState = readStoredState();
const pageSettings = ref<EfficiencyRankingSettings>(storedState.settings);
const sharedLayout = ref<LayoutEntry[]>(storedState.layout);
const rowRooms = ref(storedState.rowRooms);
const rowNotes = ref(storedState.rowNotes);
const activeFacility = ref<RoomKey>("power");
const activeMeetingCategory = ref<"normal" | "independent" | "combo">("normal");
const activeDormitoryCategory = ref<DormitoryCategory>("shared");
const layoutModalOpen = ref(false);
const rowModalOpen = ref(false);
const layoutDraftSchedule = ref<ScheduleDocument>();
const rowDraftSchedule = ref<ScheduleDocument>();
const rowDraftEntry = ref<Omit<EfficiencyRankingEntry, "schedule">>();
const rowDraftNote = ref("");
const rowCalculationResults = ref<
  Record<string, EfficiencyRankingCalculationResult>
>({});
const calculationError = ref("");
const calculationLoading = ref(true);
const { operators, itemTable, buildingData, ready, errorMessage } =
  useBaseData();
const { activeProfile, dormitoryDefaultIncludesMoodRecovery } =
  useOperatorProgression();
const recycleRules = computed(() =>
  buildRecycleRules(buildingData.value, itemTable.value),
);
const catalog = computed(() =>
  ready.value ? getRiicEfficiencyCatalog(recycleRules.value) : undefined,
);
const operatorByName = computed(
  () => new Map(operators.value.map((operator) => [operator.name, operator])),
);

const rankingEntries = computed<EfficiencyRankingEntry[]>(() => {
  const currentCatalog = catalog.value;
  if (!ready.value || !currentCatalog) return [];
  const definitions = buildEfficiencyRankingEntries(
    operators.value,
    currentCatalog,
  );
  return definitions.map((entry) => ({
    ...entry,
    schedule: createEfficiencyRankingSchedule(entry, {
      layout: sharedLayout.value,
      savedRooms: rowRooms.value[entry.id],
      workHours: pageSettings.value.workHours,
      clueExchanging: pageSettings.value.clueExchanging,
      treatSkillsAsUnlocked: pageSettings.value.treatSkillsAsUnlocked,
      progressionProfile: activeProfile.value,
      dormitoryDefaultIncludesMoodRecovery:
        dormitoryDefaultIncludesMoodRecovery.value,
      catalog: currentCatalog,
    }),
  }));
});

const rowViews = computed<EfficiencyRankingRowView[]>(() =>
  rankingEntries.value.map((entry) => ({
    ...entry,
    result: rowCalculationResults.value[entry.id],
  })),
);

function deduplicateProgressionRows(
  rows: EfficiencyRankingRowView[],
): EfficiencyRankingRowView[] {
  return selectEfficiencyRankingRows(
    rows,
    pageSettings.value.treatSkillsAsUnlocked,
  );
}

function rowsForDormitoryCategory(
  category: DormitoryCategory,
): EfficiencyRankingRowView[] {
  return deduplicateProgressionRows(
    rowViews.value.filter(
      (row) =>
        row.facility === "dormitory" &&
        row.dormitoryCategories?.includes(category),
    ),
  );
}

const displayedRowViews = computed<EfficiencyRankingRowView[]>(() => {
  const nonDormitoryRows = deduplicateProgressionRows(
    rowViews.value.filter((row) => row.facility !== "dormitory"),
  );
  const dormitoryRowIds = new Set(
    (["self", "shared", "spread", "single", "specific"] as const)
      .flatMap((category) => rowsForDormitoryCategory(category))
      .map((row) => row.id),
  );
  const displayedIds = new Set([
    ...nonDormitoryRows.map((row) => row.id),
    ...dormitoryRowIds,
  ]);
  return rowViews.value.filter((row) => displayedIds.has(row.id));
});

const facilityTabs = computed(() =>
  EFFICIENCY_RANKING_FACILITIES.map((facility) => ({
    ...facility,
    count: displayedRowViews.value.filter(
      (row) => row.facility === facility.key,
    ).length,
  })),
);

const meetingCategoryTabs = computed(() => [
  {
    key: "normal" as const,
    label: "普通干员",
    count: displayedRowViews.value.filter(
      (row) => row.facility === "meeting" && row.meetingCategory === "normal",
    ).length,
  },
  {
    key: "independent" as const,
    label: "独立干员",
    count: displayedRowViews.value.filter(
      (row) =>
        row.facility === "meeting" && row.meetingCategory === "independent",
    ).length,
  },
  {
    key: "combo" as const,
    label: "干员组合",
    count: displayedRowViews.value.filter(
      (row) => row.facility === "meeting" && row.meetingCategory === "combo",
    ).length,
  },
]);

const dormitoryCategoryTabs = computed(() =>
  [
    { key: "shared" as const, label: "群体恢复" },
    { key: "single" as const, label: "单体恢复" },
    { key: "spread" as const, label: "分摊恢复" },
    { key: "specific" as const, label: "特定恢复" },
    { key: "self" as const, label: "自身恢复" },
  ].map((category) => ({
    ...category,
    count: rowsForDormitoryCategory(category.key).length,
  })),
);

const visibleRows = computed(() =>
  deduplicateProgressionRows(
    rowViews.value
      .filter((row) => row.facility === activeFacility.value)
      .filter((row) =>
        activeFacility.value === "meeting"
          ? row.meetingCategory === activeMeetingCategory.value
          : activeFacility.value === "dormitory"
            ? row.dormitoryCategories?.includes(activeDormitoryCategory.value)
            : true,
      ),
  ).sort(compareRankingRows),
);

const rowDraftTitle = computed(() =>
  rowDraftEntry.value
    ? `编辑${rowNameForEntry(rowDraftEntry.value)}`
    : "编辑排班",
);

const rowDraftFixedOperator = computed(() => {
  const entry = rowDraftEntry.value;
  return entry
    ? { type: entry.facility, name: entry.operator.name }
    : undefined;
});

const candidates = computed(() =>
  [...operators.value]
    .map((operator, index) => ({ operator, index }))
    .sort(compareOperatorOrder)
    .map(({ operator }) => operator),
);

let worker: Worker | undefined;
let calculationRequestId = 0;

function compareOperatorOrder(
  left: { operator: Operator; index: number },
  right: { operator: Operator; index: number },
): number {
  const leftOrder = left.operator.implementationOrder;
  const rightOrder = right.operator.implementationOrder;
  if (leftOrder === undefined || rightOrder === undefined) {
    if (leftOrder === undefined && rightOrder === undefined) {
      return left.index - right.index;
    }
    return leftOrder === undefined ? -1 : 1;
  }
  return rightOrder - leftOrder || left.index - right.index;
}

function compareRankingRows(
  left: EfficiencyRankingRowView,
  right: EfficiencyRankingRowView,
): number {
  const leftEfficiency = rankingValue(left);
  const rightEfficiency = rankingValue(right);
  if (leftEfficiency === undefined || rightEfficiency === undefined) {
    if (leftEfficiency === undefined && rightEfficiency === undefined) {
      return compareImplementationOrder(left, right);
    }
    return leftEfficiency === undefined ? 1 : -1;
  }
  return (
    rightEfficiency - leftEfficiency || compareImplementationOrder(left, right)
  );
}

function rankingValue(row: EfficiencyRankingRowView): number | undefined {
  if (row.facility === "dormitory") {
    return dormitoryRecoveryValueForCategory(
      row.result?.dormitoryRecoveryContributionsByOperator[row.operator.name],
      activeDormitoryCategory.value,
    );
  }
  return row.result?.efficiency;
}

function compareImplementationOrder(
  left: EfficiencyRankingRowView,
  right: EfficiencyRankingRowView,
): number {
  const leftOrder = left.operator.implementationOrder;
  const rightOrder = right.operator.implementationOrder;
  if (leftOrder === undefined || rightOrder === undefined) {
    if (leftOrder === undefined && rightOrder === undefined) {
      return left.sourceIndex - right.sourceIndex;
    }
    return leftOrder === undefined ? -1 : 1;
  }
  return rightOrder - leftOrder || left.sourceIndex - right.sourceIndex;
}

function efficiencyText(row: EfficiencyRankingRowView): string {
  if (row.facility === "dormitory") {
    return dormitoryRecoveryText(row);
  }
  const value = row.result?.efficiency;
  if (value === undefined) return "—";
  if (row.meetingCategory === "combo") {
    const total = `${formatEfficiencyNumber(value)}%`;
    if (pageSettings.value.meetingEfficiencyDisplay === "sum") return total;
    const activeCount = [
      row.operator.name,
      ...(row.pairedOperators ?? []).map((item) => item.operator.name),
    ].filter((name) => isRowMemberAssigned(row, name)).length;
    const average = `${formatEfficiencyNumber(value / Math.max(1, activeCount))}%`;
    if (pageSettings.value.meetingEfficiencyDisplay === "average")
      return average;
    return `合计 ${total} / 平均 ${average}`;
  }
  return `${formatEfficiencyNumber(value)}%`;
}

function dormitoryRecoveryText(row: EfficiencyRankingRowView): string {
  const value = rankingValue(row);
  return value === undefined
    ? "—"
    : `${value > 0 ? "+" : ""}${formatNumber(value)}`;
}

function dormitoryAdditionalRecoveryNotes(
  row: EfficiencyRankingRowView,
): string[] {
  if (row.facility !== "dormitory") return [];
  const effects = row.result?.dormitoryRecoveryByOperator[row.operator.name];
  return (["shared", "spread", "single", "specific", "self"] as const)
    .filter((category) => category !== activeDormitoryCategory.value)
    .flatMap((category) => {
      const value = dormitoryRecoveryEffectValueForCategory(effects, category);
      return value === undefined
        ? []
        : [
            `${dormitoryRecoveryLabel(category)} ${value > 0 ? "+" : ""}${formatNumber(value)}`,
          ];
    });
}

function isRowMemberAssigned(
  row: EfficiencyRankingRowView,
  name: string,
): boolean {
  const assignments = row.schedule.plans[0]?.rooms[row.facility];
  return (
    Array.isArray(assignments) &&
    (assignments as RoomAssignment[]).some((assignment) =>
      assignment.operators?.includes(name),
    )
  );
}

function efficiencyCellRowSpan(index: number): number {
  if (!pageSettings.value.mergeIdenticalEfficiencyCells) return 1;
  const row = visibleRows.value[index];
  if (!row) return 1;
  const text = efficiencyText(row);
  if (index > 0 && efficiencyText(visibleRows.value[index - 1]!) === text) {
    return 0;
  }
  let span = 1;
  while (
    visibleRows.value[index + span] &&
    efficiencyText(visibleRows.value[index + span]!) === text
  ) {
    span += 1;
  }
  return span;
}

function updateWorkHours(value: number | null): void {
  if (value !== null && Number.isFinite(value) && value > 0) {
    pageSettings.value.workHours = value;
  }
}

function persistState(): void {
  if (typeof window === "undefined") return;
  const state: StoredEfficiencyRankingState = {
    version: 2,
    settings: clone(pageSettings.value),
    layout: clone(sharedLayout.value),
    rowRooms: clone(rowRooms.value),
    rowNotes: clone(rowNotes.value),
  };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function normalizeSavedRooms(layout: LayoutEntry[]): void {
  rowRooms.value = Object.fromEntries(
    Object.entries(rowRooms.value).map(([id, rooms]) => [
      id,
      cloneRoomsForLayout(rooms, layout),
    ]),
  );
}

function openLayoutEditor(): void {
  layoutDraftSchedule.value = emptyEfficiencyRankingSchedule(
    sharedLayout.value,
    pageSettings.value.workHours,
    pageSettings.value.clueExchanging,
    pageSettings.value.treatSkillsAsUnlocked,
  );
  layoutModalOpen.value = true;
}

function layoutPresetNeedsConfirmation(): boolean {
  return false;
}

function saveLayoutEditor(): void {
  const schedule = layoutDraftSchedule.value;
  if (!schedule) return;
  const losses = layoutLosses(schedule.layout);
  if (!losses.length) {
    applySharedLayout(schedule.layout);
    return;
  }
  Modal.confirm({
    title: "布局会移除排班干员",
    content: h("div", [
      h("p", "以下行中有干员会因布局变更而被移除："),
      h(
        "ul",
        losses.map((loss) =>
          h("li", `${loss.row}: ${loss.operators.join("、")}`),
        ),
      ),
    ]),
    okText: "继续应用",
    cancelText: "保留当前布局",
    onOk: () => applySharedLayout(schedule.layout),
    onCancel: () => {
      layoutModalOpen.value = false;
    },
  });
}

function layoutLosses(
  layout: LayoutEntry[],
): Array<{ row: string; operators: string[] }> {
  return rankingEntries.value.flatMap((entry) => {
    const source = entry.schedule.plans[0]?.rooms;
    if (!source) return [];
    const sourceRooms = source as Record<string, RoomAssignment[]>;
    const resized = cloneRoomsForLayout(sourceRooms, layout);
    const lost = new Set<string>();
    Object.entries(sourceRooms).forEach(([facility, rooms]) => {
      if (!Array.isArray(rooms)) return;
      const nextRooms = resized[facility];
      rooms.forEach((room, roomIndex) => {
        const retained = nextRooms?.[roomIndex]?.operators ?? [];
        (room.operators ?? []).forEach((name: string) => {
          if (name && !retained.includes(name)) lost.add(name);
        });
      });
    });
    return lost.size
      ? [{ row: rowNameForEntry(entry), operators: [...lost] }]
      : [];
  });
}

function applySharedLayout(layout: LayoutEntry[]): void {
  sharedLayout.value = clone(layout);
  normalizeSavedRooms(sharedLayout.value);
  layoutModalOpen.value = false;
}

function restorePageDefaults(): void {
  pageSettings.value = clone(DEFAULT_EFFICIENCY_RANKING_SETTINGS);
  sharedLayout.value = createDefaultEfficiencyRankingLayout();
  rowRooms.value = {};
  rowNotes.value = {};
}

function openRowEditor(row: EfficiencyRankingRowView): void {
  const entry = {
    id: row.id,
    facility: row.facility,
    operator: row.operator,
    progression: row.progression,
    progressionLabel: row.progressionLabel,
    sourceIndex: row.sourceIndex,
    meetingCategory: row.meetingCategory,
    pairedOperators: clone(row.pairedOperators ?? []),
    dormitoryCategories: clone(row.dormitoryCategories ?? []),
  };
  rowDraftEntry.value = entry;
  rowDraftSchedule.value = clone(row.schedule);
  rowDraftNote.value = Object.hasOwn(rowNotes.value, row.id)
    ? (rowNotes.value[row.id] ?? "")
    : defaultEfficiencyRankingNote(entry, catalog.value!);
  rowModalOpen.value = true;
}

function restoreRowDefault(): void {
  const entry = rowDraftEntry.value;
  const currentCatalog = catalog.value;
  if (!entry || !currentCatalog) return;
  rowDraftSchedule.value = createEfficiencyRankingSchedule(entry, {
    layout: sharedLayout.value,
    workHours: pageSettings.value.workHours,
    clueExchanging: pageSettings.value.clueExchanging,
    treatSkillsAsUnlocked: pageSettings.value.treatSkillsAsUnlocked,
    progressionProfile: activeProfile.value,
    dormitoryDefaultIncludesMoodRecovery:
      dormitoryDefaultIncludesMoodRecovery.value,
    catalog: currentCatalog,
  });
  rowDraftNote.value = defaultEfficiencyRankingNote(entry, currentCatalog);
}

function saveRowEditor(): void {
  const entry = rowDraftEntry.value;
  const schedule = rowDraftSchedule.value;
  if (!entry || !schedule) return;
  const planRooms = schedule.plans[0]?.rooms;
  if (planRooms && typeof planRooms === "object") {
    rowRooms.value = {
      ...rowRooms.value,
      [entry.id]: cloneRoomsForLayout(
        planRooms as Record<string, RoomAssignment[]>,
        sharedLayout.value,
      ),
    };
  }
  rowNotes.value = { ...rowNotes.value, [entry.id]: rowDraftNote.value };
  rowModalOpen.value = false;
}

function operatorFor(name: string): Operator | undefined {
  return operatorByName.value.get(name);
}

function operatorEliteLevel(name: string, type: RoomKey): EliteLevel {
  const operator = operatorFor(name);
  if (!operator) return 0;
  const schedule = rowDraftSchedule.value ?? layoutDraftSchedule.value;
  const state = operatorStateForSchedule(schedule, name, type);
  return resolveOperatorProgression({
    operatorId: operator.id,
    facility: type,
    operatorSkillFile: catalog.value?.operators[name]?.skillFile,
    maxEliteLevel: operator.maxEliteLevel,
    manualElite: state?.elite,
    manualLevel: state?.level,
    profile: activeProfile.value,
    treatSkillsAsUnlocked: pageSettings.value.treatSkillsAsUnlocked,
    dormitoryDefaultIncludesMoodRecovery:
      dormitoryDefaultIncludesMoodRecovery.value,
  }).elite;
}

function operatorCandidates(type: RoomKey): OperatorPickerCandidateView[] {
  return candidates.value.map((operator) => ({
    operator,
    eliteLevel: operatorEliteLevel(operator.name, type),
    operatorOwned: activeProfile.value?.entries[operator.id]?.owned !== false,
  }));
}

function rowNameForEntry(
  row: Omit<EfficiencyRankingEntry, "schedule">,
): string {
  const showProgression = pageSettings.value.showOperatorProgressionInNames;
  const name = `${row.operator.name}${showProgression ? row.progressionLabel : ""}`;
  return [
    name,
    ...(row.pairedOperators ?? []).map(
      (item) =>
        `${item.operator.name}${showProgression ? item.progressionLabel : ""}`,
    ),
  ].join(" + ");
}

function rowOperators(row: EfficiencyRankingRowView): Array<{
  operator: Operator;
  progression: { elite: EliteLevel; level: number };
  progressionLabel: string;
}> {
  return [
    {
      operator: row.operator,
      progression: row.progression,
      progressionLabel: row.progressionLabel,
    },
    ...(row.pairedOperators ?? []),
  ];
}

function skillEfficiencyText(row: EfficiencyRankingRowView): string {
  const values = row.result?.operatorSkillEfficiencies;
  if (!values) return "—";
  const members = [
    row.operator,
    ...(row.pairedOperators ?? []).map((item) => item.operator),
  ];
  const formatted = members.flatMap((operator) => {
    const value = values[operator.name];
    if (value === undefined || value === 0) return [];
    const text = `${formatEfficiencyNumber(value)}%`;
    return row.meetingCategory === "combo"
      ? [`${operator.name} ${text}`]
      : [text];
  });
  return formatted.join(" + ") || "—";
}

function cluePreferenceLabel(preference: number | "unowned" | "owned"): string {
  if (typeof preference === "number") return `线索${preference}`;
  return preference === "unowned" ? "尚未拥有" : "已经拥有";
}

function cluePreferenceLines(row: EfficiencyRankingRowView): string[] {
  const values = row.result?.cluePreferencesByOperator ?? {};
  const members = [
    row.operator,
    ...(row.pairedOperators ?? []).map((item) => item.operator),
  ];
  return members.flatMap((operator) => {
    const preferences = values[operator.name] ?? [];
    if (preferences.length === 0) return [];
    const text = [...new Set(preferences)].map(cluePreferenceLabel).join("、");
    return row.meetingCategory === "combo"
      ? [`${operator.name}：${text}`]
      : [text];
  });
}

function moodContributions(
  row: EfficiencyRankingRowView,
): Array<{ name: string; value: number }> {
  const values = row.result?.moodExtrasByOperator ?? {};
  return [
    row.operator,
    ...(row.pairedOperators ?? []).map((item) => item.operator),
  ].flatMap((operator) => {
    const value = values[operator.name];
    return value === undefined || value === 0
      ? []
      : [{ name: operator.name, value }];
  });
}

function notesText(row: EfficiencyRankingRowView): string {
  const manualNote = Object.hasOwn(rowNotes.value, row.id)
    ? rowNotes.value[row.id]
    : defaultEfficiencyRankingNote(row, catalog.value!);
  const resultNotes = row.result?.notes ?? [];
  const unmet = new Set(
    resultNotes.map((note) => note.replace(/^条件未满足：/, "")),
  );
  return [
    ...(manualNote ?? "").split("\n").filter((note) => !unmet.has(note)),
    ...dormitoryAdditionalRecoveryNotes(row),
    ...resultNotes,
  ]
    .filter((note, index, notes) => notes.indexOf(note) === index)
    .filter(Boolean)
    .join("\n");
}

function moodClass(value: number | undefined): string {
  if (value === undefined || value === 0) return "";
  return value > 0
    ? "efficiency-ranking-mood--positive"
    : "efficiency-ranking-mood--negative";
}

function moodText(value: number | undefined): string {
  if (value === undefined) return "";
  return `${value > 0 ? "+" : ""}${formatNumber(value)}`;
}

function isOperatorOwned(name: string): boolean {
  const operator = operatorFor(name);
  return !activeProfile.value || !operator
    ? true
    : activeProfile.value.entries[operator.id]?.owned !== false;
}

function activeOperatorProgression(
  name: string,
  type: RoomKey,
  state?: OperatorState,
): ReturnType<typeof resolveOperatorProgression> {
  const operator = operatorFor(name);
  return resolveOperatorProgression({
    operatorId: operator?.id ?? name,
    facility: type,
    operatorSkillFile: catalog.value?.operators[name]?.skillFile,
    maxEliteLevel: operator?.maxEliteLevel,
    manualElite: state?.elite,
    manualLevel: state?.level,
    profile: activeProfile.value,
    treatSkillsAsUnlocked: pageSettings.value.treatSkillsAsUnlocked,
    dormitoryDefaultIncludesMoodRecovery:
      dormitoryDefaultIncludesMoodRecovery.value,
  });
}

function operatorProgression(
  name: string,
  type: RoomKey,
  state: OperatorState,
):
  | {
      nodes: OperatorProgressionNode[];
      current: { elite: number; level: number };
      hasManualProgression: boolean;
    }
  | undefined {
  const operator = operatorFor(name);
  if (!operator) return undefined;
  const skillFile = catalog.value?.operators[name]?.skillFile;
  const progression = activeOperatorProgression(name, type, state);
  return {
    nodes: progressionNodesForFacility(skillFile, type, operator.rarity),
    current: { elite: progression.elite, level: progression.level },
    hasManualProgression:
      state.elite !== undefined || state.level !== undefined,
  };
}

function requestCalculations(): void {
  const currentWorker = worker;
  const currentCatalog = catalog.value;
  if (!currentWorker || !currentCatalog) return;
  const requestId = ++calculationRequestId;
  calculationLoading.value = true;
  calculationError.value = "";
  currentWorker.postMessage({
    type: "calculate",
    requestId,
    catalog: clone(currentCatalog),
    entries: clone(rankingEntries.value),
  });
}

const calculationFingerprint = computed(() =>
  JSON.stringify({
    ready: ready.value,
    catalog: Boolean(catalog.value),
    entries: rankingEntries.value.map((entry) => ({
      id: entry.id,
      schedule: entry.schedule,
    })),
  }),
);

watch(calculationFingerprint, () => requestCalculations(), { immediate: true });
watch([pageSettings, sharedLayout, rowRooms, rowNotes], persistState, {
  deep: true,
});

onMounted(() => {
  worker = new Worker(
    new URL("../workers/efficiencyRankingWorker.ts", import.meta.url),
    { type: "module" },
  );
  worker.onmessage = (event: MessageEvent<EfficiencyRankingWorkerResponse>) => {
    const response = event.data;
    if (response.requestId !== calculationRequestId) return;
    calculationLoading.value = false;
    if (response.error) {
      calculationError.value = response.error;
      return;
    }
    calculationError.value = "";
    rowCalculationResults.value = response.results ?? {};
  };
  worker.onerror = () => {
    calculationLoading.value = false;
    calculationError.value = "效率排名后台计算失败";
  };
  requestCalculations();
});

onBeforeUnmount(() => {
  worker?.terminate();
  worker = undefined;
});
</script>

<template>
  <div class="efficiency-ranking-page">
    <a-card
      :bordered="false"
      class="basic-calculator-header efficiency-ranking-heading"
    >
      <div class="basic-calculator-header-content">
        <div>
          <span class="page-kicker">RIIC EFFICIENCY</span>
          <h1>效率排名</h1>
        </div>
        <a-space wrap>
          <a-button :icon="h(EditOutlined)" @click="openLayoutEditor">
            编辑布局
          </a-button>
          <a-popconfirm
            cancel-text="取消"
            ok-text="恢复"
            title="恢复整页设置、布局和所有行内容？"
            @confirm="restorePageDefaults"
          >
            <a-button :icon="h(ReloadOutlined)">恢复默认</a-button>
          </a-popconfirm>
        </a-space>
      </div>
    </a-card>

    <a-card
      title="显示与排序"
      class="basic-calculator-settings efficiency-ranking-settings"
    >
      <a-form layout="inline">
        <a-form-item label="头像">
          <a-space wrap>
            <a-checkbox v-model:checked="pageSettings.avatar.showAvatar">
              显示头像
            </a-checkbox>
            <a-checkbox
              v-model:checked="pageSettings.avatar.showProfession"
              :disabled="!pageSettings.avatar.showAvatar"
            >
              职业
            </a-checkbox>
            <a-checkbox
              v-model:checked="pageSettings.avatar.showEliteLevel"
              :disabled="!pageSettings.avatar.showAvatar"
            >
              精英化
            </a-checkbox>
            <a-checkbox
              v-model:checked="pageSettings.avatar.showRarity"
              :disabled="!pageSettings.avatar.showAvatar"
            >
              星级
            </a-checkbox>
          </a-space>
        </a-form-item>
        <a-form-item label="干员名称">
          <a-checkbox
            v-model:checked="pageSettings.showOperatorProgressionInNames"
          >
            显示练度
          </a-checkbox>
        </a-form-item>
        <a-form-item label="效率显示">
          <a-checkbox
            v-model:checked="pageSettings.mergeIdenticalEfficiencyCells"
          >
            合并相同效率单元格
          </a-checkbox>
        </a-form-item>
        <a-form-item label="会客室组合效率">
          <a-radio-group v-model:value="pageSettings.meetingEfficiencyDisplay">
            <a-radio-button value="sum">合计</a-radio-button>
            <a-radio-button value="average">平均</a-radio-button>
            <a-radio-button value="both">两种</a-radio-button>
          </a-radio-group>
        </a-form-item>
        <a-form-item label="线索交流">
          <a-checkbox v-model:checked="pageSettings.clueExchanging">
            已开启
          </a-checkbox>
        </a-form-item>
        <a-form-item label="工作时长">
          <a-input-number
            :min="0.01"
            :precision="2"
            :step="0.5"
            :value="pageSettings.workHours"
            addon-after="小时"
            @update:value="updateWorkHours"
          />
        </a-form-item>
        <a-form-item label="基建技能">
          <a-checkbox v-model:checked="pageSettings.treatSkillsAsUnlocked">
            全部视为已解锁
          </a-checkbox>
        </a-form-item>
      </a-form>
    </a-card>

    <a-alert
      v-if="errorMessage || calculationError"
      :message="calculationError || errorMessage"
      show-icon
      type="error"
    />

    <a-tabs
      :active-key="activeFacility"
      class="efficiency-ranking-tabs"
      @change="activeFacility = $event as RoomKey"
    >
      <a-tab-pane
        v-for="facility in facilityTabs"
        :key="facility.key"
        :tab="`${facility.label}（${facility.count}）`"
      >
        <div
          v-if="facility.key === 'meeting'"
          class="efficiency-ranking-subtabs"
        >
          <a-radio-group v-model:value="activeMeetingCategory">
            <a-radio-button
              v-for="category in meetingCategoryTabs"
              :key="category.key"
              :value="category.key"
            >
              {{ category.label }}（{{ category.count }}）
            </a-radio-button>
          </a-radio-group>
        </div>
        <div
          v-if="facility.key === 'dormitory'"
          class="efficiency-ranking-subtabs"
        >
          <a-radio-group v-model:value="activeDormitoryCategory">
            <a-radio-button
              v-for="category in dormitoryCategoryTabs"
              :key="category.key"
              :value="category.key"
            >
              {{ category.label }}（{{ category.count }}）
            </a-radio-button>
          </a-radio-group>
        </div>
        <a-spin :spinning="calculationLoading">
          <a-empty
            v-if="visibleRows.length === 0"
            description="没有符合条件的干员"
          />
          <div v-else class="basic-calculator-table-wrap">
            <table class="basic-calculator-table efficiency-ranking-table">
              <thead>
                <tr>
                  <th class="basic-calculator-actions-column" scope="col">
                    编辑
                  </th>
                  <th v-if="pageSettings.avatar.showAvatar" scope="col">
                    头像
                  </th>
                  <th class="basic-calculator-name-cell" scope="col">
                    干员名称
                  </th>
                  <template v-if="activeFacility === 'meeting'">
                    <th scope="col">线索倾向</th>
                    <th scope="col">技能效率</th>
                  </template>
                  <th class="basic-calculator-efficiency-column" scope="col">
                    {{
                      activeFacility === "meeting"
                        ? "实际效率"
                        : activeFacility === "dormitory"
                          ? "恢复"
                          : "效率"
                    }}
                  </th>
                  <th scope="col">心情</th>
                  <th scope="col">备注</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(record, index) in visibleRows" :key="record.id">
                  <td class="basic-calculator-actions-column">
                    <div class="efficiency-ranking-row-actions">
                      <a-button
                        aria-label="编辑排班"
                        size="small"
                        type="text"
                        :icon="h(EditOutlined)"
                        @click="openRowEditor(record)"
                      />
                    </div>
                  </td>
                  <td v-if="pageSettings.avatar.showAvatar">
                    <div
                      class="basic-calculator-avatars efficiency-ranking-avatars"
                    >
                      <OperatorSkillTooltip
                        v-for="member in rowOperators(record)"
                        :key="member.operator.id"
                        :operator="member.operator"
                      >
                        <OperatorAvatarDisplay
                          :display-name="member.operator.name"
                          :elite-level="member.progression.elite"
                          :operator="member.operator"
                          :operator-owned="
                            isOperatorOwned(member.operator.name)
                          "
                          :plain="true"
                          :proportional-layout="true"
                          :show-elite-level="pageSettings.avatar.showEliteLevel"
                          :show-profession="pageSettings.avatar.showProfession"
                          :show-rarity="pageSettings.avatar.showRarity"
                          :size="record.meetingCategory === 'combo' ? 44 : 54"
                        />
                      </OperatorSkillTooltip>
                    </div>
                  </td>
                  <td
                    class="basic-calculator-name-cell efficiency-ranking-name"
                  >
                    <template
                      v-for="(member, memberIndex) in rowOperators(record)"
                      :key="member.operator.id"
                    >
                      <span v-if="memberIndex > 0"> + </span>
                      <OperatorSkillTooltip :operator="member.operator">
                        {{ member.operator.name
                        }}{{
                          pageSettings.showOperatorProgressionInNames
                            ? member.progressionLabel
                            : ""
                        }}
                      </OperatorSkillTooltip>
                    </template>
                  </td>
                  <template v-if="activeFacility === 'meeting'">
                    <td>
                      <div class="efficiency-ranking-member-lines">
                        <span
                          v-for="(line, lineIndex) in cluePreferenceLines(
                            record,
                          )"
                          :key="lineIndex"
                          >{{ line }}</span
                        >
                      </div>
                    </td>
                    <td class="basic-calculator-efficiency-value">
                      {{ skillEfficiencyText(record) }}
                    </td>
                  </template>
                  <td
                    v-if="efficiencyCellRowSpan(index) > 0"
                    class="basic-calculator-efficiency-column"
                    :rowspan="efficiencyCellRowSpan(index)"
                  >
                    <span class="basic-calculator-efficiency-value">
                      {{ efficiencyText(record) }}
                    </span>
                  </td>
                  <td>
                    <div class="efficiency-ranking-member-lines">
                      <template v-if="record.meetingCategory === 'combo'">
                        <span
                          v-for="item in moodContributions(record)"
                          :key="item.name"
                          :class="moodClass(item.value)"
                        >
                          {{ item.name }} {{ moodText(item.value) }}
                        </span>
                      </template>
                      <span v-else :class="moodClass(record.result?.moodExtra)">
                        {{ moodText(record.result?.moodExtra) }}
                      </span>
                    </div>
                  </td>
                  <td
                    class="basic-calculator-note-cell efficiency-ranking-notes"
                  >
                    {{ notesText(record) }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </a-spin>
      </a-tab-pane>
    </a-tabs>

    <a-modal
      :destroy-on-close="true"
      :open="layoutModalOpen"
      title="编辑共享布局"
      :width="1200"
      ok-text="保存"
      cancel-text="取消"
      @cancel="layoutModalOpen = false"
      @ok="saveLayoutEditor"
    >
      <BasicCalculatorScheduleEditor
        v-if="layoutDraftSchedule"
        v-model:model-value="layoutDraftSchedule"
        :layout-preset-will-remove-operators="layoutPresetNeedsConfirmation"
        :show-layout-presets="true"
        session-key="efficiency-ranking:shared-layout"
        :operator-candidates="operatorCandidates"
        :operator-elite-level="operatorEliteLevel"
        :operator-for="operatorFor"
      />
    </a-modal>

    <a-modal
      :destroy-on-close="true"
      :open="rowModalOpen"
      :title="rowDraftTitle"
      :width="1200"
      ok-text="保存"
      cancel-text="取消"
      @cancel="rowModalOpen = false"
      @ok="saveRowEditor"
    >
      <BasicCalculatorScheduleEditor
        v-if="rowDraftSchedule && rowDraftEntry"
        v-model:model-value="rowDraftSchedule"
        :hide-layout-editor="true"
        :session-key="`efficiency-ranking:${rowDraftEntry.id}`"
        :fixed-operator="rowDraftFixedOperator"
        :operator-candidates="operatorCandidates"
        :operator-elite-level="operatorEliteLevel"
        :operator-progression="operatorProgression"
        :operator-for="operatorFor"
      />
      <div v-if="rowDraftEntry" class="efficiency-ranking-row-editor-footer">
        <a-popconfirm
          cancel-text="取消"
          ok-text="恢复"
          title="恢复这名干员的默认排班和备注？"
          @confirm="restoreRowDefault"
        >
          <a-button :icon="h(ReloadOutlined)">恢复此行默认</a-button>
        </a-popconfirm>
      </div>
      <a-form v-if="rowDraftEntry" layout="vertical">
        <a-form-item label="备注">
          <a-textarea
            v-model:value="rowDraftNote"
            :auto-size="{ minRows: 2, maxRows: 8 }"
          />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<style scoped>
.efficiency-ranking-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}

.efficiency-ranking-heading h1 {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
}

.efficiency-ranking-settings :deep(.ant-form) {
  row-gap: 8px;
}

.efficiency-ranking-page :deep(.basic-calculator-header-content) {
  align-items: center;
  display: flex;
  gap: 12px;
  justify-content: space-between;
}

@media (max-width: 720px) {
  .efficiency-ranking-page :deep(.basic-calculator-header-content) {
    align-items: flex-start;
    flex-direction: column;
  }
}

.efficiency-ranking-page :deep(.page-kicker) {
  color: #216a66;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
}

.efficiency-ranking-page :deep(.basic-calculator-header h1) {
  margin-block: 4px;
}

.efficiency-ranking-tabs {
  min-width: 0;
}

.efficiency-ranking-subtabs {
  margin-block-end: 12px;
}

.efficiency-ranking-name {
  font-weight: 500;
}

.efficiency-ranking-efficiency {
  font-variant-numeric: tabular-nums;
}

.efficiency-ranking-mood--positive {
  color: #bb3737;
  font-variant-numeric: tabular-nums;
}

.efficiency-ranking-mood--negative {
  color: #287653;
  font-variant-numeric: tabular-nums;
}

.efficiency-ranking-notes {
  white-space: pre-wrap;
}

.efficiency-ranking-member-lines {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.efficiency-ranking-row-editor-footer {
  margin-block: 12px;
}

.efficiency-ranking-page :deep(.basic-calculator-table-wrap) {
  overflow-x: auto;
}

.efficiency-ranking-page :deep(.basic-calculator-table) {
  border-collapse: collapse;
  margin-inline: auto;
  table-layout: auto;
  width: max-content;
}

.efficiency-ranking-page :deep(.basic-calculator-table th),
.efficiency-ranking-page :deep(.basic-calculator-table td) {
  border-block-end: 1px solid rgba(46, 65, 61, 0.12);
  padding: 5px 6px;
  text-align: center;
  vertical-align: middle;
  white-space: nowrap;
}

.efficiency-ranking-page :deep(.basic-calculator-table th) {
  background: rgba(236, 242, 240, 0.9);
  color: #42534f;
  font-size: 12px;
  font-weight: 700;
  position: sticky;
  inset-block-start: 0;
  z-index: 1;
}

.efficiency-ranking-page :deep(.basic-calculator-efficiency-column) {
  min-inline-size: 104px;
}

.efficiency-ranking-page :deep(.basic-calculator-name-cell),
.efficiency-ranking-page :deep(.basic-calculator-note-cell) {
  text-align: start;
}

.efficiency-ranking-page :deep(.basic-calculator-note-cell) {
  white-space: pre;
}

.efficiency-ranking-page :deep(.basic-calculator-actions-column) {
  padding-inline: 4px;
}

.efficiency-ranking-row-actions {
  display: flex;
  justify-content: center;
  opacity: 0;
  transition: opacity 120ms ease;
}

.efficiency-ranking-page
  :deep(.basic-calculator-table tr:hover .efficiency-ranking-row-actions),
.efficiency-ranking-page
  :deep(
    .basic-calculator-table tr:focus-within .efficiency-ranking-row-actions
  ) {
  opacity: 1;
}

.efficiency-ranking-avatars {
  justify-content: center;
}
</style>
