import { ref } from "vue";

export const NUMERIC_TOOLTIP_SETTINGS_STORAGE_KEY =
  "riic-tools:numeric-tooltip-settings:v1";

interface NumericTooltipSettings {
  enabled: boolean;
}

const DEFAULT_NUMERIC_TOOLTIP_SETTINGS: NumericTooltipSettings = {
  enabled: false,
};

function readNumericTooltipSettings(): NumericTooltipSettings {
  if (typeof window === "undefined") {
    return { ...DEFAULT_NUMERIC_TOOLTIP_SETTINGS };
  }

  try {
    const storedValue = window.localStorage.getItem(
      NUMERIC_TOOLTIP_SETTINGS_STORAGE_KEY,
    );
    if (!storedValue) {
      return { ...DEFAULT_NUMERIC_TOOLTIP_SETTINGS };
    }
    const parsedValue: unknown = JSON.parse(storedValue);
    if (
      typeof parsedValue !== "object" ||
      parsedValue === null ||
      Array.isArray(parsedValue)
    ) {
      return { ...DEFAULT_NUMERIC_TOOLTIP_SETTINGS };
    }
    const enabled = (parsedValue as Partial<NumericTooltipSettings>).enabled;
    return {
      enabled:
        typeof enabled === "boolean"
          ? enabled
          : DEFAULT_NUMERIC_TOOLTIP_SETTINGS.enabled,
    };
  } catch {
    return { ...DEFAULT_NUMERIC_TOOLTIP_SETTINGS };
  }
}

const numericTooltipEnabled = ref(readNumericTooltipSettings().enabled);

function persistNumericTooltipSettings(): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      NUMERIC_TOOLTIP_SETTINGS_STORAGE_KEY,
      JSON.stringify({ enabled: numericTooltipEnabled.value }),
    );
  } catch {}
}

function setNumericTooltipEnabled(value: unknown): void {
  if (typeof value !== "boolean") {
    return;
  }
  numericTooltipEnabled.value = value;
  persistNumericTooltipSettings();
}

function resetNumericTooltipSettings(): void {
  numericTooltipEnabled.value = DEFAULT_NUMERIC_TOOLTIP_SETTINGS.enabled;
  persistNumericTooltipSettings();
}

export function useNumericTooltipSettings() {
  return {
    numericTooltipEnabled,
    setNumericTooltipEnabled,
    resetNumericTooltipSettings,
  };
}
