<script setup lang="ts">
import { DeleteOutlined, QuestionCircleOutlined } from "@ant-design/icons-vue";
import { computed, onBeforeUnmount, ref, watch } from "vue";

import type { LayoutEntry, RoomAssignment, RoomKey } from "@/types/schedule";
import {
  DEFAULT_SOURCE_MATERIAL,
  LAYOUT_TEXT_ROWS,
  PRODUCT_OPTIONS,
  SOURCE_MATERIAL_OPTIONS,
  ROOM_LABELS,
  ROOM_DISPLAY_ORDER,
  ROOM_REPRESENTATIVE_COLORS,
  canAddLayoutEntry,
  isFixedLevelRoom,
  orderedLayoutEntries,
  roomLevelRange,
} from "@/utils/schedule";
import {
  LAYOUT_PRESETS,
  cascadeLayoutTypes,
  layoutAdditionPlan,
  layoutEntryLevelMax,
  layoutTextFor,
  type LayoutPreset,
} from "@/utils/simulator/layout";

const props = withDefaults(
  defineProps<{
    layout: LayoutEntry[];
    fixedRoomTypes?: RoomKey[];
    deleteDisabledRoomTypes?: RoomKey[];
    fixedRoomLevels?: Partial<Record<RoomKey, number>>;
    facilityColors?: Partial<Record<RoomKey, string>>;
    error?: string;
    showLayoutPresets?: boolean;
    layoutPresetWillRemoveOperators?: (preset: LayoutPreset) => boolean;
    layoutTextHelp?: string;
    readOnlyLayout?: boolean;
    inheritProducts?: boolean;
    inheritLabel?: string;
    productRooms?: (type: RoomKey, position: number) => RoomAssignment[];
    defaultRoom?: (
      type: RoomKey,
      position: number,
    ) => RoomAssignment | undefined;
  }>(),
  {
    fixedRoomTypes: () => [],
    deleteDisabledRoomTypes: () => [],
    fixedRoomLevels: () => ({}),
    facilityColors: () => ({}),
    error: "",
    showLayoutPresets: false,
    layoutPresetWillRemoveOperators: () => true,
    layoutTextHelp: "",
    readOnlyLayout: false,
    inheritProducts: false,
    inheritLabel: "使用组默认产物",
    productRooms: undefined,
    defaultRoom: undefined,
  },
);

const emit = defineEmits<{
  "add-layout": [type: RoomKey];
  "apply-layout-text": [text: string];
  "apply-preset": [preset: LayoutPreset];
  "update-product": [type: RoomKey, position: number, value: string];
  "update-source": [type: RoomKey, position: number, value: string];
  "update-layout-level": [index: number, value: number | null];
  "remove-layout": [index: number];
}>();

const layoutText = ref("");
let layoutApplyTimer: ReturnType<typeof setTimeout> | undefined;
const selectedLayoutPresetId = ref<string>();
const pendingLayoutPreset = ref<LayoutPreset>();
const layoutPresetPopconfirmTrigger: string[] = [];
const layoutPresetOptions = LAYOUT_PRESETS.map((preset) => ({
  label: preset.name,
  value: preset.id,
}));

const selectedLayoutPreset = computed(() =>
  LAYOUT_PRESETS.find((preset) => preset.id === selectedLayoutPresetId.value),
);
const layoutPresetApplyDisabled = computed(() => {
  const preset = selectedLayoutPreset.value;
  return (
    !preset ||
    !props.layoutPresetWillRemoveOperators ||
    pendingLayoutPreset.value !== undefined
  );
});

const fixedRoomTypeSet = computed(() => new Set(props.fixedRoomTypes));
const deleteDisabledRoomTypeSet = computed(
  () => new Set(props.deleteDisabledRoomTypes),
);

const layoutRows = computed(() => {
  const indexedEntries = orderedLayoutEntries(props.layout);
  return LAYOUT_TEXT_ROWS.map((types, rowIndex) => ({
    key: `schedule-layout-row-${rowIndex}`,
    entries: types.flatMap((type) =>
      indexedEntries
        .filter((item) => item.entry.type === type)
        .map(({ entry, index }, position) => ({ entry, index, position })),
    ),
  }));
});

