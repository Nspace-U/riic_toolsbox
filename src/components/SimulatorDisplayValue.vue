<script setup lang="ts">
import type {
  DisplayValue,
  DisplayValuePart,
} from "@arknights/riic-efficiency";
import SimulatorNumericValue from "@/components/SimulatorNumericValue.vue";

const props = defineProps<{ value: DisplayValue }>();

function isNumericPart(
  part: DisplayValuePart,
): part is Exclude<DisplayValuePart, string | { text: string }> {
  return typeof part !== "string" && !("text" in part);
}

function partText(part: DisplayValuePart): string {
  if (typeof part === "string") {
    return part;
  }
  return "text" in part ? part.text : "";
}
</script>

<template>
  <template v-for="(part, index) in props.value.parts" :key="index">
    <small v-if="typeof part !== 'string' && part.muted === true">
      <SimulatorNumericValue
        v-if="isNumericPart(part)"
        :mode="part.format"
        :unit="part.unit"
        :value="part.value"
      />
      <template v-else>{{ partText(part) }}</template>
    </small>
    <SimulatorNumericValue
      v-else-if="isNumericPart(part)"
      :mode="part.format"
      :unit="part.unit"
      :value="part.value"
    />
    <template v-else>{{ partText(part) }}</template>
  </template>
</template>
