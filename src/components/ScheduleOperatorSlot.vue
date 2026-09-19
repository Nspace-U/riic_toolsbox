<script setup lang="ts">
import ScheduleOperatorSlotContent from "@/components/ScheduleOperatorSlotContent.vue";
import type { EliteLevel, Operator } from "@/types/baseData";

withDefaults(
  defineProps<{
    slotKey: string;
    displayName: string;
    operator?: Operator;
    eliteLevel: EliteLevel;
    size: number;
    specialLabel?: string;
    operatorOwned?: boolean;
    missing?: boolean;
    moodScattered?: boolean;
    moodRemaining?: number;
    operatorTrainingUpgraded?: boolean;
    skipped?: boolean;
    selected?: boolean;
    hovered?: boolean;
    clipboard?: boolean;
    pasteHighlighted?: boolean;
    nameInputVisible?: boolean;
    nameInputValue?: string;
    nameInputPending?: boolean;
    nameEditing?: boolean;
    nameBandStyle?: Record<string, string>;
    emptySlotFrameStyle?: Record<string, string>;
    skippedLabelStyle?: Record<string, string>;
    title?: string;
    planIndex?: number;
    position?: number;
    roomType?: string;
    roomLabel?: string;
    slotIndex?: number;
    exportOriginalName?: string;
  }>(),
  {
    operator: undefined,
    specialLabel: undefined,
    operatorOwned: true,
    missing: false,
    moodScattered: false,
    moodRemaining: undefined,
    operatorTrainingUpgraded: false,
    skipped: false,
    selected: false,
    hovered: false,
    clipboard: false,
    pasteHighlighted: false,
    nameInputVisible: false,
    nameInputValue: undefined,
    nameInputPending: false,
    nameEditing: undefined,
    nameBandStyle: undefined,
    emptySlotFrameStyle: undefined,
    skippedLabelStyle: undefined,
    title: undefined,
    planIndex: undefined,
    position: undefined,
    roomType: undefined,
    roomLabel: undefined,
    slotIndex: undefined,
    exportOriginalName: undefined,
  },
);

const emit = defineEmits<{
  click: [event: MouseEvent];
  dblclick: [event: MouseEvent];
  contextmenu: [event: MouseEvent];
  mouseenter: [];
  mouseleave: [];
  input: [event: Event];
  "input-click": [event: MouseEvent];
  focus: [event: FocusEvent];
  blur: [];
  keyup: [event: KeyboardEvent];
  mouseup: [event: MouseEvent];
  select: [event: Event];
}>();
</script>

<template>
  <div
    :class="[
      'simulator-slot',
      {
        'simulator-slot--selected': selected,
        'simulator-slot--hovered': hovered,
        'simulator-slot--clipboard': clipboard,
        'simulator-slot--paste-highlight': pasteHighlighted,
      },
    ]"
    :data-export-original-name="exportOriginalName"
    :data-export-plan-index="planIndex"
    :data-export-position="position"
    :data-export-room-type="roomType"
    :data-export-slot-index="slotIndex"
    :data-key="slotKey"
    :data-position="position"
    :data-slot-index="slotIndex"
    :data-type="roomType"
    :title="title ?? (displayName || '空槽位')"
    @click.stop="emit('click', $event)"
    @contextmenu.stop.prevent="emit('contextmenu', $event)"
    @dblclick.stop="emit('dblclick', $event)"
    @mouseenter="emit('mouseenter')"
    @mouseleave="emit('mouseleave')"
  >
    <ScheduleOperatorSlotContent
      v-bind="$props"
      @blur="emit('blur')"
      @click="emit('click', $event)"
      @contextmenu="emit('contextmenu', $event)"
      @dblclick="emit('dblclick', $event)"
      @focus="emit('focus', $event)"
      @input="emit('input', $event)"
      @input-click="emit('input-click', $event)"
      @keyup="emit('keyup', $event)"
      @mouseup="emit('mouseup', $event)"
      @select="emit('select', $event)"
    />
  </div>
</template>
