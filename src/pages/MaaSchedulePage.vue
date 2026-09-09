<script setup lang="ts">
import {
  CopyOutlined,
  DeleteOutlined,
  DownloadOutlined,
  FileTextOutlined,
  PlusOutlined,
  SaveOutlined,
  UploadOutlined,
} from "@ant-design/icons-vue";
import { computed, ref, watch } from "vue";

import {
  parseMaaScheduleText,
  serializeMaaSchedule,
} from "@/adapters/maaSchedule";
import { useScheduleDocuments } from "@/composables/useScheduleDocuments";
import type {
  LayoutEntry,
  OperatorState,
  Plan,
  RoomAssignment,
  RoomKey,
} from "@/types/schedule";
import {
  PRODUCT_OPTIONS,
  UNSUPPORTED_PRODUCT_LABELS,
  DEFAULT_SOURCE_MATERIAL,
  ROOM_LABELS,
  ROOM_ORDER,
  SOURCE_MATERIAL_OPTIONS,
} from "@/utils/schedule";

const {
  documents,
  activeDocumentId,
  createDocument,
  getActiveDocument,
  setActiveDocument,
  updateDocument,
  removeDocument,
  duplicateDocument,
} = useScheduleDocuments();

const fileInput = ref<HTMLInputElement>();
const errorMessage = ref("");
const successMessage = ref("");
const showRawJson = ref(false);
const rawJson = ref("");

const activeDocument = computed(() => getActiveDocument());
const currentDocument = computed(() => activeDocument.value?.document);

const layoutGroups = computed(() => {
  const document = currentDocument.value;
  if (!document) {
    return [];
  }

  return ROOM_ORDER.map((type) => ({
    type,
    label: ROOM_LABELS[type],
    entries: document.layout
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => entry.type === type),
  })).filter((group) => group.entries.length > 0);
});

const rawJsonDisplay = computed(() => {
  const document = currentDocument.value;
  if (!document) {
    return "";
  }

  try {
    return serializeMaaSchedule(document);
  } catch {
    return JSON.stringify(document, null, 2);
  }
});

function clearMessages(): void {
  errorMessage.value = "";
  successMessage.value = "";
}

function setError(error: unknown): void {
  errorMessage.value = error instanceof Error ? error.message : "操作失败";
  successMessage.value = "";
}

function persistActive(): void {
  const document = activeDocument.value;
  if (!document) {
    return;
  }
  updateDocument(document.id, () => undefined);
}

function updateCurrent(
  mutator: (document: NonNullable<typeof currentDocument.value>) => void,
): void {
  const document = currentDocument.value;
  if (!document) {
    return;
  }
  mutator(document);
  persistActive();
  rawJson.value = rawJsonDisplay.value;
}

function updateMeta(key: "title" | "description", value: string): void {
  updateCurrent((document) => {
    document[key] = value;
  });
}

function updatePlanMeta(
  plan: Plan,
  key: "name" | "description",
  value: string,
): void {
  updateCurrent(() => {
    plan[key] = value;
  });
}

function updatePlanDuration(plan: Plan, value: number | null): void {
  updateCurrent(() => {
    plan.duration = value ?? undefined;
  });
}

function openFilePicker(): void {
  fileInput.value?.click();
}

async function handleFileChange(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) {
    return;
  }

  clearMessages();
  try {
    const parsed = parseMaaScheduleText(await file.text());
    createDocument(parsed.document, parsed.inferredLayout, file.name);
    successMessage.value = parsed.inferredLayout
      ? "已导入。该文件没有 layout，当前布局由文件内容推断。"
      : "已导入 Maa 排班表。";
  } catch (error: unknown) {
    setError(error);
  }
}

function handleCreate(): void {
  clearMessages();
  createDocument();
  successMessage.value = "已新建排班表。";
}

function handleDuplicate(): void {
  clearMessages();
  const document = activeDocument.value;
  if (!document) {
    return;
  }
  duplicateDocument(document.id);
  successMessage.value = "已复制排班表。";
}

function handleDelete(): void {
  const document = activeDocument.value;
  if (!document) {
    return;
  }
  if (
    !window.confirm(
      `确定删除“${document.document.title || "未命名排班表"}”吗？`,
    )
  ) {
    return;
  }
  removeDocument(document.id);
  successMessage.value = "已删除排班表。";
}

