<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, unref } from "vue";

import OperatorPickerPanel, {
  type OperatorPickerCandidateView,
} from "@/components/OperatorPickerPanel.vue";

defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    avatarSize: number;
    candidates: OperatorPickerCandidateView[];
    inline?: boolean;
    professionOptions?: string[];
    selectedProfession?: string;
    title: string;
    dismissOnOutside?: boolean;
  }>(),
  {
    inline: false,
    professionOptions: () => [],
    selectedProfession: "",
    dismissOnOutside: true,
  },
);

const emit = defineEmits<{
  select: [candidate: OperatorPickerCandidateView["operator"]];
  "update:selected-profession": [profession: string];
  outside: [];
}>();

const panel = ref<{ panelElement?: HTMLElement }>();
const panelElement = computed(() => unref(panel.value?.panelElement));

defineExpose({ panelElement });

function handleWindowClick(event: MouseEvent): void {
  if (!props.dismissOnOutside) return;
  const target = event.target;
  if (target instanceof Node && panelElement.value?.contains(target)) {
    return;
  }
  if (
    target instanceof Element &&
    target.closest(".simulator-slot[data-key]")
  ) {
    return;
  }
  if (target instanceof Element && target.closest(".simulator-context-menu")) {
    return;
  }
  emit("outside");
}

onMounted(() => {
  window.addEventListener("click", handleWindowClick);
});

onBeforeUnmount(() => {
  window.removeEventListener("click", handleWindowClick);
});
</script>

<template>
  <OperatorPickerPanel
    ref="panel"
    :avatar-size="avatarSize"
    :candidates="candidates"
    :inline="inline"
    :profession-options="professionOptions"
    :selected-profession="selectedProfession"
    :title="title"
    v-bind="$attrs"
    @select="emit('select', $event)"
    @update:selected-profession="emit('update:selected-profession', $event)"
  />
</template>
