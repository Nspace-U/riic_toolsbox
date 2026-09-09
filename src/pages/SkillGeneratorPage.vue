<script setup lang="ts">
import {
  CopyOutlined,
  DownloadOutlined,
  BookOutlined,
  ReloadOutlined,
} from "@ant-design/icons-vue";
import { toSvg } from "html-to-image";
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";

import OperatorSkillCard from "@/components/OperatorSkillCard.vue";
import { useBaseData } from "@/composables/useBaseData";
import { useDataSource } from "@/composables/useDataSource";
import type { Operator, OperatorSkill } from "@/types/baseData";

const { operators, richTextStyles, terms, loading, ready, reload } =
  useBaseData();
const { selectedDataSource } = useDataSource();

const selectedOperatorId = ref("");
const showOperatorId = ref(true);
const showTerms = ref(true);
const showTermDefinitions = ref(true);
const showReplaced = ref(false);
const generating = ref(false);
const generationError = ref("");
const generatedImageUrl = ref("");
const copying = ref(false);
const copyError = ref("");
const copySuccess = ref(false);
const skillCardSource = ref<HTMLDivElement>();

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

const visibleSkills = computed<OperatorSkill[]>(() => {
  return (
    selectedOperator.value?.skills.filter((skill) => {
      return showReplaced.value || !skill.replacement.includes("被「");
    }) ?? []
  );
});

const visibleSkillLabel = computed(() =>
  showReplaced.value ? "技能" : "常规技能",
);

const previewDescription = computed(() => {
  if (!selectedOperator.value) {
    return "读取数据后选择干员";
  }
  return `${selectedOperator.value.name} · ${visibleSkills.value.length} 条技能`;
});

function clearGeneratedImage(): void {
  if (generatedImageUrl.value) {
    generatedImageUrl.value = "";
  }
}

function handleReload(): void {
  void reload();
}

function updateSelectedOperator(value: Operator[]): void {
  if (!value.some((operator) => operator.id === selectedOperatorId.value)) {
    selectedOperatorId.value = value[0]?.id ?? "";
  }
}

async function svgToPng(source: HTMLDivElement): Promise<string> {
  const svgUrl = await toSvg(source, {
    cacheBust: true,
    skipFonts: true,
    style: {
      inset: "auto",
      position: "static",
      width: "900px",
    },
  });

  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const pixelRatio = 2;
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth * pixelRatio;
      canvas.height = image.naturalHeight * pixelRatio;
      const context = canvas.getContext("2d");
      if (!context) {
        reject(new Error("当前浏览器不支持图片画布"));
        return;
      }

      context.fillStyle = "#f4f6f7";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/png"));
    };
    image.onerror = () => reject(new Error("技能图片渲染失败"));
    image.src = svgUrl;
  });
}

async function waitForSourceImages(): Promise<void> {
  const images = skillCardSource.value?.querySelectorAll("img") ?? [];
  await Promise.all(
    [...images].map((image) => {
      if (image.complete) {
        return Promise.resolve();
      }
      return new Promise<void>((resolve) => {
        image.addEventListener("load", () => resolve(), { once: true });
        image.addEventListener("error", () => resolve(), { once: true });
      });
    }),
  );
}

let generationRequestId = 0;

async function generateImage(): Promise<void> {
  if (!selectedOperator.value) {
    clearGeneratedImage();
    return;
  }

  const requestId = ++generationRequestId;
  generating.value = true;
  clearGeneratedImage();
  generationError.value = "";

  try {
    await nextTick();
    const source = skillCardSource.value;
    if (!source) {
      return;
    }

    await waitForSourceImages();
    const dataUrl = await svgToPng(source);
    if (requestId !== generationRequestId) {
      return;
    }

    generatedImageUrl.value = dataUrl;
  } catch (error: unknown) {
    if (requestId === generationRequestId) {
      generationError.value =
        error instanceof Error ? error.message : "技能图片生成失败";
      clearGeneratedImage();
    }
  } finally {
    if (requestId === generationRequestId) {
      generating.value = false;
    }
  }
}

function handleDownload(): void {
  if (!generatedImageUrl.value || !selectedOperator.value) {
    return;
  }

  const link = document.createElement("a");
  link.href = generatedImageUrl.value;
  link.download = `${selectedOperator.value.name}-基建技能.png`;
  link.click();
}

