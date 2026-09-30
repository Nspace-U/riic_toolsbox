<script setup lang="ts">
import OperatorAvatarDisplay from "@/components/OperatorAvatarDisplay.vue";
import OperatorSkillTooltip from "@/components/OperatorSkillTooltip.vue";
import type { EliteLevel, Operator } from "@/types/baseData";

defineOptions({ inheritAttrs: false });

const props = withDefaults(
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
    nameInputVisible?: boolean;
    nameInputValue?: string;
    nameInputPending?: boolean;
    nameEditing?: boolean;
    nameBandStyle?: Record<string, string>;
    emptySlotFrameStyle?: Record<string, string>;
    skippedLabelStyle?: Record<string, string>;
    roomType?: string;
    roomLabel?: string;
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
    nameInputVisible: false,
    nameInputValue: undefined,
    nameInputPending: false,
    nameEditing: undefined,
    nameBandStyle: undefined,
    emptySlotFrameStyle: undefined,
    skippedLabelStyle: undefined,
    roomType: undefined,
    roomLabel: undefined,
  },
);

const emit = defineEmits<{
  click: [event: MouseEvent];
  dblclick: [event: MouseEvent];
  contextmenu: [event: MouseEvent];
  input: [event: Event];
  "input-click": [event: MouseEvent];
  focus: [event: FocusEvent];
  blur: [];
  keyup: [event: KeyboardEvent];
  mouseup: [event: MouseEvent];
  select: [event: Event];
}>();

function frameStyle(): Record<string, string> {
  return (
    props.emptySlotFrameStyle ?? {
      width: `${props.size}px`,
      height: `${props.size}px`,
    }
  );
}

function nameStyle(): Record<string, string> {
  return props.nameBandStyle ?? { width: `${props.size}px` };
}

function showAvatar(): boolean {
  return Boolean(props.operator || props.specialLabel);
}
</script>

<template>
  <OperatorSkillTooltip
    v-if="showAvatar()"
    :operator="operator"
    target-tag="div"
  >
    <OperatorAvatarDisplay
      :display-name="displayName"
      :elite-level="eliteLevel"
      :missing="missing"
      :mood-remaining="moodRemaining"
      :mood-scattered="moodScattered"
      :name-editing="nameEditing ?? nameInputVisible"
      :operator-owned="operatorOwned"
      :operator-training-upgraded="operatorTrainingUpgraded"
      :operator="operator"
      :plain="true"
      :proportional-layout="true"
      :show-elite-level="Boolean(operator)"
      :show-name="true"
      :show-profession="Boolean(operator)"
      :show-rarity="Boolean(operator)"
      :size="size"
      :skipped="skipped"
      :special-label="specialLabel"
      @click.stop="emit('click', $event)"
      @contextmenu.stop.prevent="emit('contextmenu', $event)"
      @dblclick.stop="emit('dblclick', $event)"
    />
  </OperatorSkillTooltip>
  <template v-else>
    <div
      :style="frameStyle()"
      class="simulator-empty-slot-frame"
      @click.stop="emit('click', $event)"
      @contextmenu.stop.prevent="emit('contextmenu', $event)"
      @dblclick.stop="emit('dblclick', $event)"
    >
      <template v-if="skipped">
        <span class="operator-avatar-skipped-overlay" />
        <span :style="skippedLabelStyle" class="operator-avatar-skipped-label"
          >跳过</span
        >
      </template>
    </div>
    <span
      :class="{ 'simulator-empty-slot-name--editing': nameInputVisible }"
      :style="nameStyle()"
      class="simulator-empty-slot-name"
      @click.stop="emit('click', $event)"
      @contextmenu.stop.prevent="emit('contextmenu', $event)"
      @dblclick.stop="emit('dblclick', $event)"
      >{{ displayName || "空槽位" }}</span
    >
  </template>
  <input
    v-if="nameInputVisible"
    :aria-label="`${roomLabel ?? roomType ?? ''}干员名称`"
    :class="{
      'simulator-slot-name-input--pending': nameInputPending,
    }"
    :data-slot-key="slotKey"
    :placeholder="nameInputPending && !displayName ? '空槽位' : undefined"
    :style="nameStyle()"
    :value="nameInputValue ?? displayName"
    autocomplete="off"
    class="simulator-slot-name-input"
    type="text"
    @blur="emit('blur')"
    @click.stop="emit('input-click', $event)"
    @contextmenu.stop.prevent="emit('contextmenu', $event)"
    @dblclick.stop="emit('dblclick', $event)"
    @focus="emit('focus', $event)"
    @input="emit('input', $event)"
    @keyup="emit('keyup', $event)"
    @mouseup="emit('mouseup', $event)"
    @select="emit('select', $event)"
  />
</template>
