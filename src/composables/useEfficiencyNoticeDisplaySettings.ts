import { ref } from "vue";

import { EFFICIENCY_NOTICE_DISPLAY_OPTIONS } from "@arknights/riic-efficiency";

export const EFFICIENCY_NOTICE_DISPLAY_SETTINGS_STORAGE_KEY =
  "riic-tools:efficiency-notice-display-settings:v1";

function readHiddenNoticeCodes(): string[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const storedValue = window.localStorage.getItem(
      EFFICIENCY_NOTICE_DISPLAY_SETTINGS_STORAGE_KEY,
    );
    if (!storedValue) {
      return [];
    }
    const parsedValue: unknown = JSON.parse(storedValue);
    if (typeof parsedValue !== "object" || parsedValue === null) {
      return [];
    }
    const hiddenCodes = (parsedValue as { hiddenCodes?: unknown }).hiddenCodes;
    return Array.isArray(hiddenCodes)
      ? [
          ...new Set(
            hiddenCodes.filter(
              (code): code is string => typeof code === "string",
            ),
          ),
        ]
      : [];
  } catch {
    return [];
  }
}

const hiddenNoticeCodes = ref<string[]>(readHiddenNoticeCodes());

function persistNoticeDisplaySettings(): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      EFFICIENCY_NOTICE_DISPLAY_SETTINGS_STORAGE_KEY,
      JSON.stringify({ hiddenCodes: hiddenNoticeCodes.value }),
    );
  } catch {}
}

function isEfficiencyNoticeVisible(code: string): boolean {
  return !hiddenNoticeCodes.value.includes(code);
}

function setEfficiencyNoticeVisible(code: string, visible: boolean): void {
  setEfficiencyNoticesVisible([code], visible);
}

function setEfficiencyNoticesVisible(
  codes: readonly string[],
  visible: boolean,
): void {
  const hiddenCodes = new Set(hiddenNoticeCodes.value);
  codes.forEach((code) => {
    if (visible) {
      hiddenCodes.delete(code);
    } else {
      hiddenCodes.add(code);
    }
  });
  hiddenNoticeCodes.value = [...hiddenCodes];
  persistNoticeDisplaySettings();
}

function setAllEfficiencyNoticesVisible(visible: boolean): void {
  hiddenNoticeCodes.value = visible
    ? []
    : EFFICIENCY_NOTICE_DISPLAY_OPTIONS.map((option) => option.code);
  persistNoticeDisplaySettings();
}

export function useEfficiencyNoticeDisplaySettings() {
  return {
    isEfficiencyNoticeVisible,
    setEfficiencyNoticeVisible,
    setEfficiencyNoticesVisible,
    setAllEfficiencyNoticesVisible,
  };
}
