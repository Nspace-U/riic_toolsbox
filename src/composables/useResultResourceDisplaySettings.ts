import { ref } from "vue";
import type { ResourceAmountDisplayMode } from "@arknights/riic-efficiency";

export type ResultResourceDisplayMode = ResourceAmountDisplayMode;

export interface ResultResourceDisplayModeOption {
  label: string;
  description: string;
}

export const RESULT_RESOURCE_DISPLAY_SETTINGS_STORAGE_KEY =
  "riic-tools:result-resource-display-settings:v1";

export const RESULT_RESOURCE_DISPLAY_MODE_OPTIONS: Record<
  ResultResourceDisplayMode,
  ResultResourceDisplayModeOption
> = {
  raw: {
    label: "原始数值",
    description: "赤金与中级作战记录按道具数量显示。",
  },
  points: {
    label: "点数/经验点数",
    description: "赤金按 500 点/个、中级作战记录按 1000 经验点数/本换算。",
  },
  both: {
    label: "二者都显示",
    description: "先显示原始数量，再显示括号内的点数或经验点数。",
  },
};

const DEFAULT_RESULT_RESOURCE_DISPLAY_MODE: ResultResourceDisplayMode =
  "points";

function isResultResourceDisplayMode(
  value: unknown,
): value is ResultResourceDisplayMode {
  return value === "raw" || value === "points" || value === "both";
}

function readResultResourceDisplayMode(): ResultResourceDisplayMode {
  if (typeof window === "undefined") {
    return DEFAULT_RESULT_RESOURCE_DISPLAY_MODE;
  }

  try {
    const storedValue = window.localStorage.getItem(
      RESULT_RESOURCE_DISPLAY_SETTINGS_STORAGE_KEY,
    );
    if (!storedValue) {
      return DEFAULT_RESULT_RESOURCE_DISPLAY_MODE;
    }
    const parsedValue: unknown = JSON.parse(storedValue);
    const mode =
      typeof parsedValue === "object" && parsedValue !== null
        ? (parsedValue as { mode?: unknown }).mode
        : undefined;
    return isResultResourceDisplayMode(mode)
      ? mode
      : DEFAULT_RESULT_RESOURCE_DISPLAY_MODE;
  } catch {
    return DEFAULT_RESULT_RESOURCE_DISPLAY_MODE;
  }
}

const resultResourceDisplayMode = ref<ResultResourceDisplayMode>(
  readResultResourceDisplayMode(),
);

function persistResultResourceDisplayMode(): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      RESULT_RESOURCE_DISPLAY_SETTINGS_STORAGE_KEY,
      JSON.stringify({ mode: resultResourceDisplayMode.value }),
    );
  } catch {}
}

function setResultResourceDisplayMode(value: unknown): void {
  if (!isResultResourceDisplayMode(value)) {
    return;
  }
  resultResourceDisplayMode.value = value;
  persistResultResourceDisplayMode();
}

function resetResultResourceDisplayMode(): void {
  resultResourceDisplayMode.value = DEFAULT_RESULT_RESOURCE_DISPLAY_MODE;
  persistResultResourceDisplayMode();
}

export function useResultResourceDisplaySettings() {
  return {
    resultResourceDisplayMode,
    resultResourceDisplayModeOptions: RESULT_RESOURCE_DISPLAY_MODE_OPTIONS,
    setResultResourceDisplayMode,
    resetResultResourceDisplayMode,
  };
}
