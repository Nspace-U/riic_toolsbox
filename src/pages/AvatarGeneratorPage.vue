<script setup lang="ts">
import {
  CopyOutlined,
  DownloadOutlined,
  PictureOutlined,
  ReloadOutlined,
  WarningOutlined,
} from "@ant-design/icons-vue";
import { computed, onBeforeUnmount, ref, watch } from "vue";

import { useBaseData } from "@/composables/useBaseData";
import { useDataSource } from "@/composables/useDataSource";
import OperatorAvatarDisplay from "@/components/OperatorAvatarDisplay.vue";
import type { EliteLevel, Operator } from "@/types/baseData";
import {
  generateOperatorAvatarBlob,
  generateOperatorAvatarUrl,
  getOperatorAvatarFile,
} from "@/utils/operatorAvatar";

interface EliteOption {
  value: EliteLevel;
  label: string;
}

const AVATAR_STAGES: EliteOption[] = [
  { value: 0, label: "精英 0" },
  { value: 1, label: "精英 1" },
  { value: 2, label: "精英 2" },
];

const { operators, loading, errorMessage, ready, reload } = useBaseData();
const { selectedDataSource } = useDataSource();

const selectedOperatorId = ref("");
const selectedEliteLevel = ref<EliteLevel>(0);
const avatarDisplayMode = ref<"combined" | "layered">("combined");
const showRarity = ref(true);
const showEliteLevel = ref(true);
const showProfession = ref(true);
const showName = ref(false);
const moodScattered = ref(false);
const operatorOwned = ref(true);
const operatorTrainingUpgraded = ref(false);
const generating = ref(false);
const generationError = ref("");
const generatedImageUrl = ref("");
const copying = ref(false);
const copyError = ref("");
const copySuccess = ref(false);

const operatorOptions = computed(() => {
  return operators.value.map((operator) => ({
    label: `${operator.name} · ${operator.id}`,
    value: operator.id,
  }));
});

const selectedOperator = computed<Operator | undefined>(() => {
  return operators.value.find(
    (operator) => operator.id === selectedOperatorId.value,
  );
});

const availableAvatarStages = computed<EliteOption[]>(() => {
  const operator = selectedOperator.value;
  if (!operator) {
    return [];
  }

  return AVATAR_STAGES.filter((option) =>
    Boolean(getOperatorAvatarFile(operator, option.value)),
  );
});

const selectedEliteOption = computed<EliteOption | undefined>(() => {
  return AVATAR_STAGES.find(
    (option) => option.value === selectedEliteLevel.value,
  );
});

const selectedAvatarFile = computed(() => {
  const operator = selectedOperator.value;
  return operator
    ? getOperatorAvatarFile(operator, selectedEliteLevel.value)
    : "";
});

const previewDescription = computed(() => {
  if (!selectedOperator.value) {
    return "读取数据后选择干员";
  }
  if (!selectedAvatarFile.value) {
    return `${selectedOperator.value.name}暂无${selectedEliteOption.value?.label ?? ""}头像资源`;
  }
  return `${selectedOperator.value.name} · ${selectedEliteOption.value?.label ?? ""}`;
});

const showLayeredPreview = computed(
  () => avatarDisplayMode.value === "layered",
);

function updateSelectedOperator(value: Operator[]): void {
  if (!value.some((operator) => operator.id === selectedOperatorId.value)) {
    selectedOperatorId.value = value[0]?.id ?? "";
  }
}

function clearGeneratedImage(): void {
  if (generatedImageUrl.value) {
    URL.revokeObjectURL(generatedImageUrl.value);
    generatedImageUrl.value = "";
  }
}

function handleReload(): void {
  void reload();
}

function rarityLabel(operator: Operator): string {
  return operator.rarity > 0 ? `${operator.rarity}★` : "未知稀有度";
}

function avatarGenerationOptions(): Parameters<
  typeof generateOperatorAvatarBlob
>[2] {
  return {
    eliteLevel: selectedEliteLevel.value,
    showRarity: showRarity.value,
    showEliteLevel: showEliteLevel.value,
    showProfession: showProfession.value,
    showName: showName.value,
    moodScattered: moodScattered.value,
    operatorOwned: operatorOwned.value,
    operatorTrainingUpgraded: operatorTrainingUpgraded.value,
  };
}

watch(
  availableAvatarStages,
  (stages) => {
    const firstStage = stages[0];
    if (
      firstStage &&
      !stages.some((stage) => stage.value === selectedEliteLevel.value)
    ) {
      selectedEliteLevel.value = firstStage.value;
    }
  },
  { immediate: true },
);

let generationRequestId = 0;