function handleExport(): void {
  const document = currentDocument.value;
  if (!document) {
    return;
  }

  clearMessages();
  try {
    const json = serializeMaaSchedule(document);
    const blob = new Blob([json], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = window.document.createElement("a");
    const title = document.title?.trim() || "Maa排班表";
    link.href = url;
    link.download = `${title.replace(/[\\/:*?"<>|]/g, "_")}.json`;
    link.click();
    URL.revokeObjectURL(url);
    successMessage.value = "已导出严格 JSON 文件。";
  } catch (error: unknown) {
    setError(error);
  }
}

function handleRawJsonApply(): void {
  const stored = activeDocument.value;
  if (!stored) {
    return;
  }

  clearMessages();
  try {
    const parsed = parseMaaScheduleText(rawJson.value);
    updateDocument(stored.id, (document) => {
      document.document = parsed.document;
      document.inferredLayout = parsed.inferredLayout;
    });
    rawJson.value = rawJsonDisplay.value;
    successMessage.value = "已应用原始 JSON。";
  } catch (error: unknown) {
    setError(error);
  }
}

function addPlan(): void {
  updateCurrent((document) => {
    document.plans.push({
      name: `队列${document.plans.length + 1}`,
      duration: 720,
      rooms: roomsForLayout(document.layout),
    });
  });
}

function removePlan(index: number): void {
  if ((currentDocument.value?.plans.length ?? 0) <= 1) {
    return;
  }
  updateCurrent((document) => {
    document.plans.splice(index, 1);
  });
}

function roomsForLayout(
  layout: LayoutEntry[],
): Record<string, RoomAssignment[]> {
  const rooms: Record<string, RoomAssignment[]> = {};
  ROOM_ORDER.forEach((type) => {
    const count = layout.filter((entry) => entry.type === type).length;
    if (count > 0) {
      rooms[type] = Array.from({ length: count }, () => ({ skip: true }));
    }
  });
  return rooms;
}

function resizeRoomsForLayout(plan: Plan, layout: LayoutEntry[]): void {
  const nextRooms: Record<string, RoomAssignment[] | unknown> = {
    ...plan.rooms,
  };
  ROOM_ORDER.forEach((type) => {
    const expected = layout.filter((entry) => entry.type === type).length;
    if (expected === 0) {
      delete nextRooms[type];
      return;
    }
    const previous = Array.isArray(plan.rooms[type])
      ? (plan.rooms[type] as RoomAssignment[])
      : [];
    nextRooms[type] = Array.from(
      { length: expected },
      (_, index) => previous[index] ?? { skip: true },
    );
  });
  plan.rooms = nextRooms;
}

function updateLayoutLevel(index: number, value: number | null): void {
  if (value === null) {
    return;
  }
  updateCurrent((document) => {
    const entry = document.layout[index];
    if (entry) {
      entry.level = value;
    }
  });
}

function updateLayoutType(index: number, value: string): void {
  if (!ROOM_ORDER.includes(value as RoomKey)) {
    return;
  }
  updateCurrent((document) => {
    const entry = document.layout[index];
    if (!entry) {
      return;
    }
    const nextType = value as RoomKey;
    if (entry.type === nextType) {
      return;
    }
    const previousType = entry.type;
    const previousPosition = document.layout
      .slice(0, index)
      .filter((layoutEntry) => layoutEntry.type === previousType).length;
    const nextPosition = document.layout
      .slice(0, index)
      .filter((layoutEntry) => layoutEntry.type === nextType).length;

    document.plans.forEach((plan) => {
      const previousRooms = Array.isArray(plan.rooms[previousType])
        ? [...(plan.rooms[previousType] as RoomAssignment[])]
        : [];
      const movedRoom = previousRooms.splice(previousPosition, 1)[0] ?? {
        skip: true,
      };
      if (previousRooms.length > 0) {
        plan.rooms[previousType] = previousRooms;
      } else {
        delete plan.rooms[previousType];
      }

      const nextRooms = Array.isArray(plan.rooms[nextType])
        ? [...(plan.rooms[nextType] as RoomAssignment[])]
        : [];
      nextRooms.splice(nextPosition, 0, movedRoom);
      plan.rooms[nextType] = nextRooms;
    });

    entry.type = nextType;
    const maxLevel =
      entry.type === "control" || entry.type === "dormitory" ? 5 : 3;
    entry.level = Math.min(entry.level, maxLevel);
    document.plans.forEach((plan) =>
      resizeRoomsForLayout(plan, document.layout),
    );
  });
}

function addLayoutEntry(): void {
  updateCurrent((document) => {
    document.layout.push({ type: "trading", level: 3 });
    document.plans.forEach((plan) =>
      resizeRoomsForLayout(plan, document.layout),
    );
  });
}

function removeLayoutEntry(index: number): void {
  if ((currentDocument.value?.layout.length ?? 0) <= 1) {
    return;
  }
  updateCurrent((document) => {
    const entry = document.layout[index];
    if (!entry) {
      return;
    }
    const position = document.layout
      .slice(0, index)
      .filter((layoutEntry) => layoutEntry.type === entry.type).length;
    document.plans.forEach((plan) => {
      const rooms = plan.rooms[entry.type];
      if (!Array.isArray(rooms)) {
        return;
      }
      const nextRooms = [...(rooms as RoomAssignment[])];
      nextRooms.splice(position, 1);
      if (nextRooms.length > 0) {
        plan.rooms[entry.type] = nextRooms;
      } else {
        delete plan.rooms[entry.type];
      }
    });
    document.layout.splice(index, 1);
    document.plans.forEach((plan) =>
      resizeRoomsForLayout(plan, document.layout),
    );
  });
}

function planRoom(plan: Plan, type: RoomKey, position: number): RoomAssignment {
  const rooms = plan.rooms[type];
  if (!Array.isArray(rooms)) {
    return { skip: true };
  }
  return rooms[position] ?? { skip: true };
}

function updatePlanRoom(
  planIndex: number,
  type: RoomKey,
  position: number,
  update: (room: RoomAssignment) => void,
): void {
  updateCurrent((document) => {
    const plan = document.plans[planIndex];
    if (!plan) {
      return;
    }
    const rooms = Array.isArray(plan.rooms[type])
      ? (plan.rooms[type] as RoomAssignment[])
      : [];
    const expected = document.layout.filter(
      (entry) => entry.type === type,
    ).length;
    while (rooms.length < expected) {
      rooms.push({ skip: true });
    }
    const room = rooms[position];
    if (!room) {
      return;
    }
    update(room);
    plan.rooms[type] = rooms;
  });
}

function operatorsText(room: RoomAssignment): string {
  return room.operators?.join("\n") ?? "";
}

function updateOperators(
  planIndex: number,
  type: RoomKey,
  position: number,
  value: string,
): void {
  updatePlanRoom(planIndex, type, position, (room) => {
    const operators = value
      .split(/\r?\n/)
      .map((name) => name.trim())
      .filter(Boolean);
    room.operators = operators;
    if (operators.length === 0) {
      room.skip = true;
    } else {
      delete room.skip;
    }
    if (room.operatorStates) {
      room.operatorStates = Object.fromEntries(
        Object.entries(room.operatorStates).filter(([name]) =>
          operators.includes(name),
        ),
      );
    }
  });
}

function updateRoomSkip(
  planIndex: number,
  type: RoomKey,
  position: number,
  skip: boolean,
): void {
  updatePlanRoom(planIndex, type, position, (room) => {
    if (skip) {
      room.skip = true;
    } else {
      delete room.skip;
    }
  });
}

function updateRoomProduct(
  planIndex: number,
  type: RoomKey,
  position: number,
  product: string,
): void {
  updatePlanRoom(planIndex, type, position, (room) => {
    if (product) {
      room.product = product;
      if (product === "Originium Shard" && !room.sourceMaterial) {
        room.sourceMaterial = DEFAULT_SOURCE_MATERIAL;
      }
    } else {
      delete room.product;
      delete room.sourceMaterial;
    }
  });
}

function updateRoomSource(
  planIndex: number,
  type: RoomKey,
  position: number,
  sourceMaterial: string,
): void {
  updatePlanRoom(planIndex, type, position, (room) => {
    if (sourceMaterial) {
      room.sourceMaterial = sourceMaterial;
    } else {
      delete room.sourceMaterial;
    }
  });
}

function stateFor(room: RoomAssignment, name: string): OperatorState {
  return room.operatorStates?.[name] ?? {};
}

function updateState(
  planIndex: number,
  type: RoomKey,
  position: number,
  name: string,
  key: "mood" | "elite",
  value: number | null,
): void {
  updatePlanRoom(planIndex, type, position, (room) => {
    const states = room.operatorStates ?? {};
    const state = states[name] ?? {};
    if (value === null) {
      delete state[key];
    } else {
      state[key] = value;
    }
    if (Object.keys(state).length > 0) {
      states[name] = state;
    } else {
      delete states[name];
    }
    if (Object.keys(states).length > 0) {
      room.operatorStates = states;
    } else {
      delete room.operatorStates;
    }
  });
}

function roomHasProduct(type: RoomKey): boolean {
  return type === "trading" || type === "manufacture";
}

function productOptions(
  type: RoomKey,
  currentProduct: string | undefined,
): Array<{ value: string; label: string; disabled?: boolean }> {
  const options: Array<{ value: string; label: string; disabled?: boolean }> =
    type === "trading"
      ? PRODUCT_OPTIONS.filter(
          (option) => option.value === "LMD" || option.value === "Orundum",
        )
      : PRODUCT_OPTIONS.filter(
          (option) => option.value !== "LMD" && option.value !== "Orundum",
        );
  if (
    currentProduct &&
    !options.some((option) => option.value === currentProduct)
  ) {
    options.push({
      value: currentProduct,
      label:
        UNSUPPORTED_PRODUCT_LABELS[currentProduct] ??
        `${currentProduct}（仅保留）`,
      disabled: true,
    });
  }
  return options;
}

function sourceValue(room: RoomAssignment): string {
  return (
    room.sourceMaterial ??
    (room.product === "Originium Shard" ? DEFAULT_SOURCE_MATERIAL : "")
  );
}

function sourceVisible(room: RoomAssignment): boolean {
  return room.product === "Originium Shard";
}

watch(
  rawJsonDisplay,
  (value) => {
    if (!showRawJson.value) {
      rawJson.value = value;
    }
  },
  { immediate: true },
);

watch(activeDocumentId, () => {
  rawJson.value = rawJsonDisplay.value;
});
</script>

<template>
  <div class="page-shell maa-page">
    <div class="page-heading">
      <div class="page-heading-icon maa-page-heading-icon" aria-hidden="true">
        <FileTextOutlined />
      </div>
      <div class="page-heading-copy">
        <a-typography-title :level="2" class="page-title"
          >Maa 排班表接口</a-typography-title
        >
        <span class="page-heading-description"
          >严格 JSON 的排班表查看、编辑与导入导出</span
        >
      </div>
    </div>

    <a-alert
      v-if="errorMessage"
      :message="errorMessage"
      class="maa-alert"
      closable
      type="error"
      @close="errorMessage = ''"
    />
    <a-alert
      v-if="successMessage"
      :message="successMessage"
      class="maa-alert"
      closable
      type="success"
      @close="successMessage = ''"
    />

    <div class="maa-layout">
      <aside class="maa-document-sidebar">
        <div class="maa-sidebar-head">
          <div>
            <span class="maa-eyebrow">DOCUMENTS</span>
            <h3>排班文档</h3>
          </div>
          <a-button
            aria-label="新建排班文档"
            title="新建排班文档"
            type="text"
            @click="handleCreate"
          >
            <template #icon><PlusOutlined /></template>
          </a-button>
        </div>
        <div class="maa-sidebar-actions">
          <a-button block @click="openFilePicker">
            <template #icon><UploadOutlined /></template>
            导入 JSON
          </a-button>
          <input
            ref="fileInput"
            accept=".json,application/json"
            hidden
            type="file"
            @change="handleFileChange"
          />
        </div>
        <div class="maa-document-list">
          <button
            v-for="document in documents"
            :key="document.id"
            :class="[
              'maa-document-item',
              { 'maa-document-item--active': document.id === activeDocumentId },
            ]"
            type="button"
            @click="setActiveDocument(document.id)"
          >
            <span class="maa-document-item-title">{{
              document.document.title || "未命名排班表"
            }}</span>
            <span class="maa-document-item-meta">
              {{ document.document.plans.length }} 个计划
              <span v-if="document.inferredLayout"> · 推断布局</span>
            </span>
          </button>
          <a-empty
            v-if="!documents.length"
            :image="undefined"
            description="暂无排班文档"
          />
        </div>
      </aside>

      <main v-if="currentDocument" class="maa-editor">
        <div class="maa-editor-toolbar">
          <div class="maa-toolbar-main">
            <a-button title="复制当前文档" @click="handleDuplicate">
              <template #icon><CopyOutlined /></template>
              复制
            </a-button>
            <a-button title="删除当前文档" @click="handleDelete">
              <template #icon><DeleteOutlined /></template>
              删除
            </a-button>
          </div>
          <div class="maa-toolbar-main">
            <a-button
              :type="showRawJson ? 'primary' : 'default'"
              @click="showRawJson = !showRawJson"
            >
              <template #icon><FileTextOutlined /></template>
              原始 JSON
            </a-button>
            <a-button type="primary" @click="handleExport">
              <template #icon><DownloadOutlined /></template>
              导出 JSON
            </a-button>
          </div>
        </div>

        <a-card :bordered="false" class="maa-meta-panel">
          <div class="maa-panel-heading">
            <div>
              <span class="maa-eyebrow">MAA SCHEDULE</span>
              <h3>文档信息</h3>
            </div>
            <span v-if="activeDocument?.inferredLayout" class="maa-status-tag"
              >布局由文件内容推断</span
            >
          </div>
          <a-form layout="vertical">
            <div class="maa-meta-grid">
              <a-form-item label="标题">
                <a-input
                  :value="currentDocument.title ?? ''"
                  @update:value="(value: string) => updateMeta('title', value)"
                />
              </a-form-item>
              <a-form-item label="描述">
                <a-textarea
                  :auto-size="{ minRows: 1, maxRows: 4 }"
                  :value="currentDocument.description ?? ''"
                  @update:value="
                    (value: string) => updateMeta('description', value)
                  "
                />
              </a-form-item>
            </div>
          </a-form>
        </a-card>

        <a-card :bordered="false" class="maa-section-card" title="布局">
          <template #extra>
            <a-button size="small" @click="addLayoutEntry">
              <template #icon><PlusOutlined /></template>
              添加设施
            </a-button>
          </template>
          <div class="maa-layout-list">
            <div
              v-for="(entry, index) in currentDocument.layout"
              :key="`${entry.type}-${index}`"
              class="maa-layout-row"
            >
              <span class="maa-layout-order">{{ index + 1 }}</span>
              <a-select
                :options="
                  ROOM_ORDER.map((type) => ({
                    value: type,
                    label: ROOM_LABELS[type],
                  }))
                "
                :value="entry.type"
                class="maa-room-type-select"
                @update:value="
                  (value: string) => updateLayoutType(index, value)
                "
              />
              <a-input-number
                :max="
                  entry.type === 'control' || entry.type === 'dormitory' ? 5 : 3
                "
                :min="1"
                :value="entry.level"
                addon-after="级"
                @update:value="
                  (value: number | null) => updateLayoutLevel(index, value)
                "
              />
              <a-button
                aria-label="删除设施"
                danger
                title="删除设施"
                type="text"
                @click="removeLayoutEntry(index)"
              >
                <template #icon><DeleteOutlined /></template>
              </a-button>
            </div>
          </div>
        </a-card>

        <a-card :bordered="false" class="maa-section-card" title="计划">
          <template #extra>
            <a-button size="small" @click="addPlan">
              <template #icon><PlusOutlined /></template>
              添加计划
            </a-button>
          </template>
          <div class="maa-plan-list">
            <section
              v-for="(plan, planIndex) in currentDocument.plans"
              :key="planIndex"
              class="maa-plan-block"
            >
              <div class="maa-plan-head">
                <div class="maa-plan-title-fields">
                  <a-input
                    :value="plan.name ?? ''"
                    class="maa-plan-name"
                    placeholder="计划名称"
                    @update:value="
                      (value: string) => updatePlanMeta(plan, 'name', value)
                    "
                  />
                  <a-input-number
                    :max="1440"
                    :min="60"
                    :value="plan.duration ?? 720"
                    addon-after="分钟"
                    @update:value="
                      (value: number | null) => updatePlanDuration(plan, value)
                    "
                  />
                </div>
                <a-button
                  v-if="currentDocument.plans.length > 1"
                  aria-label="删除计划"
                  danger
                  title="删除计划"
                  type="text"
                  @click="removePlan(planIndex)"
                >
                  <template #icon><DeleteOutlined /></template>
                </a-button>
              </div>
              <a-input
                :value="plan.description ?? ''"
                class="maa-plan-description"
                placeholder="计划描述（可选）"
                @update:value="
                  (value: string) => updatePlanMeta(plan, 'description', value)
                "
              />

              <div class="maa-room-groups">
                <div
                  v-for="group in layoutGroups"
                  :key="group.type"
                  class="maa-room-group"
                >
                  <div class="maa-room-group-heading">
                    <span>{{ group.label }}</span>
                    <span class="maa-room-group-count"
                      >{{ group.entries.length }} 个设施</span
                    >
                  </div>
                  <div class="maa-room-cards">
                    <div
                      v-for="(_entry, position) in group.entries"
                      :key="position"
                      class="maa-room-card"
                    >
                      <div class="maa-room-card-head">
                        <strong>{{ group.label }} {{ position + 1 }}</strong>
                        <a-checkbox
                          :checked="
                            planRoom(plan, group.type, position).skip === true
                          "
                          @change="
                            (event: { target: { checked: boolean } }) =>
                              updateRoomSkip(
                                planIndex,
                                group.type,
                                position,
                                event.target.checked,
                              )
                          "
                        >
                          跳过换班
                        </a-checkbox>
                      </div>
                      <a-textarea
                        :auto-size="{ minRows: 2, maxRows: 6 }"
                        :value="
                          operatorsText(planRoom(plan, group.type, position))
                        "
                        placeholder="每行一个干员名称"
                        @update:value="
                          (value: string) =>
                            updateOperators(
                              planIndex,
                              group.type,
                              position,
                              value,
                            )
                        "
                      />
                      <a-select
                        v-if="roomHasProduct(group.type)"
                        :options="[
                          { value: '', label: '未指定产物' },
                          ...productOptions(
                            group.type,
                            planRoom(plan, group.type, position).product,
                          ),
                        ]"
                        :value="
                          planRoom(plan, group.type, position).product ?? ''
                        "
                        class="maa-room-product"
                        @update:value="
                          (value: string) =>
                            updateRoomProduct(
                              planIndex,
                              group.type,
                              position,
                              value,
                            )
                        "
                      />
                      <a-select
                        v-if="
                          roomHasProduct(group.type) &&
                          sourceVisible(planRoom(plan, group.type, position))
                        "
                        :options="[
                          { value: '', label: '未指定原料' },
                          ...SOURCE_MATERIAL_OPTIONS,
                        ]"
                        :value="
                          sourceValue(planRoom(plan, group.type, position))
                        "
                        class="maa-room-product"
                        @update:value="
                          (value: string) =>
                            updateRoomSource(
                              planIndex,
                              group.type,
                              position,
                              value,
                            )
                        "
                      />
                      <div
                        v-for="operator in planRoom(plan, group.type, position)
                          .operators ?? []"
                        :key="operator"
                        class="maa-operator-state"
                      >
                        <span class="maa-operator-name">{{ operator }}</span>
                        <a-input-number
                          :max="24"
                          :min="0"
                          :placeholder="'默认心情'"
                          :value="
                            stateFor(
                              planRoom(plan, group.type, position),
                              operator,
                            ).mood
                          "
                          addon-after="心情"
                          size="small"
                          @update:value="
                            (value: number | null) =>
                              updateState(
                                planIndex,
                                group.type,
                                position,
                                operator,
                                'mood',
                                value,
                              )
                          "
                        />
                        <a-input-number
                          :max="2"
                          :min="0"
                          :placeholder="'默认精英 0'"
                          :value="
                            stateFor(
                              planRoom(plan, group.type, position),
                              operator,
                            ).elite
                          "
                          addon-after="精英"
                          size="small"
                          @update:value="
                            (value: number | null) =>
                              updateState(
                                planIndex,
                                group.type,
                                position,
                                operator,
                                'elite',
                                value,
                              )
                          "
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </a-card>

        <a-card
          v-if="showRawJson"
          :bordered="false"
          class="maa-section-card maa-raw-card"
          title="原始 JSON"
        >
          <a-textarea
            v-model:value="rawJson"
            :auto-size="{ minRows: 16 }"
            spellcheck="false"
          />
          <div class="maa-raw-actions">
            <a-button type="primary" @click="handleRawJsonApply">
              <template #icon><SaveOutlined /></template>
              应用原始 JSON
            </a-button>
          </div>
        </a-card>
      </main>

      <a-empty
        v-else
        class="maa-editor-empty"
        description="导入或新建一个 Maa 排班文档"
      />
    </div>
  </div>
