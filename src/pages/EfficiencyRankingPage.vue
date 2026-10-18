<script setup lang="ts">
import { EditOutlined } from "@ant-design/icons-vue";
import { computed, h, onBeforeUnmount, onMounted, ref, watch } from "vue";

import type { OperatorPickerCandidateView } from "@/components/OperatorPickerPanel.vue";
import BasicCalculatorScheduleEditor from "@/components/BasicCalculatorScheduleEditor.vue";
import OperatorAvatarDisplay from "@/components/OperatorAvatarDisplay.vue";
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
  emptyEfficiencyRankingSchedule,
  EFFICIENCY_RANKING_FACILITIES,
  operatorStateForSchedule,
  type EfficiencyRankingCalculationResult,
  type EfficiencyRankingEntry,
  type EfficiencyRankingSettings,
} from "@/utils/efficiencyRanking";

const STORAGE_KEY = "riic-tools:efficiency-ranking:v1";

interface StoredEfficiencyRankingState {
  version: 1;
  settings: EfficiencyRankingSettings;
  layout: LayoutEntry[];
  rowRooms: Record<string, Record<string, RoomAssignment[]>>;
}

interface EfficiencyRankingRowView extends EfficiencyRankingEntry {
  result?: EfficiencyRankingCalculationResult;
}

interface EfficiencyRankingWorkerResponse {
  requestId: number;
  results?: Record<string, EfficiencyRankingCalculationResult>;
  error?: string;
}

