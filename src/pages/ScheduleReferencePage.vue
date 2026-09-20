<script setup lang="ts">
import { BookOutlined } from "@ant-design/icons-vue";
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  watch,
} from "vue";
import type { ComponentPublicInstance } from "vue";
import { useRouter } from "vue-router";

import { useScheduleDocuments } from "@/composables/useScheduleDocuments";
import SimulatorPage from "@/pages/SimulatorPage.vue";
import type { StoredDocument } from "@/types/schedule";
import {
  SCHEDULE_IMAGE_RESOLUTIONS,
  type PreparedScheduleImage,
} from "@/utils/simulator/exportImage";
import {
  getScheduleReferencePreview,
  pruneScheduleReferencePreviewCache,
  removeScheduleReferencePreview,
  setScheduleReferencePreview,
  type CachedScheduleReferencePreview,
} from "@/utils/simulator/scheduleReferencePreviewCache";

type PreviewStatus = "idle" | "loading" | "ready" | "error";

interface PreviewState {
  version: string;
  status: PreviewStatus;
  root?: HTMLDivElement;
  cache?: CachedScheduleReferencePreview;
  width: number;
  height: number;
  contentScale: number;
  viewportScale: number;
  error: string;
  requestVersion: number;
}

interface PreviewRenderer {
  prepareScheduleReferenceImage(
    documentId: string,
  ): Promise<PreparedScheduleImage>;
}

const PREVIEW_WIDTH = SCHEDULE_IMAGE_RESOLUTIONS[0].width;
const PREVIEW_HEIGHT = SCHEDULE_IMAGE_RESOLUTIONS[0].height;

const router = useRouter();
const { documents } = useScheduleDocuments();
const simulatorRenderer = ref<PreviewRenderer>();
const previewStates = reactive<Record<string, PreviewState>>({});
const previewViewports = new Map<string, HTMLElement>();
const previewMounts = new Map<string, HTMLElement>();
const previewViewportIds = new WeakMap<HTMLElement, string>();
const previewQueue: string[] = [];
const queuedPreviewIds = new Set<string>();
let previewObserver: IntersectionObserver | undefined;
let previewResizeObserver: ResizeObserver | undefined;
let previewQueueRunning = false;
let previewUnmounted = false;

const hasDocuments = computed(() => documents.value.length > 0);

function createPreviewState(documentId: string, version: string): PreviewState {
  const cache = getScheduleReferencePreview(documentId, version);
  return {
    version,
    status: cache ? "ready" : "idle",
    root: cache?.root,
    cache,
    width: cache?.width ?? PREVIEW_WIDTH,
    height: cache?.height ?? PREVIEW_HEIGHT,
    contentScale: cache?.contentScale ?? 1,
    viewportScale: 1,
    error: "",
    requestVersion: 0,
  };
}

function clearPreviewState(documentId: string, state: PreviewState): void {
  state.requestVersion += 1;
  removeScheduleReferencePreview(documentId);
  state.cache = undefined;
  state.root = undefined;
  state.status = "idle";
  previewMounts.forEach((mount, mountedDocumentId) => {
    if (previewStates[mountedDocumentId] === state) {
      mount.replaceChildren();
    }
  });
}

function ensurePreviewState(stored: StoredDocument): PreviewState {
  const existing = previewStates[stored.id];
  if (existing && existing.version === stored.updatedAt) {
    return existing;
  }
  if (existing) {
    clearPreviewState(stored.id, existing);
  }
  const state = createPreviewState(stored.id, stored.updatedAt);
  previewStates[stored.id] = state;
  return state;
}

function previewState(stored: StoredDocument): PreviewState {
  return ensurePreviewState(stored);
}

function storedDocument(documentId: string): StoredDocument | undefined {
  return documents.value.find((document) => document.id === documentId);
}

function isNearViewport(documentId: string): boolean {
  const viewport = previewViewports.get(documentId);
  if (!viewport) {
    return false;
  }
  const rect = viewport.getBoundingClientRect();
  return rect.bottom >= -400 && rect.top <= window.innerHeight + 400;
}

function updatePreviewViewportScale(documentId: string, width: number): void {
  const state = previewStates[documentId];
  if (!state) {
    return;
  }
  state.viewportScale = width > 0 ? width / PREVIEW_WIDTH : 1;
}

function setPreviewViewport(
  documentId: string,
  element: Element | ComponentPublicInstance | null,
): void {
  const previous = previewViewports.get(documentId);
  if (previous) {
    previewObserver?.unobserve(previous);
    previewResizeObserver?.unobserve(previous);
    previewViewportIds.delete(previous);
  }
  if (!(element instanceof HTMLElement)) {
    previewViewports.delete(documentId);
    return;
  }
  previewViewports.set(documentId, element);
  previewViewportIds.set(element, documentId);
  previewObserver?.observe(element);
  previewResizeObserver?.observe(element);
  updatePreviewViewportScale(documentId, element.clientWidth);
}