async function handleGenerate(): Promise<void> {
  const operator = selectedOperator.value;
  if (!operator || !selectedAvatarFile.value) {
    return;
  }

  const requestId = ++generationRequestId;
  generating.value = true;
  generationError.value = "";

  try {
    if (showLayeredPreview.value) {
      clearGeneratedImage();
      return;
    }
    const generatedUrl = await generateOperatorAvatarUrl(
      operator,
      selectedDataSource.value,
      avatarGenerationOptions(),
    );
    if (requestId === generationRequestId) {
      const previousImageUrl = generatedImageUrl.value;
      generatedImageUrl.value = generatedUrl ?? "";
      if (previousImageUrl && previousImageUrl !== generatedImageUrl.value) {
        URL.revokeObjectURL(previousImageUrl);
      }
    } else if (generatedUrl) {
      URL.revokeObjectURL(generatedUrl);
    }
  } catch (error: unknown) {
    if (requestId === generationRequestId) {
      generationError.value =
        error instanceof Error ? error.message : "头像生成失败";
    }
  } finally {
    if (requestId === generationRequestId) {
      generating.value = false;
    }
  }
}

async function createDownloadImageUrl(): Promise<
  { url: string; temporary: boolean } | undefined
> {
  const operator = selectedOperator.value;
  if (!operator || !selectedAvatarFile.value) {
    return undefined;
  }
  if (generatedImageUrl.value) {
    return { url: generatedImageUrl.value, temporary: false };
  }
  const blob = await generateOperatorAvatarBlob(
    operator,
    selectedDataSource.value,
    avatarGenerationOptions(),
  );
  return blob ? { url: URL.createObjectURL(blob), temporary: true } : undefined;
}

async function handleDownload(): Promise<void> {
  const image = await createDownloadImageUrl();
  if (!image || !selectedOperator.value) {
    return;
  }

  const eliteLabel =
    selectedEliteOption.value?.label.replace(/\s/g, "") ??
    `精${selectedEliteLevel.value}`;
  const moodLabel = moodScattered.value ? "-心情涣散" : "";
  const link = document.createElement("a");
  link.href = image.url;
  link.download = `${selectedOperator.value.name}-${eliteLabel}${moodLabel}.png`;
  link.click();
  if (image.temporary) {
    URL.revokeObjectURL(image.url);
  }
}

async function handleCopyImage(): Promise<void> {
  if (copying.value) {
    return;
  }

  copying.value = true;
  copyError.value = "";
  copySuccess.value = false;
  let image: Awaited<ReturnType<typeof createDownloadImageUrl>>;

  try {
    if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
      throw new Error("当前浏览器不支持复制图片，请使用下载 PNG");
    }

    image = await createDownloadImageUrl();
    if (!image) {
      throw new Error("当前没有可复制的头像图片");
    }
    const response = await fetch(image.url);
    const imageBlob = await response.blob();
    await navigator.clipboard.write([
      new ClipboardItem({ "image/png": imageBlob }),
    ]);
    copySuccess.value = true;
  } catch (error: unknown) {
    copyError.value =
      error instanceof Error ? error.message : "图片复制失败，请使用下载 PNG";
  } finally {
    if (image?.temporary) {
      URL.revokeObjectURL(image.url);
    }
    copying.value = false;
  }
}

watch(operators, updateSelectedOperator, { immediate: true });
watch(
  [
    selectedOperatorId,
    selectedEliteLevel,
    avatarDisplayMode,
    showRarity,
    showEliteLevel,
    showProfession,
    showName,
    moodScattered,
    operatorOwned,
    operatorTrainingUpgraded,
    selectedDataSource,
  ],
  () => {
    generationError.value = "";
    copyError.value = "";
    copySuccess.value = false;
    void handleGenerate();
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  generationRequestId += 1;
  clearGeneratedImage();
});
</script>

