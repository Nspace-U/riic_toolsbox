<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from "vue";

import type { EliteLevel, Operator } from "@/types/baseData";
import { getOperatorAvatarLayerSources } from "@/utils/operatorAvatar";
import { getOperatorAvatarOverlay } from "@/utils/operatorAvatarOverlay";
import {
  getOperatorAvatarNameFontSize,
  getOperatorAvatarNameFontSizeForWidth,
  getOperatorAvatarNameHeight,
  getOperatorAvatarNameHorizontalPadding,
  getOperatorAvatarNameMinBandMetrics,
  getOperatorAvatarProportionalNameMetrics,
  getOperatorAvatarScale,
  getOperatorAvatarSkippedLabelFontSize,
  OPERATOR_AVATAR_LAYOUT,
  OPERATOR_AVATAR_SOURCE_WIDTH,
} from "@/utils/operatorAvatarLayout";
import type { DataSourceId } from "@/composables/useDataSource";

const props = withDefaults(
  defineProps<{
    operator: Operator;
    dataSource: DataSourceId;
    eliteLevel: EliteLevel;
    showRarity?: boolean;
    showEliteLevel?: boolean;
    showProfession?: boolean;
    showName?: boolean;
    size?: number;
    moodScattered?: boolean;
    moodRemaining?: number;
    operatorOwned?: boolean;
    missing?: boolean;
    operatorTrainingUpgraded?: boolean;
    plain?: boolean;
    proportionalLayout?: boolean;
    skipped?: boolean;
    nameEditing?: boolean;
    displayName?: string;
  }>(),
  {
    showRarity: true,
    showEliteLevel: true,
    showProfession: true,
    showName: false,
    size: 96,
    moodScattered: false,
    moodRemaining: undefined,
    operatorOwned: true,
    missing: false,
    operatorTrainingUpgraded: false,
    plain: false,
    proportionalLayout: false,
    skipped: false,
    nameEditing: false,
    displayName: undefined,
  },
);

type AvatarBadgeKind = "profession" | "elite" | "rarity";

interface NaturalImageSize {
  width: number;
  height: number;
}

const sources = computed(() =>
  getOperatorAvatarLayerSources(
    props.operator,
    props.dataSource,
    props.eliteLevel,
  ),
);

const overlay = computed(() =>
  getOperatorAvatarOverlay(
    props.operatorOwned,
    props.operatorTrainingUpgraded,
    props.moodScattered,
  ),
);

const frameStyle = computed(() => ({
  width: `${props.size}px`,
  height: `${props.size}px`,
}));

const baseNaturalSize = ref<NaturalImageSize>();

const sourceWidth = computed(
  () => baseNaturalSize.value?.width ?? OPERATOR_AVATAR_SOURCE_WIDTH,
);

const avatarScale = computed(() =>
  getOperatorAvatarScale(sourceWidth.value, props.size),
);

const nameHeight = computed(() => {
  if (!props.plain || !props.showName) {
    return 0;
  }
  if (props.proportionalLayout) {
    return getOperatorAvatarNameMinBandMetrics(sourceWidth.value, props.size)
      .height;
  }
  return getOperatorAvatarNameHeight(props.size);
});

function defaultNameFontSize(): number {
  if (props.proportionalLayout) {
    return getOperatorAvatarNameMinBandMetrics(sourceWidth.value, props.size)
      .fontSize;
  }
  return getOperatorAvatarNameFontSize(props.size);
}

const nameFontSize = ref(defaultNameFontSize());
const nameMeasureRef = ref<HTMLSpanElement>();
const badgeNaturalSizes = reactive<
  Partial<Record<AvatarBadgeKind, NaturalImageSize>>
>({});
const renderedName = computed(() => props.displayName ?? props.operator.name);

function updateNameFontSize(): void {
  const measureElement = nameMeasureRef.value;
  if (
    !props.plain ||
    !props.showName ||
    !renderedName.value ||
    !measureElement
  ) {
    nameFontSize.value = defaultNameFontSize();
    return;
  }

  if (props.proportionalLayout) {
    nameFontSize.value = getOperatorAvatarProportionalNameMetrics(
      renderedName.value,
      sourceWidth.value,
      props.size,
      (name, fontSize) => {
        measureElement.textContent = name;
        measureElement.style.fontSize = `${fontSize}px`;
        return measureElement.getBoundingClientRect().width;
      },
    ).fontSize;
    return;
  }

  const fontSize = getOperatorAvatarNameFontSizeForWidth(
    renderedName.value,
    props.size,
    (name, size) => {
      measureElement.textContent = name;
      measureElement.style.fontSize = `${size}px`;
      return measureElement.getBoundingClientRect().width;
    },
  );
  nameFontSize.value = fontSize;
}

function handleBaseImageLoad(event: Event): void {
  const image = event.currentTarget;
  if (image instanceof HTMLImageElement) {
    baseNaturalSize.value = {
      width: image.naturalWidth,
      height: image.naturalHeight,
    };
  }
}

function handleBadgeLoad(kind: AvatarBadgeKind, event: Event): void {
  const image = event.currentTarget;
  if (image instanceof HTMLImageElement) {
    badgeNaturalSizes[kind] = {
      width: image.naturalWidth,
      height: image.naturalHeight,
    };
  }
}

function badgeLength(length: number, scale: number): string {
  return `${Math.round(length * scale * 100) / 100}px`;
}