</template>

<style scoped>
.maa-page {
  padding-block-end: 40px;
}

.maa-page-heading-icon {
  color: #7a5a2d;
  background: #f1e4cf;
}

.maa-alert {
  margin-block-end: 14px;
}

.maa-layout {
  display: grid;
  grid-template-columns: 248px minmax(0, 1fr);
  align-items: start;
  gap: 18px;
}

.maa-document-sidebar,
.maa-editor > .ant-card,
.maa-editor-toolbar {
  border: 1px solid #e0e8e5;
  border-radius: 6px;
  box-shadow: 0 8px 24px rgba(36, 52, 57, 0.04);
}

.maa-document-sidebar {
  position: sticky;
  inset-block-start: 92px;
  overflow: hidden;
  background: #ffffff;
}

.maa-sidebar-head,
.maa-panel-heading,
.maa-plan-head,
.maa-room-card-head,
.maa-editor-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.maa-sidebar-head {
  padding: 18px 16px 12px;
  border-block-end: 1px solid #edf1f0;
}

.maa-sidebar-head h3,
.maa-panel-heading h3 {
  margin: 4px 0 0;
  color: #253238;
  font-size: 16px;
}

.maa-eyebrow {
  color: #8b9896;
  font-size: 10px;
  letter-spacing: 0.14em;
}

