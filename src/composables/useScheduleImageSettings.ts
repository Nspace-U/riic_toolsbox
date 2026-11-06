import { reactive, watch } from "vue";

const STORAGE_KEY = "riic-tools:schedule-image-settings:v1";

function readSettings(): { showMood: boolean; mapSpecialOperators: boolean } {
  try {
    const stored: unknown = JSON.parse(
      localStorage.getItem(STORAGE_KEY) ?? "{}",
    );
    if (typeof stored === "object" && stored !== null) {
      const settings = stored as Record<string, unknown>;
      return {
        showMood: settings.showMood === true,
        mapSpecialOperators: settings.mapSpecialOperators !== false,
      };
    }
  } catch {}
  return { showMood: false, mapSpecialOperators: true };
}

const settings = reactive(readSettings());

watch(
  settings,
  () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {}
  },
  { flush: "sync" },
);

export function useScheduleImageSettings() {
  return settings;
}