function badgeStyle(kind: AvatarBadgeKind): Record<string, string> {
  if (!props.plain) {
    return {};
  }

  const naturalSize = badgeNaturalSizes[kind];
  const layoutWidth = props.proportionalLayout ? sourceWidth.value : props.size;
  const scale = props.proportionalLayout ? avatarScale.value : 1;
  if (kind === "profession") {
    const professionSize = Math.round(
      layoutWidth * OPERATOR_AVATAR_LAYOUT.professionSizeRatio,
    );
    return {
      width: badgeLength(professionSize, scale),
      height: badgeLength(professionSize, scale),
    };
  }

  if (kind === "elite") {
    const eliteWidth = Math.round(
      layoutWidth * OPERATOR_AVATAR_LAYOUT.eliteWidthRatio,
    );
    const eliteHeight = naturalSize
      ? Math.round((eliteWidth * naturalSize.height) / naturalSize.width)
      : eliteWidth;
    return {
      width: badgeLength(eliteWidth, scale),
      height: badgeLength(eliteHeight, scale),
    };
  }

  const rarityHeight = Math.round(
    layoutWidth * OPERATOR_AVATAR_LAYOUT.rarityHeightRatio,
  );
  const rarityWidth = naturalSize
    ? Math.round((rarityHeight * naturalSize.width) / naturalSize.height)
    : rarityHeight;
  return {
    width: badgeLength(rarityWidth, scale),
    height: badgeLength(rarityHeight, scale),
  };
}

const displayStyle = computed(() => ({
  ...(props.plain ? { gap: "0" } : {}),
}));

const skippedLabelStyle = computed(() => ({
  fontSize: `${getOperatorAvatarSkippedLabelFontSize(props.size)}px`,
}));

const namePaddingInline = computed(() => {
  return getOperatorAvatarNameHorizontalPadding(nameFontSize.value) / 2;
});

const nameStyle = computed(() =>
  props.plain
    ? {
        width: `${props.size}px`,
        height: `${nameHeight.value}px`,
        color: "#000000",
        fontSize: `${nameFontSize.value}px`,
        fontWeight: "600",
        lineHeight: `${nameHeight.value}px`,
        paddingInline: `${namePaddingInline.value}px`,
      }
    : {},
);

const fallbackName = computed(() => props.operator.name.slice(0, 1) || "?");

const moodRemainingLabel = computed(() => {
  const value = props.moodRemaining;
  return value === undefined || !Number.isFinite(value)
    ? ""
    : String(Math.round(value * 100) / 100);
});

watch(
  [
    () => props.operator.name,
    () => props.displayName,
    () => props.showName,
    () => props.size,
    () => props.plain,
    () => props.proportionalLayout,
    () => sourceWidth.value,
  ],
  () => {
    void nextTick(updateNameFontSize);
  },
  { immediate: true },
);

onMounted(updateNameFontSize);
</script>

<template>
  <div
    :class="{ 'operator-avatar-display--plain': plain }"
    :style="displayStyle"
    class="operator-avatar-display"
  >
    <div
      :class="{ 'operator-avatar-frame--plain': plain }"
      :style="frameStyle"
      class="operator-avatar-frame"
    >
      <img
        v-if="sources.avatarUrl"
        :alt="`${operator.name}头像`"
        class="operator-avatar-base"
        :src="sources.avatarUrl"
        decoding="async"
        @load="handleBaseImageLoad"
      />
      <a-avatar
        v-else
        :size="size"
        class="operator-avatar-fallback"
        shape="square"
      >
        {{ fallbackName }}
      </a-avatar>
      <span
        v-if="overlay === 'unowned'"
        class="operator-avatar-unowned-overlay"
      />
      <span
        v-else-if="overlay === 'training'"
        class="operator-avatar-training-overlay"
      />
      <span
        v-else-if="overlay === 'mood'"
        class="operator-avatar-mood-overlay"
      />
      <img
        v-if="showProfession && sources.professionIconUrl"
        :alt="`${operator.profession}职业`"
        class="operator-avatar-badge operator-avatar-badge--profession"
        :src="sources.professionIconUrl"
        :style="badgeStyle('profession')"
        @load="handleBadgeLoad('profession', $event)"
      />
      <img
        v-if="showEliteLevel"
        :alt="`精英${eliteLevel}`"
        class="operator-avatar-badge operator-avatar-badge--elite"
        :src="sources.eliteIconUrl"
        :style="badgeStyle('elite')"
        @load="handleBadgeLoad('elite', $event)"
      />
      <img
        v-if="showRarity && sources.rarityIconUrl"
        :alt="`${operator.rarity}星`"
        class="operator-avatar-badge operator-avatar-badge--rarity"
        :src="sources.rarityIconUrl"
        :style="badgeStyle('rarity')"
        @load="handleBadgeLoad('rarity', $event)"
      />
      <span
        v-if="moodRemainingLabel"
        :aria-label="`剩余心情 ${moodRemainingLabel}`"
        class="operator-avatar-mood-remaining"
      >
        {{ moodRemainingLabel }}
      </span>
      <span v-if="missing" class="operator-avatar-missing-overlay" />
      <span
        v-if="missing"
        :style="skippedLabelStyle"
        class="operator-avatar-missing-label"
        >缺少</span
      >
      <span
        v-if="skipped && !missing"
        class="operator-avatar-skipped-overlay"
      />
      <span
        v-if="skipped && !missing"
        :style="skippedLabelStyle"
        class="operator-avatar-skipped-label"
        >跳过</span
      >
    </div>
    <span
      v-if="showName"
      :class="{ 'operator-avatar-display-name--editing': nameEditing }"
      :style="nameStyle"
      class="operator-avatar-display-name"
    >
      {{ renderedName }}
    </span>
    <span
      v-if="plain"
      ref="nameMeasureRef"
      aria-hidden="true"
      class="operator-avatar-name-measure"
      >{{ renderedName }}</span
    >
  </div>
</template>
