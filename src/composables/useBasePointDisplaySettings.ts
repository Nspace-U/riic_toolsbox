import { ref } from "vue";

export const BASE_POINT_DISPLAY_SETTINGS_STORAGE_KEY =
  "riic-tools:base-point-display-settings:v1";

function readHiddenBasePointTerms(): string[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const storedValue = window.localStorage.getItem(
      BASE_POINT_DISPLAY_SETTINGS_STORAGE_KEY,
    );
    if (!storedValue) {
      return [];
    }
    const parsedValue: unknown = JSON.parse(storedValue);
    if (typeof parsedValue !== "object" || parsedValue === null) {
      return [];
    }
    const hiddenTerms = (parsedValue as { hiddenTerms?: unknown }).hiddenTerms;
    return Array.isArray(hiddenTerms)
      ? [
          ...new Set(
            hiddenTerms.filter(
              (term): term is string => typeof term === "string",
            ),
          ),
        ]
      : [];
  } catch {
    return [];
  }
}

const hiddenBasePointTerms = ref<string[]>(readHiddenBasePointTerms());

function persistBasePointDisplaySettings(): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      BASE_POINT_DISPLAY_SETTINGS_STORAGE_KEY,
      JSON.stringify({ hiddenTerms: hiddenBasePointTerms.value }),
    );
  } catch {}
}

function isBasePointVisible(term: string): boolean {
  return !hiddenBasePointTerms.value.includes(term);
}

function setAllBasePointsVisible(terms: string[], visible: boolean): void {
  const hiddenTerms = new Set(hiddenBasePointTerms.value);
  terms.forEach((term) => {
    if (visible) {
      hiddenTerms.delete(term);
    } else {
      hiddenTerms.add(term);
    }
  });
  hiddenBasePointTerms.value = [...hiddenTerms];
  persistBasePointDisplaySettings();
}

export function useBasePointDisplaySettings() {
  return {
    hiddenBasePointTerms,
    isBasePointVisible,
    setAllBasePointsVisible,
  };
}