function setPreviewMount(
  documentId: string,
  element: Element | ComponentPublicInstance | null,
): void {
  if (element instanceof HTMLElement) {
    previewMounts.set(documentId, element);
    const state = previewStates[documentId];
    if (state?.status === "ready" && state.root) {
      element.replaceChildren(state.root);
    }
    return;
  }
  previewMounts.delete(documentId);
}

function previewZoomStyle(documentId: string): Record<string, string> {
  const state = previewStates[documentId];
  const scale = state?.viewportScale ?? 1;
  return {
    width: `${PREVIEW_WIDTH * scale}px`,
    height: `${PREVIEW_HEIGHT * scale}px`,
  };
}

function previewStageStyle(documentId: string): Record<string, string> {
  const state = previewStates[documentId];
  return {
    transform: `scale(${state?.viewportScale ?? 1})`,
  };
}

function previewContentStyle(documentId: string): Record<string, string> {
  const state = previewStates[documentId];
  return {
    width: `${state?.width ?? PREVIEW_WIDTH}px`,
    height: `${state?.height ?? PREVIEW_HEIGHT}px`,
    insetInlineStart: "0px",
    insetBlockStart: "0px",
    transform: `scale(${state?.contentScale ?? 1})`,
    transformOrigin: "top left",
  };
}

function enqueuePreview(documentId: string): void {
  const stored = storedDocument(documentId);
  if (!stored || previewUnmounted) {
    return;
  }
  const state = ensurePreviewState(stored);
  if (state.status !== "idle" || queuedPreviewIds.has(documentId)) {
    return;
  }
  queuedPreviewIds.add(documentId);
  previewQueue.push(documentId);
  void processPreviewQueue();
}

async function processPreviewQueue(): Promise<void> {
  if (previewQueueRunning || previewUnmounted) {
    return;
  }
  previewQueueRunning = true;
  try {
    while (previewQueue.length > 0 && !previewUnmounted) {
      const documentId = previewQueue.shift();
      if (!documentId) {
        continue;
      }
      queuedPreviewIds.delete(documentId);
      const stored = storedDocument(documentId);
      if (!stored) {
        continue;
      }
      const state = ensurePreviewState(stored);
      if (state.status !== "idle") {
        continue;
      }
      if (previewObserver && !isNearViewport(documentId)) {
        continue;
      }

      state.status = "loading";
      state.error = "";
      const requestVersion = state.requestVersion;
      const documentVersion = stored.updatedAt;
      try {
        const prepared =
          await simulatorRenderer.value?.prepareScheduleReferenceImage(
            documentId,
          );
        const current = storedDocument(documentId);
        if (
          !prepared ||
          previewUnmounted ||
          state.requestVersion !== requestVersion ||
          current?.updatedAt !== documentVersion
        ) {
          prepared?.cleanup();
          continue;
        }

        const width = Math.max(1, prepared.root.offsetWidth);
        const height = Math.max(1, prepared.root.offsetHeight);
        const contentScale = Math.min(
          1,
          PREVIEW_WIDTH / width,
          PREVIEW_HEIGHT / height,
        );
        const cache: CachedScheduleReferencePreview = {
          version: documentVersion,
          root: prepared.root,
          cleanup: prepared.cleanup,
          width,
          height,
          contentScale,
        };
        setScheduleReferencePreview(documentId, cache);
        state.cache = cache;
        state.root = cache.root;
        state.width = cache.width;
        state.height = cache.height;
        state.contentScale = cache.contentScale;
        state.status = "ready";
        previewMounts.get(documentId)?.replaceChildren(prepared.root);
      } catch (error: unknown) {
        if (state.requestVersion === requestVersion && !previewUnmounted) {
          state.status = "error";
          state.error =
            error instanceof Error ? error.message : "排班表预览失败";
        }
      }
      await nextTick();
    }
  } finally {
    previewQueueRunning = false;
  }
}

function handlePreviewIntersection(entries: IntersectionObserverEntry[]): void {
  entries.forEach((entry) => {
    if (!(entry.target instanceof HTMLElement)) {
      return;
    }
    const documentId = previewViewportIds.get(entry.target);
    if (!documentId) {
      return;
    }
    if (entry.isIntersecting) {
      const state = previewStates[documentId];
      if (state?.status === "error") {
        state.status = "idle";
      }
      enqueuePreview(documentId);
    }
  });
}

