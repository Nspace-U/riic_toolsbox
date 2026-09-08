<script setup lang="ts">
import { computed } from 'vue'

import type { EliteLevel, Operator } from '@/types/baseData'
import { getOperatorAvatarLayerSources } from '@/utils/operatorAvatar'
import type { DataSourceId } from '@/composables/useDataSource'

const props = withDefaults(defineProps<{
  operator: Operator
  dataSource: DataSourceId
  eliteLevel: EliteLevel
  showRarity?: boolean
  showEliteLevel?: boolean
  showProfession?: boolean
  showName?: boolean
  size?: number
  moodScattered?: boolean
}>(), {
  showRarity: true,
  showEliteLevel: true,
  showProfession: true,
  showName: false,
  size: 96,
  moodScattered: false,
})

const sources = computed(() => getOperatorAvatarLayerSources(
  props.operator,
  props.dataSource,
  props.eliteLevel,
))

const frameStyle = computed(() => ({
  width: `${props.size}px`,
  height: `${props.size}px`,
}))

const fallbackName = computed(() => props.operator.name.slice(0, 1) || '?')
</script>

<template>
  <div class="operator-avatar-display">
    <div :class="{ 'operator-avatar-frame--scattered': moodScattered }" :style="frameStyle" class="operator-avatar-frame">
      <img
        v-if="sources.avatarUrl"
        :alt="`${operator.name}头像`"
        class="operator-avatar-base"
        :src="sources.avatarUrl"
        decoding="async"
      >
      <a-avatar v-else :size="size" class="operator-avatar-fallback" shape="square">
        {{ fallbackName }}
      </a-avatar>
      <img
        v-if="showProfession && sources.professionIconUrl"
        :alt="`${operator.profession}职业`"
        class="operator-avatar-badge operator-avatar-badge--profession"
        :src="sources.professionIconUrl"
      >
      <img
        v-if="showEliteLevel"
        :alt="`精英${eliteLevel}`"
        class="operator-avatar-badge operator-avatar-badge--elite"
        :src="sources.eliteIconUrl"
      >
      <img
        v-if="showRarity && sources.rarityIconUrl"
        :alt="`${operator.rarity}星`"
        class="operator-avatar-badge operator-avatar-badge--rarity"
        :src="sources.rarityIconUrl"
      >
    </div>
    <span v-if="showName" class="operator-avatar-display-name">{{ operator.name }}</span>
  </div>
</template>