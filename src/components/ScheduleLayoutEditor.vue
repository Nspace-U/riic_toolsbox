<script setup lang="ts">
import { DeleteOutlined } from "@ant-design/icons-vue";
import { computed, onBeforeUnmount, ref, watch } from "vue";

import type { LayoutEntry, RoomKey } from "@/types/schedule";
import {
  LAYOUT_TEXT_ROWS,
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
    showSummary?: boolean;
    showLayoutPresets?: boolean;
    layoutPresetWillRemoveOperators?: (preset: LayoutPreset) => boolean;
    layoutTextFooter?: string;
  }>(),
  {
    fixedRoomTypes: () => [],
    deleteDisabledRoomTypes: () => [],
    fixedRoomLevels: () => ({}),
    facilityColors: () => ({}),
    error: "",
    showSummary: true,
    showLayoutPresets: false,
    layoutPresetWillRemoveOperators: () => true,
    layoutTextFooter: "",
  },
);

const emit = defineEmits<{
  "add-layout": [type: RoomKey];
  "apply-layout-text": [text: string];
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

const layoutGroups = computed(() =>
  ROOM_DISPLAY_ORDER.map((type) => ({
    type,
    label: ROOM_LABELS[type],
    entries: props.layout.filter((entry) => entry.type === type),
  })).filter((group) => group.entries.length > 0),
);

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
  emit("apply-layout-text", preset.layoutText);
}

function confirmLayoutPreset(): void {
  const preset = pendingLayoutPreset.value;
  pendingLayoutPreset.value = undefined;
  if (preset) {
    emit("apply-layout-text", preset.layoutText);
  }
}

function handleLayoutPresetOpenChange(open: boolean): void {
  if (!open) {
    pendingLayoutPreset.value = undefined;
  }
}
</script>

<template>
  <div class="schedule-layout-editor">
    <div class="simulator-layout-text-editor">
      <div class="simulator-layout-add-heading">
        <span class="simulator-summary-label">按数字批量设置</span>
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
      <div v-if="layoutTextFooter" class="simulator-layout-text-footer">
        <span>{{ layoutTextFooter }}</span>
      </div>
      <a-alert v-if="error" :message="error" show-icon type="error" />
    </div>

    <div class="simulator-layout-add">
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
                layoutEntryIsFixed(item.entry)
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
              v-if="deleteConfirmationTitle(item.entry)"
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
              v-else
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
        </div>
      </div>
    </div>

    <div v-if="showSummary" class="simulator-layout-summary">
      <span class="simulator-summary-label">设施布局</span>
      <a-tag v-for="group in layoutGroups" :key="group.type" color="green">
        {{ group.label }} × {{ group.entries.length }}
      </a-tag>
    </div>
  </div>
</template>