<template>
  <div class="page-shell avatar-generator-page">
    <div class="page-heading">
      <div class="page-heading-icon" aria-hidden="true">
        <PictureOutlined />
      </div>
      <div class="page-heading-copy">
        <a-typography-title :level="2" class="page-title"
          >头像生成器</a-typography-title
        >
        <span class="page-heading-description"
          >选择干员和精英化等级，生成可直接使用的头像图片</span
        >
      </div>
    </div>

    <a-alert
      v-if="errorMessage"
      :message="errorMessage"
      class="avatar-generator-alert"
      show-icon
      type="error"
    />

    <a-spin :spinning="loading" tip="读取干员数据中...">
      <div class="avatar-generator-layout">
        <a-card :bordered="false" class="avatar-generator-panel">
          <template #title>生成设置</template>
          <template #extra>
            <a-button :loading="loading" type="text" @click="handleReload">
              <template #icon>
                <ReloadOutlined />
              </template>
              重新读取
            </a-button>
          </template>

          <a-form layout="vertical">
            <div class="avatar-selection-row">
              <a-form-item
                class="avatar-selection-item avatar-selection-item--operator"
                label="干员名称"
              >
                <a-select
                  v-model:value="selectedOperatorId"
                  :options="operatorOptions"
                  :show-search="true"
                  class="avatar-operator-select"
                  option-filter-prop="label"
                  placeholder="选择干员"
                />
              </a-form-item>

              <a-form-item
                class="avatar-selection-item avatar-selection-item--elite"
                label="精英化等级"
              >
                <a-radio-group
                  v-model:value="selectedEliteLevel"
                  button-style="solid"
                  option-type="button"
                >
                  <a-radio-button
                    v-for="option in availableAvatarStages"
                    :key="option.value"
                    :value="option.value"
                  >
                    {{ option.label }}
                  </a-radio-button>
                </a-radio-group>
                <a-typography-text
                  v-if="selectedOperator && availableAvatarStages.length === 0"
                  type="secondary"
                >
                  当前干员没有可用头像资源
                </a-typography-text>
              </a-form-item>
            </div>

            <a-form-item label="头像显示方式">
              <a-radio-group
                v-model:value="avatarDisplayMode"
                button-style="solid"
                option-type="button"
              >
                <a-radio-button value="combined">整合</a-radio-button>
                <a-radio-button value="layered">分层</a-radio-button>
              </a-radio-group>
            </a-form-item>

            <a-divider orientation="left">头像信息</a-divider>
            <div class="avatar-checkboxes">
              <a-checkbox v-model:checked="operatorOwned"
                >干员已拥有</a-checkbox
              >
              <a-checkbox v-model:checked="operatorTrainingUpgraded"
                >干员已提升练度</a-checkbox
              >
              <a-checkbox v-model:checked="showRarity">显示稀有度</a-checkbox>
              <a-checkbox v-model:checked="showEliteLevel"
                >显示精英化等级</a-checkbox
              >
              <a-checkbox v-model:checked="showProfession">显示职业</a-checkbox>
              <a-checkbox v-model:checked="showName">显示干员名称</a-checkbox>
              <a-checkbox v-model:checked="moodScattered">心情涣散</a-checkbox>
            </div>

            <a-alert
              v-if="selectedOperator && !selectedAvatarFile"
              :message="previewDescription"
              class="avatar-generator-warning"
              show-icon
              type="warning"
            >
              <template #icon>
                <WarningOutlined />
              </template>
            </a-alert>
            <a-alert
              v-if="generationError"
              :message="generationError"
              class="avatar-generator-warning"
              show-icon
              type="error"
            />
            <a-alert
              v-if="copyError"
              :message="copyError"
              class="avatar-generator-warning"
              show-icon
              type="error"
            />
          </a-form>
        </a-card>

        <a-card :bordered="false" class="avatar-preview-panel">
          <template #title>生成预览</template>
          <div class="avatar-preview-stage">
            <img
              v-if="generatedImageUrl && !showLayeredPreview"
              :alt="`${selectedOperator?.name ?? ''}生成头像`"
              class="avatar-generated-image"
              :src="generatedImageUrl"
            />
            <OperatorAvatarDisplay
              v-else-if="
                selectedOperator && selectedAvatarFile && showLayeredPreview
              "
              :data-source="selectedDataSource"
              :elite-level="selectedEliteLevel"
              :mood-scattered="moodScattered"
              :operator-owned="operatorOwned"
              :operator-training-upgraded="operatorTrainingUpgraded"
              :operator="selectedOperator"
              :show-elite-level="showEliteLevel"
              :show-name="showName"
              :show-profession="showProfession"
              :show-rarity="showRarity"
              :plain="true"
              :size="180"
            />
            <div v-else class="avatar-preview-empty">
              <PictureOutlined />
              <strong>{{
                ready ? "配置完成后生成头像" : "正在准备干员数据"
              }}</strong>
              <span>{{ previewDescription }}</span>
            </div>
          </div>

          <div class="avatar-preview-footer">
            <div class="avatar-preview-meta">
              <span v-if="selectedOperator">{{ selectedOperator.name }}</span>
              <span v-if="selectedOperator"
                >{{ rarityLabel(selectedOperator) }} ·
                {{ selectedOperator.profession || "未知职业" }}</span
              >
            </div>
            <div
              v-if="
                generatedImageUrl || (showLayeredPreview && selectedAvatarFile)
              "
              class="avatar-preview-actions"
            >
              <a-button :loading="copying" @click="handleCopyImage">
                <template #icon>
                  <CopyOutlined />
                </template>
                {{ copySuccess ? "已复制" : "复制图片" }}
              </a-button>
              <a-button type="primary" @click="handleDownload">
                <template #icon>
                  <DownloadOutlined />
                </template>
                下载 PNG
              </a-button>
            </div>
          </div>
        </a-card>
      </div>
    </a-spin>
  </div>
</template>
