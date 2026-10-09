<script setup lang="ts">
import type { DisplayTile } from "@arknights/riic-efficiency";
import SimulatorDisplayValue from "@/components/SimulatorDisplayValue.vue";
import { resourceLabel } from "@/utils/simulator/presentation";

const props = withDefaults(
  defineProps<{
    tile: DisplayTile;
    icon?: string;
    accent?: string;
    interactive?: boolean;
  }>(),
  {
    icon: undefined,
    accent: undefined,
    interactive: false,
  },
);

const emit = defineEmits<{ activate: [] }>();

const LINE_CLASSES: Record<string, string> = {
  "gross-points": "simulator-daily-output-gross-points",
  net: "simulator-daily-output-net",
  "sanity-missing": "simulator-daily-output-sanity-missing",
};

function lineClass(key: string): string {
  return LINE_CLASSES[key] ?? "simulator-daily-output-net";
}

function isNetTile(): boolean {
  return props.tile.main.raws?.[0]?.signed === true;
}
</script>

<template>
  <component
    :is="props.interactive ? 'button' : 'div'"
    :class="{
      'simulator-daily-output-item--net': isNetTile(),
      'simulator-daily-output-item--accent': props.accent !== undefined,
      'simulator-daily-output-item--interactive': props.interactive,
    }"
    :style="
      props.accent === undefined
        ? {}
        : { '--simulator-daily-output-accent': props.accent }
    "
    :type="props.interactive ? 'button' : undefined"
    :title="props.interactive ? '查看回收材料日均产量' : undefined"
    :aria-haspopup="props.interactive ? 'dialog' : undefined"
    class="simulator-daily-output-item"
    @click="props.interactive && emit('activate')"
  >
    <img
      v-if="props.icon"
      :alt="props.tile.product ? resourceLabel(props.tile.product) : ''"
      :src="props.icon"
      class="simulator-daily-output-icon"
    />
    <div class="simulator-daily-output-content">
      <strong class="simulator-daily-output-main-value">
        <SimulatorDisplayValue
          :unit="props.tile.mainUnit"
          :value="props.tile.main"
        />
      </strong>
      <div class="simulator-daily-output-card-copy">
        <template v-for="line in props.tile.lines" :key="line.key">
          <strong
            v-if="line.key === 'sanity'"
            class="simulator-daily-output-sanity"
          >
            <SimulatorDisplayValue :value="line.value" />
          </strong>
          <span v-else :class="lineClass(line.key)">
            <SimulatorDisplayValue :value="line.value" />
          </span>
        </template>
      </div>
    </div>
  </component>
</template>
