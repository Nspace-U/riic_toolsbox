<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from "vue";

import type { EliteLevel, Operator } from "@/types/baseData";
import { getOperatorAvatarLayerSources } from "@/utils/operatorAvatar";
import {
  getOperatorAvatarNameFontSize,
  getOperatorAvatarNameFontSizeForWidth,
  getOperatorAvatarNameHeight,
  OPERATOR_AVATAR_LAYOUT,
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
    operatorOwned?: boolean;
    operatorTrainingUpgraded?: boolean;
    plain?: boolean;
  }>(),
  {
    showRarity: true,
    showEliteLevel: true,
    showProfession: true,
    showName: false,
    size: 96,
    moodScattered: false,
    operatorOwned: true,
    operatorTrainingUpgraded: false,
    plain: false,
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

const frameStyle = computed(() => ({
  width: `${props.size}px`,
  height: `${props.size}px`,
}));

const nameHeight = computed(() =>
  props.plain && props.showName ? getOperatorAvatarNameHeight(props.size) : 0,
);
const nameFontSize = ref(getOperatorAvatarNameFontSize(nameHeight.value));
const nameMeasureRef = ref<HTMLSpanElement>();
const badgeNaturalSizes = reactive<
  Partial<Record<AvatarBadgeKind, NaturalImageSize>>
>({});

function updateNameFontSize(): void {
  const measureElement = nameMeasureRef.value;
  if (
    !props.plain ||
    !props.showName ||
    !props.operator.name ||
    !measureElement
  ) {
    nameFontSize.value = getOperatorAvatarNameFontSize(nameHeight.value);
    return;
  }

  const maxTextWidth = Math.max(
    1,
    props.size - OPERATOR_AVATAR_LAYOUT.nameHorizontalPadding,
  );
  const fontSize = getOperatorAvatarNameFontSizeForWidth(
    props.operator.name,
    nameHeight.value,
    maxTextWidth,
    (name, size) => {
      measureElement.textContent = name;
      measureElement.style.fontSize = `${size}px`;
      return measureElement.getBoundingClientRect().width;
    },
  );
  nameFontSize.value = fontSize;
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

function badgeStyle(kind: AvatarBadgeKind): Record<string, string> {
  if (!props.plain) {
    return {};
  }

  const naturalSize = badgeNaturalSizes[kind];
  if (kind === "profession") {
    const professionSize = Math.round(
      props.size * OPERATOR_AVATAR_LAYOUT.professionSizeRatio,
    );
    return {
      width: `${professionSize}px`,
      height: `${professionSize}px`,
    };
  }

  if (kind === "elite") {
    const eliteWidth = Math.round(
      props.size * OPERATOR_AVATAR_LAYOUT.eliteWidthRatio,
    );
    return {
      width: `${eliteWidth}px`,
      height: `${naturalSize ? Math.round((eliteWidth * naturalSize.height) / naturalSize.width) : eliteWidth}px`,
    };
  }

  const rarityHeight = Math.round(
    props.size * OPERATOR_AVATAR_LAYOUT.rarityHeightRatio,
  );
  return {
    width: `${naturalSize ? Math.round((rarityHeight * naturalSize.width) / naturalSize.height) : rarityHeight}px`,
    height: `${rarityHeight}px`,
  };
}

const displayStyle = computed(() => ({
  ...(props.plain ? { gap: "0" } : {}),
}));

const nameStyle = computed(() =>
  props.plain
    ? {
        width: `${props.size}px`,
        height: `${nameHeight.value}px`,
        color: "#000000",
        fontSize: `${nameFontSize.value}px`,
        fontWeight: "600",
        lineHeight: `${nameHeight.value}px`,
      }
    : {},
);

const fallbackName = computed(() => props.operator.name.slice(0, 1) || "?");

watch(
  [
    () => props.operator.name,
    () => props.showName,
    () => props.size,
    () => props.plain,
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
      />
      <a-avatar
        v-else
        :size="size"
        class="operator-avatar-fallback"
        shape="square"
      >
        {{ fallbackName }}
      </a-avatar>
      <span v-if="!operatorOwned" class="operator-avatar-unowned-overlay" />
      <span
        v-if="operatorTrainingUpgraded"
        class="operator-avatar-training-overlay"
      />
      <span v-if="moodScattered" class="operator-avatar-mood-overlay" />
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
    </div>
    <span
      v-if="showName"
      :style="nameStyle"
      class="operator-avatar-display-name"
    >
      {{ operator.name }}
    </span>
    <span
      v-if="plain"
      ref="nameMeasureRef"
      aria-hidden="true"
      class="operator-avatar-name-measure"
      >{{ operator.name }}</span
    >
  </div>
</template>
