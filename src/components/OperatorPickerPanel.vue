<script setup lang="ts">
import { computed, ref } from "vue";

import OperatorAvatarDisplay from "@/components/OperatorAvatarDisplay.vue";
import type { EliteLevel, Operator } from "@/types/baseData";

export interface OperatorPickerCandidateView {
  operator: Operator;
  eliteLevel: EliteLevel;
  operatorOwned?: boolean;
  missing?: boolean;
  moodScattered?: boolean;
  operatorTrainingUpgraded?: boolean;
}

const props = withDefaults(
  defineProps<{
    avatarSize: number;
    candidates: OperatorPickerCandidateView[];
    inline?: boolean;
    professionOptions?: string[];
    selectedProfession?: string;
    title: string;
  }>(),
  {
    inline: false,
    professionOptions: () => [],
    selectedProfession: "",
  },
);

const emit = defineEmits<{
  select: [operator: Operator];
  "update:selectedProfession": [profession: string];
}>();

const panelElement = ref<HTMLElement>();

const panelStyle = computed(() => ({
  "--simulator-operator-picker-columns": "6",
  "--simulator-slot-size": `${props.avatarSize}px`,
}));

defineExpose({ panelElement });
</script>

<template>
  <div
    ref="panelElement"
    :class="[
      'simulator-operator-picker',
      { 'operator-picker-panel--inline': inline },
    ]"
    :style="panelStyle"
    @click.stop
    @mousedown.prevent
  >
    <div class="simulator-operator-picker-heading">
      <span>{{ title }}</span>
      <span>{{ candidates.length }}</span>
    </div>
    <div class="simulator-operator-picker-body">
      <div v-if="candidates.length" class="simulator-operator-picker-list">
        <button
          v-for="candidate in candidates"
          :key="candidate.operator.id"
          :aria-label="`选择${candidate.operator.name}`"
          :title="candidate.operator.name"
          class="simulator-operator-picker-item"
          type="button"
          @click="emit('select', candidate.operator)"
        >
          <OperatorAvatarDisplay
            :display-name="candidate.operator.name"
            :elite-level="candidate.eliteLevel"
            :missing="candidate.missing ?? false"
            :mood-scattered="candidate.moodScattered ?? false"
            :operator-owned="candidate.operatorOwned ?? true"
            :operator-training-upgraded="
              candidate.operatorTrainingUpgraded ?? false
            "
            :operator="candidate.operator"
            :plain="true"
            :proportional-layout="true"
            :show-elite-level="true"
            :show-name="true"
            :show-profession="true"
            :show-rarity="true"
            :size="avatarSize"
          />
        </button>
      </div>
      <a-empty
        v-else
        :image="undefined"
        class="simulator-operator-picker-empty"
        description="无匹配干员"
      />
      <div class="simulator-operator-picker-profession-filter">
        <a-button
          :type="selectedProfession ? 'default' : 'primary'"
          size="small"
          @click="emit('update:selectedProfession', '')"
        >
          全部
        </a-button>
        <a-button
          v-for="profession in professionOptions"
          :key="profession"
          :type="selectedProfession === profession ? 'primary' : 'default'"
          size="small"
          @click="emit('update:selectedProfession', profession)"
        >
          {{ profession }}
        </a-button>
      </div>
    </div>
  </div>
</template>
