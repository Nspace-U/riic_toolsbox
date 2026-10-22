import { ref } from "vue";

export type CalculationStepDisplayMode = "facility" | "queue";

export interface CalculationStepDisplayModeOption {
  label: string;
  description: string;
}

export const CALCULATION_STEP_DISPLAY_SETTINGS_STORAGE_KEY =
  "riic-tools:calculation-step-display-settings:v1";

export const CALCULATION_STEP_DISPLAY_MODE_OPTIONS: Record<
  CalculationStepDisplayMode,
  CalculationStepDisplayModeOption
> = {
  facility: {
    label: "按设施展开",
    description: "合并同一设施的计算步骤，并按队列横向排列。",
  },
  queue: {
    label: "按队列展开",
    description: "按队列排列设施，展开后查看每个设施的计算步骤。",
  },
};

const DEFAULT_CALCULATION_STEP_DISPLAY_MODE: CalculationStepDisplayMode =
  "facility";
const DEFAULT_SHOW_AUTOMATIC_REST_OPERATORS = false;

function isCalculationStepDisplayMode(
  value: unknown,
): value is CalculationStepDisplayMode {
  return value === "facility" || value === "queue";
}

function readCalculationStepDisplayMode(): CalculationStepDisplayMode {
  if (typeof window === "undefined") {
    return DEFAULT_CALCULATION_STEP_DISPLAY_MODE;
  }

  try {
    const storedValue = window.localStorage.getItem(
      CALCULATION_STEP_DISPLAY_SETTINGS_STORAGE_KEY,
    );
    if (!storedValue) {
      return DEFAULT_CALCULATION_STEP_DISPLAY_MODE;
    }
    const parsedValue: unknown = JSON.parse(storedValue);
    const mode =
      typeof parsedValue === "object" && parsedValue !== null
        ? (parsedValue as { mode?: unknown }).mode
        : undefined;
    return isCalculationStepDisplayMode(mode)
      ? mode
      : DEFAULT_CALCULATION_STEP_DISPLAY_MODE;
  } catch {
    return DEFAULT_CALCULATION_STEP_DISPLAY_MODE;
  }
}

function readShowAutomaticRestOperators(): boolean {
  if (typeof window === "undefined") {
    return DEFAULT_SHOW_AUTOMATIC_REST_OPERATORS;
  }

  try {
    const storedValue = window.localStorage.getItem(
      CALCULATION_STEP_DISPLAY_SETTINGS_STORAGE_KEY,
    );
    if (!storedValue) return DEFAULT_SHOW_AUTOMATIC_REST_OPERATORS;
    const parsedValue: unknown = JSON.parse(storedValue);
    return typeof parsedValue === "object" &&
      parsedValue !== null &&
      typeof (parsedValue as { showAutomaticRestOperators?: unknown })
        .showAutomaticRestOperators === "boolean"
      ? (parsedValue as { showAutomaticRestOperators: boolean })
          .showAutomaticRestOperators
      : DEFAULT_SHOW_AUTOMATIC_REST_OPERATORS;
  } catch {
    return DEFAULT_SHOW_AUTOMATIC_REST_OPERATORS;
  }
}

const calculationStepDisplayMode = ref<CalculationStepDisplayMode>(
  readCalculationStepDisplayMode(),
);
const showAutomaticRestOperators = ref(readShowAutomaticRestOperators());

function persistCalculationStepDisplayMode(): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      CALCULATION_STEP_DISPLAY_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        mode: calculationStepDisplayMode.value,
        showAutomaticRestOperators: showAutomaticRestOperators.value,
      }),
    );
  } catch {}
}

function setShowAutomaticRestOperators(value: boolean): void {
  showAutomaticRestOperators.value = value;
  persistCalculationStepDisplayMode();
}

function setCalculationStepDisplayMode(value: unknown): void {
  if (!isCalculationStepDisplayMode(value)) {
    return;
  }
  calculationStepDisplayMode.value = value;
  persistCalculationStepDisplayMode();
}

function resetCalculationStepDisplayMode(): void {
  calculationStepDisplayMode.value = DEFAULT_CALCULATION_STEP_DISPLAY_MODE;
  persistCalculationStepDisplayMode();
}

export function useCalculationStepDisplaySettings() {
  return {
    calculationStepDisplayMode,
    showAutomaticRestOperators,
    calculationStepDisplayModeOptions: CALCULATION_STEP_DISPLAY_MODE_OPTIONS,
    setCalculationStepDisplayMode,
    setShowAutomaticRestOperators,
    resetCalculationStepDisplayMode,
  };
}
