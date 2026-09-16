<script setup lang="ts">
import { computed } from "vue";

import { useNumericTooltipSettings } from "@/composables/useNumericTooltipSettings";
import {
  formatEfficiencyNumber,
  formatNumber,
  formatProduction,
  signedNumber,
} from "@/utils/simulator/presentation";

type NumericValueMode = "number" | "production" | "efficiency" | "signed";

const props = withDefaults(
  defineProps<{
    value: number;
    mode?: NumericValueMode;
    unit?: string;
  }>(),
  {
    mode: "number",
    unit: "",
  },
);

const { numericTooltipEnabled } = useNumericTooltipSettings();

const displayValue = computed(() => {
  switch (props.mode) {
    case "production":
      return formatProduction(props.value);
    case "efficiency":
      return formatEfficiencyNumber(props.value);
    case "signed":
      return signedNumber(props.value);
    default:
      return formatNumber(props.value);
  }
});

const rawValue = computed(() => {
  const value = String(props.value);
  switch (props.mode) {
    case "efficiency":
      return props.value < 0 ? `-${String(Math.abs(props.value))}` : value;
    case "signed":
      return props.value >= 0 ? `+${value}` : value;
    default:
      return value;
  }
});

const showRawValueTooltip = computed(
  () => numericTooltipEnabled.value && displayValue.value !== rawValue.value,
);

const tooltipTitle = computed(() => `原始值：${rawValue.value}${props.unit}`);
</script>

<template>
  <a-tooltip v-if="showRawValueTooltip" :title="tooltipTitle">
    <span>{{ displayValue }}</span>
  </a-tooltip>
  <span v-else>{{ displayValue }}</span>
</template>