const layoutAddOptions = computed(() =>
  ROOM_DISPLAY_ORDER.map((type) => {
    if (fixedRoomTypeSet.value.has(type)) {
      return {
        type,
        label: ROOM_LABELS[type],
        disabled: true,
        reason: "当前组合设施不可重复添加",
      };
    }
    const result = canAddLayoutEntry(props.layout, type);
    const plan = layoutAdditionPlan(props.layout, type);
    const extraTypes = plan?.types.filter((entryType) => entryType !== type);
    return {
      type,
      label: ROOM_LABELS[type],
      disabled: !plan,
      reason: !plan
        ? result.ok
          ? "当前设施无法添加"
          : result.reason
        : extraTypes?.length
          ? `点击添加，将自动补建：${extraTypes
              .map((entryType) => ROOM_LABELS[entryType])
              .join("、")}`
          : "点击添加",
    };
  }),
);

watch(
  () => props.layout,
  (layout) => {
    layoutText.value = layoutTextFor(layout);
    pendingLayoutPreset.value = undefined;
  },
  { deep: true, immediate: true },
);

watch(layoutText, (text) => {
  if (layoutApplyTimer !== undefined) {
    clearTimeout(layoutApplyTimer);
  }
  if (text === layoutTextFor(props.layout)) {
    layoutApplyTimer = undefined;
    return;
  }
  layoutApplyTimer = setTimeout(() => {
    layoutApplyTimer = undefined;
    if (layoutText.value === text) {
      emit("apply-layout-text", text);
    }
  }, 300);
});

onBeforeUnmount(() => {
  if (layoutApplyTimer !== undefined) {
    clearTimeout(layoutApplyTimer);
  }
});

function facilityStyle(type: RoomKey): Record<string, string> {
  return {
    "--simulator-facility-accent":
      props.facilityColors[type] ?? ROOM_REPRESENTATIVE_COLORS[type],
  };
}

function layoutEntryIsFixed(entry: LayoutEntry): boolean {
  return fixedRoomTypeSet.value.has(entry.type);
}

function layoutEntryIsDeleteDisabled(entry: LayoutEntry): boolean {
  return (
    layoutEntryIsFixed(entry) || deleteDisabledRoomTypeSet.value.has(entry.type)
  );
}

function deleteTitle(entry: LayoutEntry): string {
  if (layoutEntryIsFixed(entry)) return "当前组合设施不可删除";
  if (deleteDisabledRoomTypeSet.value.has(entry.type)) {
    return `${ROOM_LABELS[entry.type]}不可删除`;
  }
  return "删除设施";
}

function deleteConfirmationTitle(entry: LayoutEntry): string | undefined {
  const labels = Array.from(
    new Set(
      cascadeLayoutTypes(entry.type)
        .filter((type) => props.layout.some((item) => item.type === type))
        .map((type) => ROOM_LABELS[type]),
    ),
  );
  return labels.length
    ? `删除${ROOM_LABELS[entry.type]}后，将同时删除${labels.join("、")}，确定吗？`
    : undefined;
}

function fixedLevelText(entry: LayoutEntry): string {
  return `Lv${entry.level}`;
}

function applySelectedLayoutPreset(): void {
  const preset = selectedLayoutPreset.value;
  const willRemoveOperators = props.layoutPresetWillRemoveOperators;
  if (!preset || !willRemoveOperators || layoutPresetApplyDisabled.value) {
    return;
  }
  if (layoutApplyTimer !== undefined) {
    clearTimeout(layoutApplyTimer);
    layoutApplyTimer = undefined;
  }
  layoutText.value = layoutTextFor(props.layout);
  if (willRemoveOperators(preset)) {
    pendingLayoutPreset.value = preset;
    return;
  }
  emit("apply-preset", preset);
}

function confirmLayoutPreset(): void {
  const preset = pendingLayoutPreset.value;
  pendingLayoutPreset.value = undefined;
  if (preset) {
    emit("apply-preset", preset);
  }
}

