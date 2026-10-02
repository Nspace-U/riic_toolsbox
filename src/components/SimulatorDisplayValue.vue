<script setup lang="ts">
import { computed } from "vue";

import type { DisplayValue } from "@arknights/riic-efficiency";
import SimulatorNumericValue from "@/components/SimulatorNumericValue.vue";

const props = defineProps<{ value: DisplayValue }>();

interface DisplaySegment {
  key: string;
  text: string;
  raw?: { value: number; signed: boolean };
  unit?: string;
}

const segments = computed<DisplaySegment[]>(() => {
  const template = props.value.template;
  const raws = props.value.raws ?? [];
  const result: DisplaySegment[] = [];
  const matches = [...template.matchAll(/\{(\d+)\}/g)];
  let cursor = 0;
  matches.forEach((match, order) => {
    const index = match.index ?? cursor;
    if (index > cursor) {
      result.push({
        key: `text-${order}`,
        text: template.slice(cursor, index),
      });
    }
    const rawIndex = Number(match[1]);
    cursor = index + match[0].length;
    const rest = template.slice(cursor);
    const nextIndex = rest.search(/\{(\d+)\}/);
    const following = nextIndex < 0 ? rest : rest.slice(0, nextIndex);
    const raw = raws[rawIndex];
    result.push({
      key: `raw-${rawIndex}-${order}`,
      text: "",
      ...(raw === undefined
        ? {}
        : { raw: { value: raw.value, signed: raw.signed === true } }),
      unit: following.trimStart().split(/\s+/)[0] ?? "",
    });
  });
  if (cursor < template.length) {
    result.push({ key: "text-end", text: template.slice(cursor) });
  }
  return result;
});
</script>

<template>
  <template v-for="segment in segments" :key="segment.key">
    <SimulatorNumericValue
      v-if="segment.raw"
      :mode="segment.raw.signed ? 'signed' : 'number'"
      :unit="segment.unit"
      :value="segment.raw.value"
    /><template v-else>{{ segment.text }}</template>
  </template>
</template>