.maa-sidebar-actions {
  padding: 12px 16px;
}

.maa-document-list {
  display: grid;
  max-height: 560px;
  padding: 0 8px 10px;
  overflow: auto;
  gap: 4px;
}

.maa-document-item {
  display: grid;
  width: 100%;
  padding: 11px 10px;
  color: #4b595b;
  text-align: start;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
  cursor: pointer;
  gap: 4px;
}

.maa-document-item:hover {
  background: #f5f8f7;
}

.maa-document-item--active {
  color: #2f605c;
  background: #eaf3f0;
  border-color: #cfe2dc;
}

.maa-document-item-title {
  overflow: hidden;
  font-size: 13px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.maa-document-item-meta,
.maa-room-group-count {
  color: #8b9896;
  font-size: 11px;
}

.maa-editor {
  display: grid;
  min-width: 0;
  gap: 14px;
}

.maa-editor-toolbar {
  padding: 8px;
  background: #ffffff;
}

.maa-toolbar-main {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.maa-editor > .ant-card {
  min-width: 0;
}

.maa-editor > .ant-card :deep(.ant-card-head) {
  min-height: 58px;
  padding-inline: 20px;
  border-block-end-color: #edf1f0;
}

.maa-editor > .ant-card :deep(.ant-card-head-title) {
  color: #253238;
  font-size: 16px;
  font-weight: 650;
}

.maa-editor > .ant-card :deep(.ant-card-body) {
  padding: 20px;
}

.maa-meta-grid {
  display: grid;
  grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.2fr);
  gap: 16px;
}

.maa-meta-grid .ant-form-item {
  margin-block-end: 0;
}

.maa-status-tag {
  padding: 4px 8px;
  color: #8b5e20;
  font-size: 11px;
  background: #fff4dc;
  border: 1px solid #f0d8a6;
  border-radius: 3px;
}

.maa-layout-list {
  display: grid;
  gap: 8px;
}

.maa-layout-row {
  display: grid;
  grid-template-columns: 28px minmax(150px, 1fr) 118px 32px;
  align-items: center;
  gap: 8px;
}

.maa-layout-order {
  color: #9aa6a4;
  font-size: 12px;
  text-align: center;
}

.maa-room-type-select {
  min-width: 0;
}

.maa-plan-list {
  display: grid;
  gap: 16px;
}

.maa-plan-block {
  min-width: 0;
  padding: 16px;
  background: #f8faf9;
  border: 1px solid #e3ebe8;
  border-radius: 5px;
}

.maa-plan-head {
  align-items: flex-start;
}

.maa-plan-title-fields {
  display: flex;
  flex: 1;
  min-width: 0;
  gap: 8px;
}

.maa-plan-title-fields > *,
.maa-plan-description {
  min-width: 0;
  max-width: 100%;
}

.maa-plan-name {
  min-width: 0;
  max-width: 300px;
}

.maa-plan-description {
  margin-block: 10px 16px;
}

.maa-room-groups {
  min-width: 0;
  display: grid;
  gap: 16px;
}

.maa-room-group {
  min-width: 0;
  display: grid;
  gap: 8px;
}

.maa-room-group-heading {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding-block-end: 6px;
  color: #536362;
  font-size: 13px;
  font-weight: 650;
  border-block-end: 1px solid #dfe8e5;
}

.maa-room-cards {
  min-width: 0;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr));
  gap: 10px;
}

