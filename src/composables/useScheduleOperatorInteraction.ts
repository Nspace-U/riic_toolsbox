import { onBeforeUnmount, ref, type Ref } from "vue";

import type { RoomKey } from "@/types/schedule";

export interface ScheduleOperatorAddress {
  planIndex?: number;
  type: RoomKey;
  position: number;
  slotIndex: number;
  key: string;
}

export type ScheduleOperatorNavigation =
  "tab" | "enter" | "left" | "right" | "up" | "down";

export interface ScheduleOperatorPickerPlacement {
  left: number;
  top: number;
  side: "left" | "right";
}

export function scheduleOperatorPickerPlacement(
  slotRect: Pick<DOMRect, "left" | "right" | "top">,
  panelWidth: number,
  panelHeight: number,
  viewportWidth: number,
  viewportHeight: number,
): ScheduleOperatorPickerPlacement {
  const padding = 8;
  const rightSpace = viewportWidth - slotRect.right - padding;
  const leftSpace = slotRect.left - padding;
  const rightFits = rightSpace >= panelWidth;
  const leftFits = leftSpace >= panelWidth;
  const side = rightFits
    ? "right"
    : leftFits
      ? "left"
      : rightSpace >= leftSpace
        ? "right"
        : "left";
  const maxLeft = Math.max(padding, viewportWidth - panelWidth - padding);
  const left = Math.min(
    Math.max(
      padding,
      side === "right"
        ? slotRect.right + padding
        : slotRect.left - panelWidth - padding,
    ),
    maxLeft,
  );
  const maxTop = Math.max(padding, viewportHeight - panelHeight - padding);
  const top = Math.min(Math.max(padding, slotRect.top), maxTop);
  return { left, top, side };
}

export interface ScheduleOperatorPointerInteraction<
  Address extends ScheduleOperatorAddress,
> {
  mode: "press" | "box" | "move";
  pointerId: number;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  startAddress?: Address;
  sourceAddresses: Address[];
  additive: boolean;
}

interface ScheduleOperatorInteractionOptions<
  Address extends ScheduleOperatorAddress,
> {
  root: Ref<HTMLElement | undefined>;
  slotSelector: string;
  slotSurfaceSelector: string;
  getAddresses: () => Address[];
  getAddressFromTarget: (target: EventTarget | null) => Address | undefined;
  getAddressByKey: (key: string) => Address | undefined;
  getAddressAtPoint: (x: number, y: number) => Address | undefined;
  getName: (address: Address) => string;
  getSelectionRange: (
    anchor: Address,
    target: Address,
  ) => Address[] | undefined;
  getSelectAllAddresses: (stage: number, anchor: Address) => Address[];
  maxSelectAllStage: number;
  boxSelectionUsesDocument?: boolean;
  commitEdit: () => boolean;
  beforePointerDown?: (event: PointerEvent) => boolean;
  shouldStartPointer?: (event: PointerEvent) => boolean;
  onSelect?: (event: MouseEvent | undefined, address: Address) => void;
  onDrop: (sources: Address[], target: Address) => void;
  onDragTarget?: (address: Address | undefined) => void;
  onDragMove?: (x: number, y: number, started: boolean) => void;
  onDragEnd?: (cancelled: boolean, target: Address | undefined) => void;
  onCopy: () => boolean;
  onCut: () => boolean;
  onPaste: () => boolean;
  canPaste?: () => boolean;
  canDelete?: () => boolean;
  onDelete: () => boolean;
  onUndo: () => void;
  onRedo: () => void;
  onNavigate: (action: ScheduleOperatorNavigation) => boolean;
  onEscape: (input: HTMLInputElement | undefined) => void;
  onStartCharacter?: (address: Address, character: string) => void;
  pickerIsOpen?: () => boolean;
  keyboardRequiresRoot?: boolean;
  selectStartRequiresRoot?: boolean;
}

export function useScheduleOperatorInteraction<
  Address extends ScheduleOperatorAddress,
