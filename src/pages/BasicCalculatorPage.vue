<script setup lang="ts">
import {
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  ReloadOutlined,
  SettingOutlined,
} from "@ant-design/icons-vue";
import { computed, h, onMounted, ref, watch } from "vue";

import OperatorAvatarDisplay from "@/components/OperatorAvatarDisplay.vue";
import { useBaseData } from "@/composables/useBaseData";
import { useFacilityColors } from "@/composables/useFacilityColors";
import type { EliteLevel, Operator } from "@/types/baseData";
import type { EfficiencyCatalog } from "@/types/efficiency";
import { MANUFACTURE_RULES } from "@/utils/efficiency/baseRules";
import {
  applyBasicCalculatorPatch,
  basicCalculatorEfficiencyValue,
  cloneBasicCalculatorConfig,
  createBasicCalculatorPatch,
  evaluateBasicCalculatorRow,
  operatorFieldOptions,
  operatorFieldValues,
  sortBasicCalculatorColumns,
  visibleFacilityResultOf,
} from "@/utils/basicCalculator";
import type {
  BasicCalculatorAggregate,
  BasicCalculatorColumn,
  BasicCalculatorColumnKind,
  BasicCalculatorConfig,
  BasicCalculatorEfficiencyValue,
  BasicCalculatorEvaluation,
  BasicCalculatorGroup,
  BasicCalculatorOperator,
  BasicCalculatorPatch,
  BasicCalculatorRow,
} from "@/utils/basicCalculator";
import { loadEfficiencyCatalog } from "@/utils/efficiency/catalog";
import {
  formatEfficiencyNumber,
  formatNumber,
} from "@/utils/simulator/presentation";
import {
  PRODUCT_REPRESENTATIVE_COLORS,
  ROOM_LABELS,
  ROOM_REPRESENTATIVE_COLORS,
} from "@/utils/schedule";

interface BasicCalculatorRowView {
  group: BasicCalculatorGroup;
  row: BasicCalculatorRow;
  evaluations: Record<string, BasicCalculatorEvaluation>;
  efficiency: Record<string, BasicCalculatorEfficiencyValue>;
  numeric: Record<string, number | undefined>;
  backgroundColor?: string;
}

interface GroupDraft {
  id: string;
  name: string;
  facility: "trading" | "manufacture";
  facilityLevel: number;
  coreOperator: BasicCalculatorOperator;
  baselineEfficiency: number;
  columnIds: string[];
  rows: BasicCalculatorRow[];
}

const STORAGE_KEY = "riic-tools:basic-calculator:v1";
const { operators, terms, ready, errorMessage } = useBaseData();
const { facilityColors, productColors } = useFacilityColors();

const defaults = ref<BasicCalculatorConfig>();
const config = ref<BasicCalculatorConfig>();
const catalog = ref<EfficiencyCatalog>();
const loading = ref(true);
const loadError = ref("");
const activeGroupIds = ref<string[]>([]);
const columnModalOpen = ref(false);
const groupModalOpen = ref(false);
const rowModalOpen = ref(false);
const columnDraftKind = ref<BasicCalculatorColumnKind>("efficiency");
const columnDraftLabel = ref("");
const columnDraftHours = ref(12);
const columnDraftPath = ref("");
const columnDraftAggregate = ref<BasicCalculatorAggregate>("list");
const groupDraft = ref<GroupDraft>();
const rowDraft = ref<BasicCalculatorRow>();
const rowDraftGroupId = ref("");
const draftCoreName = ref("");
const draftOperatorNames = ref<string[]>([]);
const draftControlNames = ref<string[]>([]);

const operatorByName = computed(
  () => new Map(operators.value.map((operator) => [operator.name, operator])),
);
const operatorOptions = computed(() =>
  [...operators.value]
    .sort((first, second) => {
      const firstOrder = first.implementationOrder ?? -1;
      const secondOrder = second.implementationOrder ?? -1;
      return secondOrder - firstOrder;
    })
    .map((operator) => ({ label: operator.name, value: operator.name })),
);
const fieldOptions = computed(() =>
  catalog.value ? operatorFieldOptions(catalog.value) : [],
);
const productOptions = computed(() => [
  { label: "不限产物", value: "" },
  ...Object.keys(MANUFACTURE_RULES)
    .filter((key) => !key.includes(":"))
    .map((product) => ({ label: product, value: product })),
  { label: "龙门币", value: "龙门币" },
]);
const extraRoomOptions = Object.entries(ROOM_LABELS)
  .filter(([type]) => type !== "control")
  .map(([value, label]) => ({ value, label }));

function readStoredPatch(): BasicCalculatorPatch | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const value: unknown = JSON.parse(
      window.localStorage.getItem(STORAGE_KEY) ?? "null",
    );
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return undefined;
    }
    return value as BasicCalculatorPatch;
  } catch {
    return undefined;
  }
}