.maa-room-card {
  min-width: 0;
  display: grid;
  padding: 12px;
  background: #ffffff;
  border: 1px solid #e3ebe8;
  border-radius: 4px;
  gap: 8px;
}

.maa-room-card-head {
  align-items: flex-start;
}

.maa-room-card-head strong {
  color: #3f4f50;
  font-size: 12px;
}

.maa-room-card-head :deep(.ant-checkbox-wrapper) {
  color: #7d8988;
  font-size: 11px;
}

.maa-room-product {
  width: 100%;
}

.maa-operator-state {
  display: grid;
  grid-template-columns: minmax(80px, 1fr) minmax(100px, 0.9fr) minmax(
      100px,
      0.9fr
    );
  align-items: center;
  gap: 6px;
}

.maa-operator-name {
  overflow: hidden;
  color: #596766;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.maa-raw-card :deep(.ant-input) {
  min-height: 320px;
  color: #364547;
  font-family: "Cascadia Code", "Consolas", monospace;
  font-size: 12px;
  line-height: 1.6;
}

.maa-raw-actions {
  display: flex;
  justify-content: flex-end;
  margin-block-start: 12px;
}

.maa-editor-empty {
  min-height: 420px;
  padding: 40px;
  background: #ffffff;
  border: 1px solid #e0e8e5;
  border-radius: 6px;
}

