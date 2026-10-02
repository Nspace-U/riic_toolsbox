<script setup lang="ts">
import type { DisplayCard } from "@arknights/riic-efficiency";
import SimulatorDisplaySection from "@/components/SimulatorDisplaySection.vue";

const props = withDefaults(
  defineProps<{
    card: DisplayCard;
    iconUrl?: (key: string) => string | undefined;
    sanityIcon?: string;
  }>(),
  {
    iconUrl: undefined,
    sanityIcon: undefined,
  },
);
</script>

<template>
  <div v-if="props.card.empty" class="simulator-step-column-empty">
    {{ props.card.empty }}
  </div>
  <div v-else class="simulator-step-content">
    <SimulatorDisplaySection
      v-for="section in props.card.sections"
      :key="section.key"
      :icon-url="props.iconUrl"
      :sanity-icon="props.sanityIcon"
      :section="section"
    />
    <a-empty
      v-if="props.card.emptyNote"
      :description="props.card.emptyNote"
      :image="undefined"
      class="simulator-step-empty"
    />
  </div>
</template>