>(options: ScheduleOperatorInteractionOptions<Address>) {
  const selectedKeys = ref<Set<string>>(new Set());
  const selectionAnchor = ref<Address>();
  const hoveredAddress = ref<Address>();
  const selectAllStage = ref(0);
  const pointerInteraction = ref<ScheduleOperatorPointerInteraction<Address>>();
  const dragTargetKey = ref("");
  const pasteHighlightKeys = ref<Set<string>>(new Set());
  const selectionMarquee = ref({ left: 0, top: 0, width: 0, height: 0 });
  const suppressNextClick = ref(false);
  let pasteHighlightTimer: ReturnType<typeof setTimeout> | undefined;
  let pendingPointerMove:
    { pointerId: number; clientX: number; clientY: number } | undefined;
  let pointerMoveFrame: number | undefined;
  let boxAnchor:
    | {
        x: number;
        y: number;
        scrollX: number;
        scrollY: number;
        elements: { element: Element; left: number; top: number }[];
      }
    | undefined;

  function selectedAddresses(): Address[] {
    return options
      .getAddresses()
      .filter((address) => selectedKeys.value.has(address.key));
  }

  function currentTarget(): Address | undefined {
    return selectedAddresses()[0] ?? hoveredAddress.value;
  }

  function isSelected(address: Address): boolean {
    return selectedKeys.value.has(address.key);
  }

  function clearSelection(): void {
    selectedKeys.value = new Set();
    selectionAnchor.value = undefined;
    selectAllStage.value = 0;
  }

  function resetSelectAllCycle(): void {
    selectAllStage.value = 0;
  }

  function setHoveredAddress(address: Address | undefined): void {
    hoveredAddress.value = address;
  }

  function selectAddress(
    event: MouseEvent | undefined,
    address: Address,
  ): void {
    if (suppressNextClick.value) {
      suppressNextClick.value = false;
      return;
    }
    if (!options.commitEdit()) return;
    const next = new Set(selectedKeys.value);
    const anchor = selectionAnchor.value;
    if (event?.shiftKey && anchor) {
      const range = options.getSelectionRange(anchor, address);
      if (range) range.forEach((item) => next.add(item.key));
      else {
        next.clear();
        next.add(address.key);
      }
    } else if (event?.ctrlKey || event?.metaKey) {
      if (next.has(address.key)) next.delete(address.key);
      else next.add(address.key);
    } else {
      next.clear();
      next.add(address.key);
    }
    selectedKeys.value = next;
    selectionAnchor.value = address;
    resetSelectAllCycle();
    options.onSelect?.(event, address);
  }

  function selectAll(): boolean {
    if (!options.commitEdit()) return false;
    const anchor = currentTarget();
    if (!anchor) return false;
    const addresses = options.getSelectAllAddresses(
      selectAllStage.value,
      anchor,
    );
    if (!addresses.length) return false;
    selectedKeys.value = new Set(addresses.map((address) => address.key));
    selectionAnchor.value = anchor;
    selectAllStage.value = Math.min(
      options.maxSelectAllStage,
      selectAllStage.value + 1,
    );
    return true;
  }

  function setSelection(addresses: Address[], anchor = addresses[0]): void {
    selectedKeys.value = new Set(addresses.map((address) => address.key));
    selectionAnchor.value = anchor;
  }

  function reset(): void {
    cancelPointerMoveFrame();
    clearBoxAnchor();
    clearSelection();
    hoveredAddress.value = undefined;
    pointerInteraction.value = undefined;
    dragTargetKey.value = "";
    selectionMarquee.value = { left: 0, top: 0, width: 0, height: 0 };
    suppressNextClick.value = false;
    clearPasteHighlight();
    options.onDragTarget?.(undefined);
    options.onDragEnd?.(true, undefined);
  }

  function clearBoxAnchor(): void {
    boxAnchor = undefined;
    window.removeEventListener("scroll", handleBoxScroll, true);
  }

  function updateBoxAnchor(): void {
    const interaction = pointerInteraction.value;
    if (!boxAnchor || !interaction || interaction.mode === "move") return;
    interaction.startX = boxAnchor.x - (window.scrollX - boxAnchor.scrollX);
    interaction.startY = boxAnchor.y - (window.scrollY - boxAnchor.scrollY);
    for (const { element, left, top } of boxAnchor.elements) {
      interaction.startX -= element.scrollLeft - left;
      interaction.startY -= element.scrollTop - top;
    }
  }

  function updateSelectionMarquee(
    interaction: ScheduleOperatorPointerInteraction<Address>,
  ): void {
    selectionMarquee.value = {
      left: Math.min(interaction.startX, interaction.currentX),
      top: Math.min(interaction.startY, interaction.currentY),
      width: Math.abs(interaction.currentX - interaction.startX),
      height: Math.abs(interaction.currentY - interaction.startY),
    };
  }

  function handleBoxScroll(): void {
    const interaction = pointerInteraction.value;
    if (!interaction || interaction.mode === "move") return;
    updateBoxAnchor();
    if (interaction.mode === "box") updateSelectionMarquee(interaction);
  }

  function selectBox(
    interaction: ScheduleOperatorPointerInteraction<Address>,
  ): void {
    const left = Math.min(interaction.startX, interaction.currentX);
    const right = Math.max(interaction.startX, interaction.currentX);
    const top = Math.min(interaction.startY, interaction.currentY);
    const bottom = Math.max(interaction.startY, interaction.currentY);
    const next = interaction.additive
      ? new Set(selectedKeys.value)
      : new Set<string>();
    const addresses: Address[] = [];
    const selectionRoot = options.boxSelectionUsesDocument
      ? window.document
      : options.root.value;
    selectionRoot
      ?.querySelectorAll<HTMLElement>(options.slotSelector)
      .forEach((slot) => {
        const rect = slot.getBoundingClientRect();
        if (
          rect.right >= left &&
          rect.left <= right &&
          rect.bottom >= top &&
          rect.top <= bottom
        ) {
          const address = options.getAddressByKey(slot.dataset.key ?? "");
          if (address) {
            next.add(address.key);
            addresses.push(address);
          }
        }
      });
    selectedKeys.value = next;
    const anchor = addresses[0] ?? interaction.startAddress;
    if (anchor) selectionAnchor.value = anchor;
    selectionMarquee.value = { left: 0, top: 0, width: 0, height: 0 };
    resetSelectAllCycle();
  }

  function applyPointerMove(
    pointerId: number,
    clientX: number,
    clientY: number,
  ): void {
    const interaction = pointerInteraction.value;
    if (!interaction || interaction.pointerId !== pointerId) return;
    const previousMode = interaction.mode;
    if (
      interaction.mode === "press" &&
      (interaction.startX !== clientX || interaction.startY !== clientY)
    ) {
      interaction.mode = interaction.sourceAddresses.length ? "move" : "box";
    }
    interaction.currentX = clientX;
    interaction.currentY = clientY;
    if (interaction.mode === "box") {
      updateSelectionMarquee(interaction);
      return;
    }
    if (interaction.mode === "move") {
      const started = previousMode !== "move";
      options.onDragMove?.(clientX, clientY, started);
      const target = options.getAddressAtPoint(clientX, clientY);
      dragTargetKey.value = target?.key ?? "";
      options.onDragTarget?.(target);
    }
  }

  function cancelPointerMoveFrame(): void {
    pendingPointerMove = undefined;
    if (pointerMoveFrame !== undefined) {
      cancelAnimationFrame(pointerMoveFrame);
      pointerMoveFrame = undefined;
    }
  }

  function flushPointerMove(): void {
    const pending = pendingPointerMove;
    cancelPointerMoveFrame();
    if (pending)
      applyPointerMove(pending.pointerId, pending.clientX, pending.clientY);
  }

  function handlePointerDown(event: PointerEvent): void {
    if (
      event.button !== 0 ||
      !options.root.value?.contains(event.target as Node) ||
      options.shouldStartPointer?.(event) === false
    ) {
      return;
    }
    const target = event.target instanceof Element ? event.target : undefined;
    if (target?.closest("input, textarea, select, button")) return;
    if (options.beforePointerDown?.(event) === false) return;
    clearBoxAnchor();
    const address = options.getAddressFromTarget(event.target);
    const hasName = address ? Boolean(options.getName(address)) : false;
    const sources =
      address && event.shiftKey && hasName
        ? selectedKeys.value.has(address.key)
          ? selectedAddresses()
          : [address]
        : [];
    pointerInteraction.value = {
      mode: address ? "press" : "box",
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      currentX: event.clientX,
      currentY: event.clientY,
      startAddress: address,
      sourceAddresses: sources,
      additive: event.ctrlKey || event.metaKey,
    };
    if (!sources.length) {
      const elements: { element: Element; left: number; top: number }[] = [];
      for (
        let element = target;
        element;
        element = element.parentElement ?? undefined
      ) {
        if (element !== document.scrollingElement) {
          elements.push({
            element,
            left: element.scrollLeft,
            top: element.scrollTop,
          });
        }
      }
      boxAnchor = {
        x: event.clientX,
        y: event.clientY,
        scrollX: window.scrollX,
        scrollY: window.scrollY,
        elements,
      };
      window.addEventListener("scroll", handleBoxScroll, true);
    }
    suppressNextClick.value = false;
    if (!address) event.preventDefault();
  }

  function handlePointerMove(event: PointerEvent): void {
    const interaction = pointerInteraction.value;
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    const moved =
      interaction.startX !== event.clientX ||
      interaction.startY !== event.clientY;
    if (interaction.mode !== "press" || moved) event.preventDefault();
    pendingPointerMove = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
    };
    if (pointerMoveFrame === undefined) {
      pointerMoveFrame = requestAnimationFrame(() => {
        pointerMoveFrame = undefined;
        const pending = pendingPointerMove;
        pendingPointerMove = undefined;
        if (pending)
          applyPointerMove(pending.pointerId, pending.clientX, pending.clientY);
      });
    }
  }

  function handlePointerUp(event: PointerEvent): void {
    const interaction = pointerInteraction.value;
    if (!interaction || interaction.pointerId !== event.pointerId) return;
    flushPointerMove();
    updateBoxAnchor();
    interaction.currentX = event.clientX;
    interaction.currentY = event.clientY;
    let finalDragTarget: Address | undefined;
    if (interaction.mode === "box") {
      selectBox(interaction);
      suppressNextClick.value = true;
    } else if (interaction.mode === "move") {
      finalDragTarget =
        options.getAddressByKey(dragTargetKey.value) ??
        options.getAddressAtPoint(event.clientX, event.clientY);
      if (finalDragTarget)
        options.onDrop(interaction.sourceAddresses, finalDragTarget);
      suppressNextClick.value = true;
    }
    pointerInteraction.value = undefined;
    clearBoxAnchor();
    dragTargetKey.value = "";
    options.onDragTarget?.(undefined);
    if (interaction.mode === "move")
      options.onDragEnd?.(false, finalDragTarget);
  }

  function handlePointerCancel(event?: PointerEvent): void {
    const interaction = pointerInteraction.value;
    if (event && interaction?.pointerId !== event.pointerId) return;
    const finalDragTarget = options.getAddressByKey(dragTargetKey.value);
    cancelPointerMoveFrame();
    pointerInteraction.value = undefined;
    clearBoxAnchor();
    dragTargetKey.value = "";
    selectionMarquee.value = { left: 0, top: 0, width: 0, height: 0 };
    options.onDragTarget?.(undefined);
    if (interaction?.mode === "move")
      options.onDragEnd?.(true, finalDragTarget);
    suppressNextClick.value = true;
  }

  function handleSelectStart(event: Event): void {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const isWithinRoot = options.root.value?.contains(target) ?? false;
    if (options.selectStartRequiresRoot && !isWithinRoot) return;
    if (
      pointerInteraction.value?.mode === "box" ||
      pointerInteraction.value?.mode === "move" ||
      target.closest(options.slotSurfaceSelector)
    ) {
      if (!target.closest("input, textarea, select")) event.preventDefault();
    }
  }

  function clearPasteHighlight(): void {
    pasteHighlightKeys.value = new Set();
    if (pasteHighlightTimer !== undefined) clearTimeout(pasteHighlightTimer);
    pasteHighlightTimer = undefined;
  }

  function showPasteHighlight(addresses: Address[]): void {
    clearPasteHighlight();
    pasteHighlightKeys.value = new Set(addresses.map((address) => address.key));
    pasteHighlightTimer = setTimeout(clearPasteHighlight, 700);
  }

  function findOperatorInput(
    target: EventTarget | null,
  ): HTMLInputElement | undefined {
    if (!(target instanceof Element)) return undefined;
    const input = target.closest("input.simulator-slot-name-input");
    return input instanceof HTMLInputElement ? input : undefined;
  }

  function keyboardShortcutKey(event: KeyboardEvent): string {
    const keys: Record<string, string> = {
      KeyA: "a",
      KeyC: "c",
      KeyX: "x",
      KeyV: "v",
      KeyZ: "z",
      KeyY: "y",
    };
    return keys[event.code] ?? event.key.toLowerCase();
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (
      options.keyboardRequiresRoot &&
      (!(event.target instanceof Node) ||
        !options.root.value?.contains(event.target))
    ) {
      return;
    }
    const isImeEvent =
      event.isComposing || event.key === "Process" || event.keyCode === 229;
    const target = event.target instanceof Element ? event.target : undefined;
    const skillTooltipTarget =
      target?.closest("[data-operator-skill-tooltip]") ??
      (typeof document === "undefined"
        ? null
        : document.querySelector("[data-operator-skill-tooltip]:hover"));
    if (
      event.key.toLowerCase() === "g" &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      !isImeEvent &&
      skillTooltipTarget
    ) {
      return;
    }
    const operatorInput = findOperatorInput(event.target);
    const pendingOperatorInput = operatorInput?.classList.contains(
      "simulator-slot-name-input--pending",
    );
    if (operatorInput && !pendingOperatorInput) {
      if (event.key === "Escape") {
        event.preventDefault();
        options.onEscape(operatorInput);
        return;
      }
      if (
        isImeEvent ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.shiftKey
      ) {
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        if (options.onNavigate(event.key === "Enter" ? "enter" : "tab"))
          event.preventDefault();
      }
      return;
    }
    if (pendingOperatorInput && event.key === "Backspace") {
      event.preventDefault();
      return;
    }
    if (pendingOperatorInput && event.key === "Delete") {
      event.preventDefault();
      if (options.canDelete?.() !== false) options.onDelete();
      return;
    }
    if (event.key === "Escape") {
      if (pendingOperatorInput) operatorInput?.blur();
      resetSelectAllCycle();
      options.onEscape(operatorInput);
      return;
    }
    const editableTarget = target?.closest("input, textarea, select");
    if (editableTarget && !pendingOperatorInput) return;
    const primaryModifier =
      (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey;
    if (primaryModifier) {
      const key = keyboardShortcutKey(event);
      if (!["a", "c", "x", "v", "z", "y"].includes(key)) return;
      if (key === "a") {
        if (selectAll()) event.preventDefault();
        return;
      }
      if (key === "z" || key === "y") {
        event.preventDefault();
        if (key === "z") options.onUndo();
        else options.onRedo();
        return;
      }
      if (key === "v" && options.canPaste?.() === false) return;
      if (!currentTarget()) return;
      event.preventDefault();
      if (key === "c") options.onCopy();
      else if (key === "x") options.onCut();
      else options.onPaste();
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey)
      return;
    const navigationKeys: Record<string, ScheduleOperatorNavigation> = {
      Tab: "tab",
      Enter: "enter",
      ArrowLeft: "left",
      ArrowRight: "right",
      ArrowUp: "up",
      ArrowDown: "down",
    };
    const navigation = navigationKeys[event.key];
    if (navigation) {
      if (options.onNavigate(navigation)) event.preventDefault();
      return;
    }
    if (pendingOperatorInput && !isImeEvent && event.key.length === 1) return;
    if (!options.pickerIsOpen?.() && !isImeEvent && event.key.length === 1) {
      const selected = selectedAddresses();
      if (selected.length === 1) {
        const address = selected[0];
        if (address) {
          event.preventDefault();
          options.onStartCharacter?.(address, event.key);
        }
        return;
      }
    }
    if (
      event.key === "Delete" &&
      (options.canDelete?.() ?? Boolean(currentTarget()))
    ) {
      event.preventDefault();
      options.onDelete();
    }
  }

  onBeforeUnmount(() => {
    clearPasteHighlight();
    cancelPointerMoveFrame();
    clearBoxAnchor();
  });

  return {
    clearPasteHighlight,
    clearSelection,
    currentTarget,
    dragTargetKey,
    handleKeydown,
    handlePointerCancel,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handleSelectStart,
    hoveredAddress,
    isSelected,
    pasteHighlightKeys,
    pointerInteraction,
    resetSelectAllCycle,
    reset,
    selectAddress,
    selectAll,
    selectedAddresses,
    selectedKeys,
    selectionAnchor,
    selectionMarquee,
    setHoveredAddress,
    setSelection,
    showPasteHighlight,
    suppressNextClick,
  };
}
