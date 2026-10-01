<script setup lang="ts">
import type { DisplaySection } from "@arknights/riic-efficiency";
import SimulatorDisplayValue from "@/components/SimulatorDisplayValue.vue";

const props = withDefaults(
  defineProps<{
    section: DisplaySection;
    nested?: boolean;
    iconUrl?: (key: string) => string | undefined;
  }>(),
  {
    nested: false,
    iconUrl: undefined,
  },
);

function sectionIconUrl(key: string): string | undefined {
  return props.iconUrl?.(key);
}

const SECTION_CLASSES: Record<string, string> = {
  "queue-sanity": "simulator-daily-output-queue-sanity",
};

function sectionClass(): (string | undefined)[] {
  return [
    props.nested ? "simulator-step-subsection" : "simulator-step-section",
    SECTION_CLASSES[props.section.key],
  ];
}
</script>

<template>
  <component :is="props.nested ? 'div' : 'section'" :class="sectionClass()">
    <span v-if="props.section.label" class="simulator-step-subheading">{{
      props.section.label
    }}</span>
    <div
      v-if="props.section.kind === 'grid'"
      class="simulator-step-detail-grid"
    >
      <template v-for="row in props.section.rows" :key="row.key">
        <span v-if="row.icon" class="simulator-sanity-detail-label">
          <img
            v-if="sectionIconUrl(row.icon)"
            :alt="row.label?.text ?? ''"
            :src="sectionIconUrl(row.icon)"
            class="simulator-daily-output-icon"
          />
          <SimulatorDisplayValue v-if="row.label" :value="row.label" />
        </span>
        <SimulatorDisplayValue v-else-if="row.label" :value="row.label" />
        <span v-else aria-hidden="true"></span>
        <span v-if="row.muted" class="simulator-sanity-missing">
          <SimulatorDisplayValue v-if="row.value" :value="row.value" />
        </span>
        <strong v-else-if="row.emphasis !== false">
          <SimulatorDisplayValue v-if="row.value" :value="row.value" />
        </strong>
        <span v-else>
          <SimulatorDisplayValue v-if="row.value" :value="row.value" />
        </span>
      </template>
    </div>
    <div
      v-else-if="props.section.kind === 'skill-list'"
      class="simulator-skill-detail-list"
    >
      <div
        v-for="entry in props.section.entries"
        :key="entry.key"
        class="simulator-skill-detail-row"
      >
        <span>
          <SimulatorDisplayValue v-if="entry.title" :value="entry.title" />
        </span>
        <span>
          <SimulatorDisplayValue v-if="entry.value" :value="entry.value" />
        </span>
        <div
          v-if="entry.rows.length"
          class="simulator-skill-detail-calculation"
        >
          <div
            v-for="row in entry.rows"
            :key="row.key"
            class="simulator-skill-detail-calculation-row"
          >
            <span
              v-if="row.label"
              class="simulator-skill-detail-calculation-label"
            >
              <SimulatorDisplayValue :value="row.label" />
            </span>
            <span v-else aria-hidden="true"></span>
            <span>
              <SimulatorDisplayValue v-if="row.value" :value="row.value" />
            </span>
          </div>
        </div>
      </div>
    </div>
    <div
      v-else-if="props.section.kind === 'mood-list'"
      class="simulator-step-detail-grid"
    >
      <div
        v-for="entry in props.section.entries"
        :key="entry.key"
        class="simulator-mood-detail-row"
      >
        <strong class="simulator-mood-operator">
          <SimulatorDisplayValue v-if="entry.title" :value="entry.title" />
        </strong>
        <template v-for="row in entry.rows" :key="row.key">
          <span v-if="row.label">
            <SimulatorDisplayValue :value="row.label" />
          </span>
          <span v-else aria-hidden="true"></span>
          <strong v-if="row.emphasis !== false">
            <SimulatorDisplayValue v-if="row.value" :value="row.value" />
          </strong>
          <span v-else>
            <SimulatorDisplayValue v-if="row.value" :value="row.value" />
          </span>
        </template>
      </div>
    </div>
    <div
      v-else-if="props.section.kind === 'candidate-list'"
      class="simulator-drone-candidate-list"
    >
      <div
        v-for="entry in props.section.entries"
        :key="entry.key"
        class="simulator-drone-candidate-row"
      >
        <span class="simulator-drone-candidate-facility">
          <SimulatorDisplayValue
            v-if="entry.cells?.[0]"
            :value="entry.cells[0]"
          />
        </span>
        <span class="simulator-drone-candidate-product">
          <SimulatorDisplayValue
            v-if="entry.cells?.[1]"
            :value="entry.cells[1]"
          />
        </span>
        <span class="simulator-drone-candidate-value">
          <SimulatorDisplayValue
            v-if="entry.cells?.[2]"
            :value="entry.cells[2]"
          />
        </span>
        <span class="simulator-drone-candidate-value">
          <SimulatorDisplayValue
            v-if="entry.cells?.[3]"
            :value="entry.cells[3]"
          />
        </span>
      </div>
    </div>
    <SimulatorDisplaySection
      v-for="child in props.section.sections"
      :key="child.key"
      :icon-url="props.iconUrl"
      nested
      :section="child"
    />
  </component>
</template>