async function handleCopyImage(): Promise<void> {
  if (!generatedImageUrl.value || copying.value) {
    return;
  }

  copying.value = true;
  copyError.value = "";
  copySuccess.value = false;

  try {
    if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
      throw new Error("当前浏览器不支持复制图片，请使用下载 PNG");
    }

    const response = await fetch(generatedImageUrl.value);
    const imageBlob = await response.blob();
    await navigator.clipboard.write([
      new ClipboardItem({ "image/png": imageBlob }),
    ]);
    copySuccess.value = true;
  } catch (error: unknown) {
    copyError.value =
      error instanceof Error ? error.message : "图片复制失败，请使用下载 PNG";
  } finally {
    copying.value = false;
  }
}

watch(operators, updateSelectedOperator, { immediate: true });
watch(
  [
    operators,
    terms,
    selectedOperatorId,
    showOperatorId,
    showTerms,
    showTermDefinitions,
    showReplaced,
    selectedDataSource,
  ],
  () => {
    generationError.value = "";
    copyError.value = "";
    copySuccess.value = false;
    void generateImage();
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  generationRequestId += 1;
  clearGeneratedImage();
});
</script>

<template>
  <div class="page-shell skill-generator-page">
    <div class="page-heading">
      <div class="page-heading-icon" aria-hidden="true">
        <BookOutlined />
      </div>
      <div class="page-heading-copy">
        <a-typography-title :level="2" class="page-title"
          >技能生成器</a-typography-title
        >
        <span class="page-heading-description"
          >选择干员和显示信息，生成基建技能图片</span
        >
      </div>
    </div>

    <a-spin :spinning="loading" tip="读取干员数据中...">
      <a-alert
        v-if="generationError"
        :message="generationError"
        class="skill-generator-alert"
        show-icon
        type="error"
      />

      <div class="skill-generator-layout">
        <a-card :bordered="false" class="skill-generator-panel">
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
            <a-form-item label="干员名称">
              <a-select
                v-model:value="selectedOperatorId"
                :options="operatorOptions"
                :show-search="true"
                class="skill-operator-select"
                option-filter-prop="label"
                placeholder="选择干员"
              />
            </a-form-item>

            <a-divider orientation="left">技能信息</a-divider>
            <div class="skill-generator-checkboxes">
              <a-checkbox v-model:checked="showOperatorId"
                >显示干员 ID</a-checkbox
              >
              <a-checkbox v-model:checked="showTerms">显示所属术语</a-checkbox>
              <a-checkbox
                v-model:checked="showTermDefinitions"
                :disabled="!showTerms"
                >显示术语描述</a-checkbox
              >
              <a-checkbox v-model:checked="showReplaced"
                >显示被替换技能</a-checkbox
              >
            </div>

            <a-alert
              v-if="copyError"
              :message="copyError"
              class="skill-generator-warning"
              show-icon
              type="error"
            />
          </a-form>
        </a-card>

        <a-card :bordered="false" class="skill-preview-panel">
          <template #title>生成预览</template>
          <div class="skill-preview-stage">
            <img
              v-if="generatedImageUrl"
              :alt="`${selectedOperator?.name ?? ''}基建技能图片`"
              class="skill-generated-image"
              :src="generatedImageUrl"
            />
            <div v-else class="skill-preview-empty">
              <BookOutlined />
              <strong>{{
                ready ? "配置完成后生成技能图片" : "正在准备干员数据"
              }}</strong>
              <span>{{ previewDescription }}</span>
            </div>
          </div>

          <div class="skill-preview-footer">
            <div class="skill-preview-meta">
              <span v-if="selectedOperator">{{ selectedOperator.name }}</span>
              <span v-if="selectedOperator"
                >{{ visibleSkills.length }} 条{{ visibleSkillLabel }}</span
              >
            </div>
            <div v-if="generatedImageUrl" class="skill-preview-actions">
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

    <div
      v-if="selectedOperator"
      ref="skillCardSource"
      aria-hidden="true"
      class="skill-generator-render-source"
    >
      <OperatorSkillCard
        :data-source="selectedDataSource"
        :operator="selectedOperator"
        :show-operator-id="showOperatorId"
        :show-term-definitions="showTermDefinitions"
        :show-terms="showTerms"
        :rich-text-styles="richTextStyles"
        :skills="visibleSkills"
        :terms="terms"
      />
    </div>
  </div>
</template>