interface EfficiencyRankingTableColumn {
  title: string;
  key: string;
  dataIndex?: string;
  width?: number;
  align?: "center";
  customCell?: (
    record: EfficiencyRankingRowView,
    index: number,
  ) => { rowSpan: number };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function readStoredState(): StoredEfficiencyRankingState {
  const defaults: StoredEfficiencyRankingState = {
    version: 1,
    settings: clone(DEFAULT_EFFICIENCY_RANKING_SETTINGS),
    layout: createDefaultEfficiencyRankingLayout(),
    rowRooms: {},
  };
  if (typeof window === "undefined") return defaults;
  try {
    const value: unknown = JSON.parse(
      window.localStorage.getItem(STORAGE_KEY) ?? "null",
    );
    if (!isRecord(value) || value.version !== 1) return defaults;
    const storedSettings = isRecord(value.settings) ? value.settings : {};
    const storedAvatar = isRecord(storedSettings.avatar)
      ? storedSettings.avatar
      : {};
    const workHours = Number(storedSettings.workHours);
    return {
      version: 1,
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
    };
  } catch {
    return defaults;
  }
}

const storedState = readStoredState();
const pageSettings = ref<EfficiencyRankingSettings>(storedState.settings);
const sharedLayout = ref<LayoutEntry[]>(storedState.layout);
const rowRooms = ref(storedState.rowRooms);
const activeFacility = ref<RoomKey>("power");
const layoutModalOpen = ref(false);
const rowModalOpen = ref(false);
const layoutDraftSchedule = ref<ScheduleDocument>();
const rowDraftSchedule = ref<ScheduleDocument>();
const rowDraftEntry = ref<Omit<EfficiencyRankingEntry, "schedule">>();
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
    pageSettings.value.treatSkillsAsUnlocked,
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

const facilityTabs = computed(() =>
  EFFICIENCY_RANKING_FACILITIES.map((facility) => ({
    ...facility,
    count: rowViews.value.filter((row) => row.facility === facility.key).length,
  })),
);

const visibleRows = computed(() =>
  rowViews.value
    .filter((row) => row.facility === activeFacility.value)
    .sort(compareRankingRows),
);

const rowDraftTitle = computed(() =>
  rowDraftEntry.value
    ? `编辑${rowDraftEntry.value.operator.name}${rowDraftEntry.value.progressionLabel}`
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

const tableColumns = computed(() => {
  const columns: EfficiencyRankingTableColumn[] = [
    { title: "编辑", key: "edit", width: 68, align: "center" },
  ];
  if (pageSettings.value.avatar.showAvatar) {
    columns.push({ title: "头像", key: "avatar", width: 78, align: "center" });
  }
  columns.push(
    { title: "干员名称", key: "name", dataIndex: "operator", width: 180 },
    {
      title: "效率",
      key: "efficiency",
      dataIndex: "result.efficiency",
      width: 130,
      align: "center",
      customCell: (_record: EfficiencyRankingRowView, index: number) => ({
        rowSpan: efficiencyCellRowSpan(index),
      }),
    },
    {
      title: "心情",
      key: "mood",
      dataIndex: "result.moodExtra",
      width: 115,
      align: "center",
    },
    { title: "备注", key: "notes", dataIndex: "result.notes", width: 320 },
  );
  return columns;
});

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
  const leftEfficiency = left.result?.efficiency;
  const rightEfficiency = right.result?.efficiency;
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
  const value = row.result?.efficiency;
  if (value === undefined) return "—";
  if (row.facility === "dormitory") {
    return `${formatNumber(value)}心情/小时`;
  }
  return `${formatEfficiencyNumber(value)}%`;
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
    version: 1,
    settings: clone(pageSettings.value),
    layout: clone(sharedLayout.value),
    rowRooms: clone(rowRooms.value),
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

function saveLayoutEditor(): void {
  const schedule = layoutDraftSchedule.value;
  if (!schedule) return;
  sharedLayout.value = clone(schedule.layout);
  normalizeSavedRooms(sharedLayout.value);
  layoutModalOpen.value = false;
}

function openRowEditor(row: EfficiencyRankingRowView): void {
  const entry = {
    id: row.id,
    facility: row.facility,
    operator: row.operator,
    progression: row.progression,
    progressionLabel: row.progressionLabel,
    sourceIndex: row.sourceIndex,
  };
  rowDraftEntry.value = entry;
  rowDraftSchedule.value = clone(row.schedule);
  rowModalOpen.value = true;
}

function saveRowEditor(): void {
  const entry = rowDraftEntry.value;
  const schedule = rowDraftSchedule.value;
  if (!entry || !schedule) return;
  sharedLayout.value = clone(schedule.layout);
  normalizeSavedRooms(sharedLayout.value);
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

function rowName(row: EfficiencyRankingRowView): string {
  return pageSettings.value.showOperatorProgressionInNames
    ? `${row.operator.name}${row.progressionLabel}`
    : row.operator.name;
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

function rowKey(row: EfficiencyRankingRowView): string {
  return row.id;
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
watch([pageSettings, sharedLayout, rowRooms], persistState, { deep: true });

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
    <a-card class="efficiency-ranking-heading">
      <div class="efficiency-ranking-heading-row">
        <div>
          <h1>效率排名</h1>
        </div>
        <a-button :icon="h(EditOutlined)" @click="openLayoutEditor">
          编辑布局
        </a-button>
      </div>
    </a-card>

    <a-card title="设置" class="efficiency-ranking-settings">
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
        <a-form-item label="效率单元格">
          <a-checkbox
            v-model:checked="pageSettings.mergeIdenticalEfficiencyCells"
          >
            合并相同效率单元格
          </a-checkbox>
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
        <a-spin :spinning="calculationLoading">
          <a-table
            :columns="tableColumns"
            :data-source="visibleRows"
            :pagination="false"
            :row-key="rowKey"
            :scroll="{ x: 'max-content' }"
            size="small"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'edit'">
                <a-button
                  aria-label="编辑排班"
                  size="small"
                  :icon="h(EditOutlined)"
                  @click="openRowEditor(record)"
                />
              </template>
              <OperatorAvatarDisplay
                v-else-if="column.key === 'avatar'"
                :display-name="record.operator.name"
                :elite-level="record.progression.elite"
                :operator="record.operator"
                :operator-owned="isOperatorOwned(record.operator.name)"
                :plain="true"
                :proportional-layout="true"
                :show-elite-level="pageSettings.avatar.showEliteLevel"
                :show-profession="pageSettings.avatar.showProfession"
                :show-rarity="pageSettings.avatar.showRarity"
                :size="54"
              />
              <span
                v-else-if="column.key === 'name'"
                class="efficiency-ranking-name"
              >
                {{ rowName(record) }}
              </span>
              <span
                v-else-if="column.key === 'efficiency'"
                class="efficiency-ranking-efficiency"
              >
                {{ efficiencyText(record) }}
              </span>
              <span
                v-else-if="column.key === 'mood'"
                :class="moodClass(record.result?.moodExtra)"
              >
                {{ moodText(record.result?.moodExtra) }}
              </span>
              <span
                v-else-if="column.key === 'notes'"
                class="efficiency-ranking-notes"
              >
                {{ record.result?.notes.join("；") || "" }}
              </span>
            </template>
            <template #emptyText>
              <span>没有符合条件的干员</span>
            </template>
          </a-table>
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
        :session-key="`efficiency-ranking:${rowDraftEntry.id}`"
        :fixed-operator="rowDraftFixedOperator"
        :operator-candidates="operatorCandidates"
        :operator-elite-level="operatorEliteLevel"
        :operator-progression="operatorProgression"
        :operator-for="operatorFor"
      />
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

.efficiency-ranking-heading-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.efficiency-ranking-heading h1 {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
}

.efficiency-ranking-settings :deep(.ant-form) {
  row-gap: 8px;
}

.efficiency-ranking-tabs {
  min-width: 0;
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

.efficiency-ranking-page :deep(.ant-table-cell) {
  vertical-align: middle;
}

.efficiency-ranking-page :deep(.ant-table-thead > tr > th) {
  white-space: nowrap;
}
</style>