function handleLayoutPresetOpenChange(open: boolean): void {
  if (!open) {
    pendingLayoutPreset.value = undefined;
  }
}

function roomProduct(
  room: RoomAssignment,
  type: RoomKey,
  position: number,
): string {
  if (room.product) return room.product;
  if (room.productOverride) return "";
  return props.inheritProducts
    ? (props.defaultRoom?.(type, position)?.product ?? "")
    : "";
}

function productValue(type: RoomKey, position: number): string | undefined {
  const rooms = props.productRooms?.(type, position) ?? [];
  if (!rooms.length) return undefined;
  const values = rooms.map((room) =>
    props.inheritProducts && !room.product && !room.productOverride
      ? "__inherit__"
      : (room.product ?? ""),
  );
  return values.every((value) => value === values[0]) ? values[0] : undefined;
}

function productChoices(
  type: RoomKey,
  position: number,
): Array<{ value: string; label: string; disabled?: boolean }> {
  const choices: Array<{ value: string; label: string; disabled?: boolean }> = [
    ...(props.inheritProducts
      ? [{ value: "__inherit__", label: props.inheritLabel }]
      : []),
    { value: "", label: "未指定产物" },
    ...PRODUCT_OPTIONS.filter((option) =>
      type === "trading"
        ? ["龙门币", "合成玉"].includes(option.value)
        : !["龙门币", "合成玉"].includes(option.value),
    ),
  ];
  const value = productValue(type, position);
  if (value && !choices.some((item) => item.value === value))
    choices.push({ value, label: `${value}（仅保留）`, disabled: true });
  return choices;
}

function sourceRooms(type: RoomKey, position: number): RoomAssignment[] {
  return (props.productRooms?.(type, position) ?? []).filter(
    (room) => roomProduct(room, type, position) === "源石碎片",
  );
}

function sourceValue(type: RoomKey, position: number): string | undefined {
  const rooms = sourceRooms(type, position);
  const values = rooms.map(
    (room) =>
      room.sourceMaterial ??
      (props.inheritProducts && !room.product
        ? props.defaultRoom?.(type, position)?.sourceMaterial
        : undefined) ??
      DEFAULT_SOURCE_MATERIAL,
  );
  return values.every((value) => value === values[0]) ? values[0] : undefined;
}
</script>

