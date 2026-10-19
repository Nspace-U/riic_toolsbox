<script setup lang="ts">
import type { DisplaySection, DisplayValue } from "@arknights/riic-efficiency";
import { formatDisplayValue } from "@arknights/riic-efficiency";
import SimulatorDisplayValue from "@/components/SimulatorDisplayValue.vue";

type SectionLayout = "grid" | "skill-list" | "mood-list" | "candidate-list";

const props = withDefaults(
  defineProps<{
    section: DisplaySection;
    nested?: boolean;
    iconUrl?: (key: string) => string | undefined;
    sanityIcon?: string;
  }>(),
  {
    nested: false,
    iconUrl: undefined,
    sanityIcon: undefined,
  },
);

function sectionLayout(): SectionLayout {
  const entries = props.section.entries ?? [];
  if (entries.length === 0) {
    return "grid";
  }
  if (entries.some((entry) => entry.cells !== undefined)) {
    return "candidate-list";
  }
  if (entries.some((entry) => entry.value !== undefined)) {
    return "skill-list";
  }
  return "mood-list";
}

const SECTION_CLASSES: Record<string, string> = {
  "queue-sanity": "simulator-daily-output-queue-sanity",
  "dormitory-recovery": "simulator-dormitory-recovery",
};

function sectionClass(): (string | undefined)[] {
  return [
    props.nested ? "simulator-step-subsection" : "simulator-step-section",
    SECTION_CLASSES[props.section.key],
  ];
}

function labelText(value: DisplayValue | undefined): string {
  return value === undefined ? "" : formatDisplayValue(value);
}

function rowIconUrl(rowKey: string): string | undefined {
  if (rowKey === "sanity-total") {
    return props.sanityIcon;
  }
  if (rowKey.startsWith("sanity-")) {
    return props.iconUrl?.(rowKey.slice("sanity-".length));
  }
  return undefined;
}
</script>

<template>
  <component :is="props.nested ? 'div' : 'section'" :class="sectionClass()">
    <span v-if="props.section.label" class="simulator-step-subheading">{{
      props.section.label
    }}</span>
    <div v-if="sectionLayout() === 'grid'" class="simulator-step-detail-grid">
      <template v-for="row in props.section.rows" :key="row.key">
        <span v-if="rowIconUrl(row.key)" class="simulator-sanity-detail-label">
          <img
            :alt="labelText(row.label)"
            :src="rowIconUrl(row.key)"
            class="simulator-daily-output-icon"
          />
          <SimulatorDisplayValue v-if="row.label" :value="row.label" />
        </span>
        <span v-else-if="row.label">
          <SimulatorDisplayValue :value="row.label" />
        </span>
        <span v-else aria-hidden="true"></span>
        <strong>
          <SimulatorDisplayValue v-if="row.value" :value="row.value" />
        </strong>
      </template>
    </div>
    <div
      v-else-if="sectionLayout() === 'skill-list'"
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
      v-else-if="sectionLayout() === 'mood-list'"
      class="simulator-step-detail-grid"
    >
      <template v-for="row in props.section.rows" :key="row.key">
        <span v-if="row.label">
          <SimulatorDisplayValue :value="row.label" />
        </span>
        <span v-else aria-hidden="true"></span>
        <strong>
          <SimulatorDisplayValue v-if="row.value" :value="row.value" />
        </strong>
      </template>
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
          <strong>
            <SimulatorDisplayValue v-if="row.value" :value="row.value" />
          </strong>
        </template>
      </div>
    </div>
    <div v-else class="simulator-drone-candidate-list">
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
      :sanity-icon="props.sanityIcon"
      nested
      :section="child"
    />
  </component>
</template>