function handlePreviewResize(entries: ResizeObserverEntry[]): void {
  entries.forEach((entry) => {
    if (!(entry.target instanceof HTMLElement)) {
      return;
    }
    const documentId = previewViewportIds.get(entry.target);
    if (documentId) {
      updatePreviewViewportScale(documentId, entry.contentRect.width);
    }
  });
}

function openSchedule(documentId: string): void {
  void router.push({ name: "simulator", query: { scheduleId: documentId } });
}

async function initializePreviewObservers(): Promise<void> {
  await nextTick();
  if (typeof IntersectionObserver === "undefined") {
    documents.value.forEach((document) => enqueuePreview(document.id));
    return;
  }
  previewObserver = new IntersectionObserver(handlePreviewIntersection, {
    rootMargin: "400px 0px",
  });
  previewResizeObserver = new ResizeObserver(handlePreviewResize);
  previewViewports.forEach((viewport, documentId) => {
    previewObserver?.observe(viewport);
    previewResizeObserver?.observe(viewport);
    updatePreviewViewportScale(documentId, viewport.clientWidth);
  });
}

watch(
  () => documents.value.map(({ id, updatedAt }) => `${id}:${updatedAt}`),
  () => {
    const documentIds = new Set(documents.value.map((document) => document.id));
    pruneScheduleReferencePreviewCache(documentIds);
    Object.entries(previewStates).forEach(([documentId, state]) => {
      if (!documentIds.has(documentId)) {
        clearPreviewState(documentId, state);
        delete previewStates[documentId];
      }
    });
    documents.value.forEach((stored) => {
      const state = previewStates[stored.id];
      if (state && state.version !== stored.updatedAt) {
        clearPreviewState(stored.id, state);
        state.version = stored.updatedAt;
        state.error = "";
        if (isNearViewport(stored.id)) {
          enqueuePreview(stored.id);
        }
      }
    });
  },
);

onMounted(() => {
  pruneScheduleReferencePreviewCache(
    new Set(documents.value.map((document) => document.id)),
  );
  void initializePreviewObservers();
});

onBeforeUnmount(() => {
  previewUnmounted = true;
  previewObserver?.disconnect();
  previewResizeObserver?.disconnect();
  previewObserver = undefined;
  previewResizeObserver = undefined;
  previewQueue.length = 0;
  queuedPreviewIds.clear();
});
</script>

<template>
  <div class="page-shell schedule-reference-page">
    <div class="page-heading">
      <div
        aria-hidden="true"
        class="page-heading-icon schedule-reference-heading-icon"
      >
        <BookOutlined />
      </div>
      <div class="page-heading-copy">
        <a-typography-title :level="2" class="page-title"
          >排班表参考</a-typography-title
        >
        <span class="page-heading-description">查看已保存排班表的图片预览</span>
      </div>
    </div>

    <a-empty v-if="!hasDocuments" :image="undefined" description="暂无排班表" />
    <div v-else class="schedule-reference-grid">
      <a-card
        v-for="document in documents"
        :key="document.id"
        :bordered="false"
        class="schedule-reference-card"
      >
        <template #title>
          <a-typography-link @click="openSchedule(document.id)">
            {{ document.document.title?.trim() || "未命名排班表" }}
          </a-typography-link>
        </template>
        <div
          :ref="(element) => setPreviewViewport(document.id, element)"
          :data-document-id="document.id"
          class="schedule-reference-preview"
        >
          <div
            v-if="previewState(document).status === 'loading'"
            class="schedule-reference-preview-status"
          >
            <a-spin />
          </div>
          <a-result
            v-else-if="previewState(document).status === 'error'"
            class="schedule-reference-preview-status"
            status="warning"
            :sub-title="previewState(document).error"
            title="预览生成失败"
          />
          <a-empty
            v-else-if="previewState(document).status !== 'ready'"
            :image="undefined"
            class="schedule-reference-preview-status"
            description="等待加载预览"
          />
          <div
            :style="previewZoomStyle(document.id)"
            class="schedule-reference-preview-zoom"
          >
            <div
              :style="previewStageStyle(document.id)"
              class="schedule-reference-preview-stage"
            >
              <div
                :style="previewContentStyle(document.id)"
                class="schedule-reference-preview-content"
              >
                <div
                  :ref="(element) => setPreviewMount(document.id, element)"
                />
              </div>
            </div>
          </div>
        </div>
      </a-card>
    </div>

    <div
      v-if="hasDocuments"
      aria-hidden="true"
      class="schedule-reference-renderer"
    >
      <SimulatorPage ref="simulatorRenderer" :preview-only="true" />
    </div>
  </div>
</template>