<template>
  <div class="schedule-layout-editor">
    <div v-if="!readOnlyLayout" class="simulator-layout-text-editor">
      <div v-if="showLayoutPresets" class="simulator-layout-presets">
        <span class="simulator-summary-label">预设布局</span>
        <a-select
          v-model:value="selectedLayoutPresetId"
          :disabled="pendingLayoutPreset !== undefined"
          :options="layoutPresetOptions"
          class="simulator-layout-preset-select"
          aria-label="选择预设布局"
          placeholder="选择预设布局"
        />
        <a-popconfirm
          :open="pendingLayoutPreset !== undefined"
          :title="`应用“${pendingLayoutPreset?.name}”会移除超出新布局容量的干员，确认应用？`"
          :trigger="layoutPresetPopconfirmTrigger"
          cancel-text="取消"
          ok-text="确认应用"
          placement="top"
          @open-change="handleLayoutPresetOpenChange"
          @confirm="confirmLayoutPreset"
        >
          <a-button
            :disabled="layoutPresetApplyDisabled"
            @click="applySelectedLayoutPreset"
          >
            应用
          </a-button>
        </a-popconfirm>
      </div>
      <div class="simulator-layout-add-heading">
        <div class="simulator-layout-text-heading">
          <span class="simulator-summary-label">按数字批量设置</span>
          <a-tooltip v-if="layoutTextHelp" :title="layoutTextHelp">
            <a-button
              aria-label="数字批量设置使用说明"
              class="simulator-layout-help"
              size="small"
              type="text"
            >
              <template #icon><QuestionCircleOutlined /></template>
            </a-button>
          </a-tooltip>
        </div>
        <span class="simulator-layout-add-hint"
          >每行按固定顺序填写设施等级</span
        >
      </div>
      <a-textarea
        v-model:value="layoutText"
        :auto-size="{ minRows: 2, maxRows: 2 }"
        class="simulator-layout-text-input"
        :disabled="pendingLayoutPreset !== undefined"
        placeholder="33 33222\n1313 2111"
      />
      <a-alert v-if="error" :message="error" show-icon type="error" />
    </div>

    <div v-if="!readOnlyLayout" class="simulator-layout-add">
      <div class="simulator-layout-add-heading">
        <span class="simulator-summary-label">添加设施</span>
        <span class="simulator-layout-add-hint">点击设施卡片直接添加</span>
      </div>
      <div class="simulator-layout-add-grid">
        <a-button
          v-for="option in layoutAddOptions"
          :key="option.type"
          :class="[
            'simulator-layout-add-card',
            { 'simulator-layout-add-card--disabled': option.disabled },
          ]"
          :disabled="option.disabled"
          :style="facilityStyle(option.type)"
          :title="option.reason"
          @click="emit('add-layout', option.type)"
        >
          {{ option.label }}
        </a-button>
      </div>
    </div>

    <div class="simulator-layout-list">
      <div
        v-for="row in layoutRows"
        :key="row.key"
        class="simulator-layout-row"
      >
        <div
          v-for="item in row.entries"
          :key="item.index"
          class="simulator-layout-card"
          :style="facilityStyle(item.entry.type)"
        >
          <span class="simulator-layout-card-name">
            {{ ROOM_LABELS[item.entry.type] }}
          </span>
          <div class="simulator-layout-card-actions">
            <span
              v-if="
                isFixedLevelRoom(item.entry.type) ||
                layoutEntryIsFixed(item.entry) ||
                readOnlyLayout
              "
              class="simulator-layout-card-level-text"
              >{{ fixedLevelText(item.entry) }}</span
            >
            <a-input-number
              v-else
              :max="layoutEntryLevelMax(item.entry.type)"
              :min="roomLevelRange(item.entry.type).min"
              :value="item.entry.level"
              addon-after="级"
              class="simulator-layout-card-level"
              @update:value="
                (value: number | null) =>
                  emit('update-layout-level', item.index, value)
              "
            />
            <a-popconfirm
              v-if="!readOnlyLayout && deleteConfirmationTitle(item.entry)"
              :title="deleteConfirmationTitle(item.entry)"
              cancel-text="取消"
              ok-text="删除"
              @confirm="emit('remove-layout', item.index)"
            >
              <a-button
                :disabled="layoutEntryIsDeleteDisabled(item.entry)"
                aria-label="删除设施"
                danger
                :title="deleteTitle(item.entry)"
                type="text"
              >
                <template #icon><DeleteOutlined /></template>
              </a-button>
            </a-popconfirm>
            <a-button
              v-else-if="!readOnlyLayout"
              :disabled="layoutEntryIsDeleteDisabled(item.entry)"
              aria-label="删除设施"
              danger
              :title="deleteTitle(item.entry)"
              type="text"
              @click="emit('remove-layout', item.index)"
            >
              <template #icon><DeleteOutlined /></template>
            </a-button>
          </div>
          <a-select
            v-if="
              productRooms &&
              (item.entry.type === 'trading' ||
                item.entry.type === 'manufacture')
            "
            :value="productValue(item.entry.type, item.position)"
            :options="productChoices(item.entry.type, item.position)"
            :aria-label="`${ROOM_LABELS[item.entry.type]} ${item.position + 1} 产物`"
            placeholder="多个产物"
            class="simulator-layout-product"
            @select="
              (value: string) =>
                emit('update-product', item.entry.type, item.position, value)
            "
          />
          <a-select
            v-if="sourceRooms(item.entry.type, item.position).length"
            :value="sourceValue(item.entry.type, item.position)"
            :options="SOURCE_MATERIAL_OPTIONS"
            :aria-label="`${ROOM_LABELS[item.entry.type]} ${item.position + 1} 材料`"
            placeholder="多个材料"
            class="simulator-layout-product"
            @select="
              (value: string) =>
                emit('update-source', item.entry.type, item.position, value)
            "
          />
        </div>
      </div>
    </div>
  </div>
</template>