function persistConfig(): void {
  if (!defaults.value || !config.value || typeof window === "undefined") {
    return;
  }
  try {
    const patch = createBasicCalculatorPatch(defaults.value, config.value);
    if (Object.keys(patch).length === 1) {
      window.localStorage.removeItem(STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(patch));
  } catch {}
}

function updateConfig(update: (draft: BasicCalculatorConfig) => void): void {
  if (!config.value) return;
  const draft = cloneBasicCalculatorConfig(config.value);
  update(draft);
  config.value = draft;
  persistConfig();
}

async function loadResources(): Promise<void> {
  if (!ready.value || defaults.value) return;
  try {
    const [defaultResponse, nextCatalog] = await Promise.all([
      fetch(`${import.meta.env.BASE_URL}assets/basic-calculator.json`),
      loadEfficiencyCatalog(operators.value, terms.value),
    ]);
    if (!defaultResponse.ok) {
      throw new Error(
        `基础计算器配置读取失败（HTTP ${defaultResponse.status}）`,
      );
    }
    const nextDefaults =
      (await defaultResponse.json()) as BasicCalculatorConfig;
    defaults.value = nextDefaults;
    config.value = applyBasicCalculatorPatch(nextDefaults, readStoredPatch());
    catalog.value = nextCatalog;
    loadError.value = "";
  } catch (error: unknown) {
    loadError.value =
      error instanceof Error ? error.message : "基础计算器读取失败";
  } finally {
    loading.value = false;
  }
}

watch(ready, () => void loadResources(), { immediate: true });
onMounted(() => void loadResources());

function groupColumns(group: BasicCalculatorGroup): BasicCalculatorColumn[] {
  const columns = (config.value?.columns ?? []).filter(
    (column) => group.columnIds.includes(column.id) && column.visible !== false,
  );
  return sortBasicCalculatorColumns(columns);
}

function operatorNames(row: BasicCalculatorRow): string[] {
  return row.operators.map(({ name }) => name);
}

function evaluationFor(
  group: BasicCalculatorGroup,
  row: BasicCalculatorRow,
  hours: number,
): BasicCalculatorEvaluation | undefined {
  if (!catalog.value || !config.value) return undefined;
  return evaluateBasicCalculatorRow(
    catalog.value,
    group,
    row,
    hours,
    config.value.settings,
  );
}

function productAccent(
  group: BasicCalculatorGroup,
  row: BasicCalculatorRow,
): string | undefined {
  if (!row.product) return undefined;
  return (
    productColors.value[row.product as keyof typeof productColors.value] ??
    PRODUCT_REPRESENTATIVE_COLORS[row.product] ??
    facilityColors.value[group.facility] ??
    ROOM_REPRESENTATIVE_COLORS[group.facility]
  );
}

function aggregateValues(
  values: number[],
  aggregate: BasicCalculatorAggregate,
): number | undefined {
  if (values.length === 0) return undefined;
  if (aggregate === "sum")
    return values.reduce((total, value) => total + value, 0);
  if (aggregate === "max") return Math.max(...values);
  if (aggregate === "min") return Math.min(...values);
  return values[0];
}

function rowView(
  group: BasicCalculatorGroup,
  row: BasicCalculatorRow,
): BasicCalculatorRowView {
  const columns = groupColumns(group);
  const hours = new Set(
    columns
      .filter((column) => column.kind === "efficiency")
      .map((column) => column.hours ?? 24),
  );
  hours.add(24);
  const evaluations: Record<string, BasicCalculatorEvaluation> = {};
  const efficiency: Record<string, BasicCalculatorEfficiencyValue> = {};
  [...hours].forEach((duration) => {
    const evaluation = evaluationFor(group, row, duration);
    if (!evaluation) return;
    evaluations[String(duration)] = evaluation;
    efficiency[String(duration)] = basicCalculatorEfficiencyValue(
      evaluation,
      group,
    );
  });
  const facility = evaluations["24"]
    ? visibleFacilityResultOf(evaluations["24"])
    : undefined;
  const numeric: Record<string, number | undefined> = {};
  columns.forEach((column) => {
    if (column.kind === "storageDelta") {
      numeric[column.id] = facility?.attributes.storageCap?.skill ?? 0;
    } else if (column.kind === "orderDelta") {
      numeric[column.id] = facility?.attributes.orderLimit?.skill ?? 0;
    } else if (column.kind === "efficiency") {
      numeric[column.id] = efficiency[String(column.hours ?? 24)]?.second;
    } else if (column.kind === "operatorField" && catalog.value) {
      numeric[column.id] = aggregateValues(
        operatorFieldValues(
          catalog.value,
          [group.coreOperator.name, ...operatorNames(row)],
          column.path ?? "",
        ),
        column.aggregate ?? "list",
      );
    }
  });
  return {
    group,
    row,
    evaluations,
    efficiency,
    numeric,
    backgroundColor: productAccent(group, row),
  };
}

const rowsByGroup = computed<Record<string, BasicCalculatorRowView[]>>(() => {
  const result: Record<string, BasicCalculatorRowView[]> = {};
  (config.value?.groups ?? []).forEach((group) => {
    const views = group.rows.map((row) => rowView(group, row));
    const sortColumnId = config.value?.settings.sortColumnId ?? "";
    const direction = config.value?.settings.sortDirection === "asc" ? 1 : -1;
    views.sort((first, second) => {
      const firstValue = first.numeric[sortColumnId];
      const secondValue = second.numeric[sortColumnId];
      if (firstValue === undefined && secondValue === undefined) return 0;
      if (firstValue === undefined) return 1;
      if (secondValue === undefined) return -1;
      return (firstValue - secondValue) * direction;
    });
    result[group.id] = views;
  });
  return result;
});

function efficiencyText(
  value: BasicCalculatorEfficiencyValue | undefined,
): string {
  if (!value) return "—";
  const first = `${formatEfficiencyNumber(value.first)}%`;
  if (config.value?.settings.efficiencyDisplay === "first") return first;
  const second =
    value.second === undefined
      ? "—"
      : `${formatEfficiencyNumber(value.second)}%`;
  if (config.value?.settings.efficiencyDisplay === "second") return second;
  return `${first} / ${second}`;
}

function columnText(
  view: BasicCalculatorRowView,
  column: BasicCalculatorColumn,
): string {
  if (column.kind === "storageDelta" || column.kind === "orderDelta") {
    return formatNumber(view.numeric[column.id] ?? 0);
  }
  if (column.kind === "efficiency") {
    return efficiencyText(view.efficiency[String(column.hours ?? 24)]);
  }
  if (column.kind === "operatorField") {
    const values = catalog.value
      ? operatorFieldValues(
          catalog.value,
          [view.group.coreOperator.name, ...operatorNames(view.row)],
          column.path ?? "",
        )
      : [];
    if (values.length === 0) return "—";
    if ((column.aggregate ?? "list") === "list") {
      return values
        .map((value) => `${formatNumber(value)}${column.unit ?? ""}`)
        .join(" / ");
    }
    return `${formatNumber(view.numeric[column.id] ?? 0)}${column.unit ?? ""}`;
  }
  if (column.kind === "note") return view.row.note || "";
  return "";
}

function updateAvatarSetting(
  key: keyof BasicCalculatorConfig["settings"]["avatar"],
  value: boolean,
): void {
  updateConfig((draft) => {
    draft.settings.avatar[key] = value;
  });
}

function updateSetting<K extends keyof BasicCalculatorConfig["settings"]>(
  key: K,
  value: BasicCalculatorConfig["settings"][K],
): void {
  updateConfig((draft) => {
    draft.settings[key] = value;
  });
}

function updateColumnLabel(id: string, label: string): void {
  updateConfig((draft) => {
    const column = draft.columns.find((item) => item.id === id);
    if (column) column.label = label;
  });
}

function toggleColumn(id: string, visible: boolean): void {
  updateConfig((draft) => {
    const column = draft.columns.find((item) => item.id === id);
    if (column) column.visible = visible;
  });
}

function updateColumnHours(id: string, hours: number): void {
  updateConfig((draft) => {
    const column = draft.columns.find((item) => item.id === id);
    if (!column || column.kind !== "efficiency") return;
    column.hours = Math.max(0.01, hours);
    column.label = `${formatNumber(column.hours)}小时效率`;
  });
}

function updateColumnPath(id: string, path: string): void {
  updateConfig((draft) => {
    const column = draft.columns.find((item) => item.id === id);
    if (column?.kind === "operatorField") column.path = path;
  });
}

function updateColumnAggregate(
  id: string,
  aggregate: BasicCalculatorAggregate,
): void {
  updateConfig((draft) => {
    const column = draft.columns.find((item) => item.id === id);
    if (column?.kind === "operatorField") column.aggregate = aggregate;
  });
}

function removeColumn(id: string): void {
  updateConfig((draft) => {
    draft.columns = draft.columns.filter((column) => column.id !== id);
    draft.groups.forEach((group) => {
      group.columnIds = group.columnIds.filter((columnId) => columnId !== id);
    });
    if (draft.settings.sortColumnId === id)
      draft.settings.sortColumnId = "efficiency-24";
  });
}

function openColumnEditor(): void {
  columnDraftKind.value = "efficiency";
  columnDraftLabel.value = "";
  columnDraftHours.value = 12;
  columnDraftPath.value = fieldOptions.value[0]?.value ?? "";
  columnDraftAggregate.value = "list";
  columnModalOpen.value = true;
}

function saveColumn(): void {
  const id = `column-${Date.now().toString(36)}`;
  const column: BasicCalculatorColumn = {
    id,
    label:
      columnDraftLabel.value.trim() ||
      (columnDraftKind.value === "efficiency"
        ? `${formatNumber(columnDraftHours.value)}小时效率`
        : "自定义列"),
    kind: columnDraftKind.value,
    ...(columnDraftKind.value === "efficiency"
      ? { hours: Math.max(0.01, columnDraftHours.value), unit: "%" }
      : {}),
    ...(columnDraftKind.value === "operatorField"
      ? { path: columnDraftPath.value, aggregate: columnDraftAggregate.value }
      : {}),
  };
  updateConfig((draft) => {
    draft.columns.push(column);
    draft.groups.forEach((group) => group.columnIds.push(id));
  });
  columnModalOpen.value = false;
}

function openRowEditor(
  group: BasicCalculatorGroup,
  row: BasicCalculatorRow,
): void {
  rowDraftGroupId.value = group.id;
  rowDraft.value = JSON.parse(JSON.stringify(row)) as BasicCalculatorRow;
  rowDraft.value.coreOperator = row.coreOperator
    ? { ...row.coreOperator }
    : { ...group.coreOperator };
  draftCoreName.value = rowDraft.value.coreOperator.name;
  draftOperatorNames.value = rowDraft.value.operators.map(({ name }) => name);
  draftControlNames.value =
    row.controlOperators?.map(({ name }) => name) ??
    row.operators
      .filter((operator) => operator.room === "control")
      .map(({ name }) => name);
  rowModalOpen.value = true;
}

function setDraftOperators(names: string[]): void {
  if (!rowDraft.value) return;
  const old = new Map(
    rowDraft.value.operators.map((operator) => [operator.name, operator]),
  );
  rowDraft.value.operators = names.map((name) => ({
    ...(old.get(name) ?? { name }),
    name,
    room: draftControlNames.value.includes(name) ? "control" : undefined,
  }));
  draftOperatorNames.value = names;
}

function setDraftControlOperators(names: string[]): void {
  if (!rowDraft.value) return;
  const old = new Map(
    rowDraft.value.operators.map((operator) => [operator.name, operator]),
  );
  const visibleNames = new Set(draftOperatorNames.value);
  names.forEach((name) => visibleNames.add(name));
  rowDraft.value.operators = [...visibleNames].map((name) => ({
    ...(old.get(name) ?? { name }),
    name,
    room: names.includes(name) ? "control" : undefined,
  }));
  rowDraft.value.controlOperators = names.map((name) => ({
    ...(old.get(name) ?? { name }),
    name,
    room: "control",
  }));
  draftOperatorNames.value = [...visibleNames];
  draftControlNames.value = names;
}

function saveRow(): void {
  if (!rowDraft.value || !rowDraftGroupId.value) return;
  const draft = JSON.parse(
    JSON.stringify(rowDraft.value),
  ) as BasicCalculatorRow;
  draft.coreOperator = {
    ...(draft.coreOperator ?? { name: draftCoreName.value }),
    name: draftCoreName.value,
  };
  draft.operators = draft.operators.filter(
    ({ name }, index, list) =>
      name && list.findIndex((item) => item.name === name) === index,
  );
  updateConfig((next) => {
    const group = next.groups.find((item) => item.id === rowDraftGroupId.value);
    const row = group?.rows.find((item) => item.id === draft.id);
    if (row) Object.assign(row, draft);
  });
  rowModalOpen.value = false;
}

function deleteRow(groupId: string, rowId: string): void {
  updateConfig((draft) => {
    const group = draft.groups.find((item) => item.id === groupId);
    if (group) group.rows = group.rows.filter((row) => row.id !== rowId);
  });
}

function addRow(group: BasicCalculatorGroup): void {
  const row: BasicCalculatorRow = {
    id: `${group.id}-row-${Date.now().toString(36)}`,
    operators: [],
    coreOperator: { ...group.coreOperator },
  };
  updateConfig((draft) => {
    draft.groups.find((item) => item.id === group.id)?.rows.push(row);
  });
  openRowEditor(group, row);
}

function addExtraRoom(): void {
  if (!rowDraft.value) return;
  rowDraft.value.extraRooms = [
    ...(rowDraft.value.extraRooms ?? []),
    { type: "dormitory", level: 3, count: 1 },
  ];
}

function removeExtraRoom(index: number): void {
  if (!rowDraft.value?.extraRooms) return;
  rowDraft.value.extraRooms.splice(index, 1);
}

function openGroupEditor(group?: BasicCalculatorGroup): void {
  groupDraft.value = group
    ? (JSON.parse(JSON.stringify(group)) as GroupDraft)
    : {
        id: `group-${Date.now().toString(36)}`,
        name: "新组合组",
        facility: "manufacture",
        facilityLevel: 3,
        coreOperator: { name: operators.value[0]?.name ?? "红云", elite: 2 },
        baselineEfficiency: 0,
        columnIds: config.value?.groups[0]?.columnIds ?? [],
        rows: [],
      };
  groupModalOpen.value = true;
}

function saveGroup(): void {
  const draft = groupDraft.value;
  if (!draft || !draft.name.trim() || !draft.coreOperator.name) return;
  updateConfig((next) => {
    const index = next.groups.findIndex((group) => group.id === draft.id);
    const group = JSON.parse(JSON.stringify(draft)) as BasicCalculatorGroup;
    if (index >= 0) next.groups.splice(index, 1, group);
    else next.groups.push(group);
  });
  groupModalOpen.value = false;
}

function deleteGroup(groupId: string): void {
  updateConfig((draft) => {
    draft.groups = draft.groups.filter((group) => group.id !== groupId);
  });
}

function resetDefaults(): void {
  if (!defaults.value) return;
  config.value = cloneBasicCalculatorConfig(defaults.value);
  if (typeof window !== "undefined")
    window.localStorage.removeItem(STORAGE_KEY);
}

function operatorFor(name: string): Operator | undefined {
  return operatorByName.value.get(name);
}

function eliteLevel(value: number | undefined): EliteLevel {
  return value === 1 || value === 2 ? value : 0;
}

function rowBackgroundStyle(
  view: BasicCalculatorRowView,
): Record<string, string> {
  return view.backgroundColor
    ? {
        backgroundColor: `color-mix(in srgb, ${view.backgroundColor} 16%, white)`,
      }
    : {};
}

function isColumnSelected(group: BasicCalculatorGroup, id: string): boolean {
  return group.columnIds.includes(id);
}

function toggleGroupColumn(
  groupId: string,
  columnId: string,
  selected: boolean,
): void {
  updateConfig((draft) => {
    const group = draft.groups.find((item) => item.id === groupId);
    if (!group) return;
    group.columnIds = selected
      ? [...group.columnIds, columnId]
      : group.columnIds.filter((id) => id !== columnId);
  });
}
</script>

<template>
  <div class="basic-calculator-page">
    <a-alert
      v-if="errorMessage || loadError"
      :message="errorMessage || loadError"
      show-icon
      type="error"
    />
    <a-card :bordered="false" class="basic-calculator-header">
      <div class="basic-calculator-header-content">
        <div>
          <span class="page-kicker">RIIC EFFICIENCY</span>
          <h1>基建组合计算器</h1>
          <p>按组合、产物和工作时长比较基建技能效果。</p>
        </div>
        <a-space wrap>
          <a-button :icon="h(SettingOutlined)" @click="openColumnEditor"
            >列设置</a-button
          >
          <a-button
            :icon="h(PlusOutlined)"
            type="primary"
            @click="openGroupEditor"
            >新建组合组</a-button
          >
          <a-popconfirm
            cancel-text="取消"
            ok-text="恢复"
            title="恢复默认组合、列和页面设置？"
            @confirm="resetDefaults"
          >
            <a-button :icon="h(ReloadOutlined)">恢复默认</a-button>
          </a-popconfirm>
        </a-space>
      </div>
    </a-card>

    <a-card v-if="config" class="basic-calculator-settings" title="显示与排序">
      <a-form layout="inline">
        <a-form-item label="头像">
          <a-space wrap>
            <a-checkbox
              :checked="config.settings.avatar.showProfession"
              @change="
                updateAvatarSetting('showProfession', $event.target.checked)
              "
              >职业</a-checkbox
            >
            <a-checkbox
              :checked="config.settings.avatar.showEliteLevel"
              @change="
                updateAvatarSetting('showEliteLevel', $event.target.checked)
              "
              >精英化</a-checkbox
            >
            <a-checkbox
              :checked="config.settings.avatar.showRarity"
              @change="updateAvatarSetting('showRarity', $event.target.checked)"
              >星级</a-checkbox
            >
            <a-checkbox
              :checked="config.settings.avatar.showName"
              @change="updateAvatarSetting('showName', $event.target.checked)"
              >名称</a-checkbox
            >
          </a-space>
        </a-form-item>
        <a-form-item label="效率显示">
          <a-radio-group
            :value="config.settings.efficiencyDisplay"
            @change="updateSetting('efficiencyDisplay', $event.target.value)"
          >
            <a-radio-button value="first">方式一</a-radio-button>
            <a-radio-button value="second">方式二</a-radio-button>
            <a-radio-button value="both">两种</a-radio-button>
          </a-radio-group>
        </a-form-item>
        <a-form-item label="精0孑">
          <a-radio-group
            :value="config.settings.jieCalculation"
            @change="updateSetting('jieCalculation', $event.target.value)"
          >
            <a-radio-button value="max">最高效率</a-radio-button>
            <a-radio-button value="integral">积分平均</a-radio-button>
          </a-radio-group>
        </a-form-item>
        <a-form-item label="排序">
          <a-space>
            <a-select
              :value="config.settings.sortColumnId"
              style="min-width: 150px"
              @change="updateSetting('sortColumnId', $event)"
            >
              <a-select-option
                v-for="column in config.columns"
                :key="column.id"
                :value="column.id"
                >{{ column.label }}</a-select-option
              >
            </a-select>
            <a-radio-group
              :value="config.settings.sortDirection"
              @change="updateSetting('sortDirection', $event.target.value)"
            >
              <a-radio-button value="desc">降序</a-radio-button>
              <a-radio-button value="asc">升序</a-radio-button>
            </a-radio-group>
          </a-space>
        </a-form-item>
      </a-form>
    </a-card>

    <a-spin :spinning="loading">
      <a-collapse
        v-if="config"
        v-model:active-key="activeGroupIds"
        class="basic-calculator-groups"
      >
        <a-collapse-panel v-for="group in config.groups" :key="group.id">
          <template #header>
            <div class="basic-calculator-group-header">
              <strong>{{ group.name }}</strong>
              <span
                >{{ group.coreOperator.name }} ·
                {{ ROOM_LABELS[group.facility] }}</span
              >
              <span class="basic-calculator-group-header-actions" @click.stop>
                <a-button
                  :icon="h(EditOutlined)"
                  type="text"
                  @click="openGroupEditor(group)"
                />
                <a-popconfirm
                  cancel-text="取消"
                  ok-text="删除"
                  title="删除这个组合组？"
                  @confirm="deleteGroup(group.id)"
                >
                  <a-button :icon="h(DeleteOutlined)" danger type="text" />
                </a-popconfirm>
              </span>
            </div>
          </template>
          <div class="basic-calculator-group-toolbar">
            <span
              >核心：{{ group.coreOperator.name }} ·
              {{ group.facilityLevel }}级</span
            >
            <a-space wrap>
              <a-checkbox
                v-for="column in config.columns"
                :key="column.id"
                :checked="isColumnSelected(group, column.id)"
                @change="
                  toggleGroupColumn(group.id, column.id, $event.target.checked)
                "
                >{{ column.label }}</a-checkbox
              >
              <a-button
                :icon="h(PlusOutlined)"
                size="small"
                @click="addRow(group)"
                >添加行</a-button
              >
            </a-space>
          </div>
          <div class="basic-calculator-table-wrap">
            <table class="basic-calculator-table">
              <thead>
                <tr>
                  <th v-for="column in groupColumns(group)" :key="column.id">
                    {{ column.label }}
                  </th>
                  <th
                    aria-label="操作"
                    class="basic-calculator-actions-column"
                  />
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="view in rowsByGroup[group.id] ?? []"
                  :key="view.row.id"
                  :style="rowBackgroundStyle(view)"
                >
                  <td v-for="column in groupColumns(group)" :key="column.id">
                    <div
                      v-if="column.kind === 'operators'"
                      class="basic-calculator-avatars"
                    >
                      <OperatorAvatarDisplay
                        v-for="operator in view.row.operators.filter(
                          (item) =>
                            item.name !==
                            (view.row.coreOperator?.name ??
                              view.group.coreOperator.name),
                        )"
                        :key="`${view.row.id}-${operator.name}`"
                        :display-name="operator.name"
                        :elite-level="eliteLevel(operator.elite)"
                        :operator="operatorFor(operator.name)"
                        :plain="true"
                        :proportional-layout="true"
                        :show-elite-level="
                          config.settings.avatar.showEliteLevel
                        "
                        :show-name="config.settings.avatar.showName"
                        :show-profession="config.settings.avatar.showProfession"
                        :show-rarity="config.settings.avatar.showRarity"
                        :size="58"
                        :special-label="
                          operatorFor(operator.name)
                            ? undefined
                            : operator.name.slice(0, 2)
                        "
                      />
                    </div>
                    <span v-else>{{ columnText(view, column) }}</span>
                  </td>
                  <td class="basic-calculator-actions-column">
                    <div class="basic-calculator-row-actions">
                      <a-tooltip title="编辑"
                        ><a-button
                          :icon="h(EditOutlined)"
                          aria-label="编辑行"
                          size="small"
                          type="text"
                          @click="openRowEditor(group, view.row)"
                      /></a-tooltip>
                      <a-tooltip title="删除">
                        <a-popconfirm
                          cancel-text="取消"
                          ok-text="删除"
                          title="删除这一行？"
                          @confirm="deleteRow(group.id, view.row.id)"
                        >
                          <a-button
                            :icon="h(DeleteOutlined)"
                            aria-label="删除行"
                            danger
                            size="small"
                            type="text"
                          />
                        </a-popconfirm>
                      </a-tooltip>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </a-collapse-panel>
      </a-collapse>
    </a-spin>

    <a-modal
      :open="columnModalOpen"
      cancel-text="取消"
      ok-text="添加"
      title="列设置"
      width="760px"
      @cancel="columnModalOpen = false"
      @ok="saveColumn"
    >
      <div class="basic-calculator-column-list">
        <div
          v-for="column in config?.columns ?? []"
          :key="column.id"
          class="basic-calculator-column-row"
        >
          <a-checkbox
            :checked="column.visible !== false"
            @change="toggleColumn(column.id, $event.target.checked)"
          />
          <a-input
            :value="column.label"
            class="basic-calculator-column-label"
            @change="updateColumnLabel(column.id, $event.target.value)"
          />
          <a-input-number
            v-if="column.kind === 'efficiency'"
            :value="column.hours"
            :min="0.01"
            :step="0.01"
            addon-after="小时"
            @change="updateColumnHours(column.id, Number($event))"
          />
          <a-select
            v-if="column.kind === 'operatorField'"
            :value="column.path"
            style="min-width: 250px"
            @change="updateColumnPath(column.id, $event)"
          >
            <a-select-option
              v-for="option in fieldOptions"
              :key="option.value"
              :value="option.value"
              >{{ option.label }}</a-select-option
            >
          </a-select>
          <a-select
            v-if="column.kind === 'operatorField'"
            :value="column.aggregate ?? 'list'"
            @change="updateColumnAggregate(column.id, $event)"
          >
            <a-select-option value="list">分别显示</a-select-option>
            <a-select-option value="sum">合计</a-select-option>
            <a-select-option value="max">最大值</a-select-option>
            <a-select-option value="min">最小值</a-select-option>
          </a-select>
          <a-button
            :icon="h(DeleteOutlined)"
            aria-label="删除列"
            danger
            type="text"
            @click="removeColumn(column.id)"
          />
        </div>
      </div>
      <a-divider />
      <a-form layout="vertical">
        <a-form-item label="新列类型">
          <a-select v-model:value="columnDraftKind">
            <a-select-option value="efficiency">工作时间效率</a-select-option>
            <a-select-option value="operatorField"
              >干员 JSON 数值</a-select-option
            >
            <a-select-option value="storageDelta">仓库容量差值</a-select-option>
            <a-select-option value="orderDelta">订单上限差值</a-select-option>
            <a-select-option value="note">备注</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item label="列名称"
          ><a-input v-model:value="columnDraftLabel"
        /></a-form-item>
        <a-form-item v-if="columnDraftKind === 'efficiency'" label="工作时间"
          ><a-input-number
            v-model:value="columnDraftHours"
            :min="0.01"
            :step="0.01"
        /></a-form-item>
        <a-form-item
          v-if="columnDraftKind === 'operatorField'"
          label="JSON 数值字段"
        >
          <a-select v-model:value="columnDraftPath">
            <a-select-option
              v-for="option in fieldOptions"
              :key="option.value"
              :value="option.value"
              >{{ option.label }}</a-select-option
            >
          </a-select>
        </a-form-item>
        <a-form-item
          v-if="columnDraftKind === 'operatorField'"
          label="多干员显示"
        >
          <a-radio-group v-model:value="columnDraftAggregate">
            <a-radio value="list">分别显示</a-radio
            ><a-radio value="sum">合计</a-radio
            ><a-radio value="max">最大值</a-radio
            ><a-radio value="min">最小值</a-radio>
          </a-radio-group>
        </a-form-item>
      </a-form>
    </a-modal>

    <a-modal
      :open="groupModalOpen"
      cancel-text="取消"
      ok-text="保存"
      title="组合组设置"
      @cancel="groupModalOpen = false"
      @ok="saveGroup"
    >
      <a-form v-if="groupDraft" layout="vertical">
        <a-form-item label="组合组名称"
          ><a-input v-model:value="groupDraft.name"
        /></a-form-item>
        <a-form-item label="核心干员">
          <a-select v-model:value="groupDraft.coreOperator.name" show-search>
            <a-select-option
              v-for="option in operatorOptions"
              :key="option.value"
              :value="option.value"
              >{{ option.label }}</a-select-option
            >
          </a-select>
        </a-form-item>
        <a-form-item label="工作设施">
          <a-select v-model:value="groupDraft.facility"
            ><a-select-option value="manufacture">制造站</a-select-option
            ><a-select-option value="trading">贸易站</a-select-option></a-select
          >
        </a-form-item>
        <a-form-item label="设施等级"
          ><a-input-number
            v-model:value="groupDraft.facilityLevel"
            :max="3"
            :min="1"
        /></a-form-item>
        <a-form-item label="核心干员单人基准效率"
          ><a-input-number
            v-model:value="groupDraft.baselineEfficiency"
            addon-after="%"
        /></a-form-item>
      </a-form>
    </a-modal>

    <a-modal
      :open="rowModalOpen"
      cancel-text="取消"
      ok-text="保存"
      title="组合行设置"
      width="760px"
      @cancel="rowModalOpen = false"
      @ok="saveRow"
    >
      <a-form v-if="rowDraft" layout="vertical">
        <a-form-item label="核心干员">
          <a-select v-model:value="draftCoreName" show-search>
            <a-select-option
              v-for="option in operatorOptions"
              :key="option.value"
              :value="option.value"
              >{{ option.label }}</a-select-option
            >
          </a-select>
        </a-form-item>
        <a-form-item label="展示干员">
          <a-select
            :value="draftOperatorNames"
            mode="multiple"
            show-search
            @change="setDraftOperators"
          >
            <a-select-option
              v-for="option in operatorOptions"
              :key="option.value"
              :value="option.value"
              >{{ option.label }}</a-select-option
            >
          </a-select>
        </a-form-item>
        <a-form-item label="控制中枢干员">
          <a-select
            :value="draftControlNames"
            mode="multiple"
            show-search
            @change="setDraftControlOperators"
          >
            <a-select-option
              v-for="option in operatorOptions"
              :key="option.value"
              :value="option.value"
              >{{ option.label }}</a-select-option
            >
          </a-select>
        </a-form-item>
        <a-form-item label="制造站产物">
          <a-select v-model:value="rowDraft.product" allow-clear
            ><a-select-option
              v-for="option in productOptions"
              :key="option.value"
              :value="option.value"
              >{{ option.label }}</a-select-option
            ></a-select
          >
        </a-form-item>
        <a-form-item label="备注"
          ><a-input v-model:value="rowDraft.note"
        /></a-form-item>
        <div class="basic-calculator-extra-rooms-heading">
          <span>其他设施</span
          ><a-button :icon="h(PlusOutlined)" size="small" @click="addExtraRoom"
            >添加设施</a-button
          >
        </div>
        <div
          v-for="(room, index) in rowDraft.extraRooms ?? []"
          :key="`${room.type}-${index}`"
          class="basic-calculator-extra-room-row"
        >
          <a-select
            v-model:value="room.type"
            :options="extraRoomOptions"
          /><a-input-number
            v-model:value="room.level"
            :max="3"
            :min="1"
          /><a-input-number
            v-model:value="room.count"
            :max="4"
            :min="1"
          /><a-select
            v-model:value="room.product"
            allow-clear
            :options="productOptions"
          /><a-button
            :icon="h(DeleteOutlined)"
            aria-label="删除设施"
            danger
            type="text"
            @click="removeExtraRoom(index)"
          />
        </div>
      </a-form>
    </a-modal>
  </div>
