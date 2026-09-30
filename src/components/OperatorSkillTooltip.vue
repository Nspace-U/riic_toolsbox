<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";

import OperatorSkillCard from "@/components/OperatorSkillCard.vue";
import { useBaseData } from "@/composables/useBaseData";
import type { Operator } from "@/types/baseData";

const props = withDefaults(
  defineProps<{
    operator?: Operator;
    targetTag?: "div" | "span";
  }>(),
  {
    operator: undefined,
    targetTag: "span",
  },
);

const { richTextStyles, terms } = useBaseData();
const open = ref(false);
const targetElement = ref<HTMLElement>();
const contentElement = ref<HTMLDivElement>();
const hasSkillDescriptions = computed(
  () =>
    props.operator?.skills.some((skill) => skill.description.trim()) ?? false,
);

let leaveTimer: ReturnType<typeof setTimeout> | undefined;
let listeningForShortcut = false;

function isTooltipElement(target: EventTarget | null): boolean {
  return (
    target instanceof Node &&
    Boolean(
      targetElement.value?.contains(target) ||
      contentElement.value?.contains(target) ||
      contentElement.value
        ?.closest(".operator-skill-tooltip-overlay")
        ?.contains(target),
    )
  );
}

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    Boolean(target.closest("input, textarea, select, [contenteditable='true']"))
  );
}

function handleWindowKeydown(event: KeyboardEvent): void {
  if (
    !hasSkillDescriptions.value ||
    event.repeat ||
    event.isComposing ||
    event.key.toLowerCase() !== "g" ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    isEditableTarget(event.target) ||
    isEditableTarget(document.activeElement)
  ) {
    return;
  }

  open.value = !open.value;
  event.preventDefault();
}

function startListeningForShortcut(): void {
  if (!hasSkillDescriptions.value || listeningForShortcut) return;
  window.addEventListener("keydown", handleWindowKeydown, true);
  listeningForShortcut = true;
}

function stopListeningForShortcut(): void {
  if (!listeningForShortcut) return;
  window.removeEventListener("keydown", handleWindowKeydown, true);
  listeningForShortcut = false;
}

function clearLeaveTimer(): void {
  if (leaveTimer === undefined) return;
  clearTimeout(leaveTimer);
  leaveTimer = undefined;
}

function handlePointerEnter(): void {
  clearLeaveTimer();
  startListeningForShortcut();
}

function handlePointerLeave(event: MouseEvent): void {
  if (isTooltipElement(event.relatedTarget)) return;
  stopListeningForShortcut();
  clearLeaveTimer();
  leaveTimer = setTimeout(() => {
    open.value = false;
    leaveTimer = undefined;
  }, 160);
}

function cleanup(): void {
  clearLeaveTimer();
  stopListeningForShortcut();
}

onBeforeUnmount(cleanup);
</script>

<template>
  <a-popover
    :open="open && hasSkillDescriptions"
    :trigger="[]"
    :align="{ offset: [-12, 0] }"
    overlay-class-name="operator-skill-tooltip-overlay"
    placement="right"
  >
    <template #content>
      <div
        v-if="operator && hasSkillDescriptions"
        ref="contentElement"
        class="operator-skill-tooltip-content"
        data-operator-skill-tooltip=""
        @mouseenter="handlePointerEnter"
        @mouseleave="handlePointerLeave"
      >
        <OperatorSkillCard
          :operator="operator"
          :rich-text-styles="richTextStyles"
          :terms="terms"
        />
      </div>
    </template>
    <component
      :is="targetTag"
      ref="targetElement"
      class="operator-skill-tooltip-target"
      data-operator-skill-tooltip=""
      @mouseenter="handlePointerEnter"
      @mouseleave="handlePointerLeave"
    >
      <slot />
    </component>
  </a-popover>
</template>