@media (max-width: 900px) {
  .maa-layout {
    grid-template-columns: 1fr;
  }

  .maa-document-sidebar {
    position: static;
  }

  .maa-document-list {
    max-height: 240px;
  }
}

@media (max-width: 600px) {
  .maa-editor-toolbar,
  .maa-plan-title-fields {
    align-items: stretch;
    flex-direction: column;
  }

  .maa-editor-toolbar {
    gap: 8px;
  }

  .maa-toolbar-main {
    width: 100%;
  }

  .maa-toolbar-main .ant-btn {
    flex: 1;
  }

  .maa-meta-grid {
    grid-template-columns: 1fr;
    gap: 0;
  }

  .maa-layout-row {
    grid-template-columns: 24px minmax(0, 1fr) 98px 30px;
  }

  .maa-operator-state {
    min-width: 0;
    grid-template-columns: 1fr 1fr;
  }

  .maa-room-card > *,
  .maa-room-card-head > * {
    min-width: 0;
    max-width: 100%;
  }

  .maa-room-card-head {
    flex-wrap: wrap;
  }

  .maa-operator-state :deep(.ant-input-number-group-wrapper),
  .maa-operator-state :deep(.ant-input-number-wrapper),
  .maa-operator-state :deep(.ant-input-number) {
    width: 100%;
    min-width: 0;
    max-width: 100%;
  }

  .maa-operator-name {
    grid-column: 1 / -1;
  }
}
</style>