</template>

<style scoped>
.basic-calculator-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}
.basic-calculator-header-content,
.basic-calculator-group-header,
.basic-calculator-group-toolbar,
.basic-calculator-extra-rooms-heading {
  align-items: center;
  display: flex;
  gap: 12px;
  justify-content: space-between;
}
.basic-calculator-header h1 {
  margin-block: 4px;
}
.basic-calculator-header p {
  color: #697876;
  margin: 0;
}
.page-kicker {
  color: #216a66;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
}
.basic-calculator-group-header {
  justify-content: flex-start;
  min-width: 0;
}
.basic-calculator-group-header
  > span:not(.basic-calculator-group-header-actions) {
  color: #6d7c79;
  font-size: 12px;
}
.basic-calculator-group-header-actions {
  margin-inline-start: auto;
}
.basic-calculator-group-toolbar {
  align-items: flex-start;
  flex-wrap: wrap;
  margin-block-end: 12px;
}
.basic-calculator-table-wrap {
  overflow-x: auto;
}
.basic-calculator-table {
  border-collapse: collapse;
  min-width: 980px;
  table-layout: auto;
  width: 100%;
}
.basic-calculator-table th,
.basic-calculator-table td {
  border-block-end: 1px solid rgba(46, 65, 61, 0.12);
  padding: 7px 10px;
  text-align: center;
  vertical-align: middle;
  white-space: nowrap;
}
.basic-calculator-table th {
  background: rgba(236, 242, 240, 0.9);
  color: #42534f;
  font-size: 12px;
  font-weight: 700;
  position: sticky;
  inset-block-start: 0;
  z-index: 1;
}
.basic-calculator-table th:first-child,
.basic-calculator-table td:first-child {
  min-width: 220px;
  text-align: start;
}
.basic-calculator-avatars {
  align-items: flex-end;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.basic-calculator-actions-column {
  min-width: 64px;
  padding-inline: 4px !important;
  width: 64px;
}
.basic-calculator-row-actions {
  display: flex;
  gap: 2px;
  justify-content: center;
  opacity: 0;
  transition: opacity 120ms ease;
}
.basic-calculator-table tr:hover .basic-calculator-row-actions,
.basic-calculator-table tr:focus-within .basic-calculator-row-actions {
  opacity: 1;
}
.basic-calculator-column-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.basic-calculator-column-row {
  align-items: center;
  display: flex;
  gap: 8px;
}
.basic-calculator-column-label {
  flex: 1;
  min-width: 120px;
}
.basic-calculator-extra-room-row {
  align-items: center;
  display: grid;
  gap: 8px;
  grid-template-columns: minmax(120px, 1fr) 90px 90px minmax(150px, 1fr) 32px;
  margin-block-start: 8px;
}
@media (max-width: 720px) {
  .basic-calculator-header-content {
    align-items: flex-start;
    flex-direction: column;
  }
  .basic-calculator-extra-room-row {
    grid-template-columns: 1fr 80px 80px 1fr 32px;
  }
}
</style>
