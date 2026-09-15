import { computed, ref } from "vue";

import {
  calculateSanityValues,
  DEFAULT_SANITY_SETTINGS,
  type SanitySettings,
} from "@/utils/sanity";

export const SANITY_SETTINGS_STORAGE_KEY = "riic-tools:sanity-settings:v1";

const sanitySettings = ref<SanitySettings>(readSanitySettings());

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function readSanitySettings(): SanitySettings {
  if (typeof window === "undefined") {
    return { ...DEFAULT_SANITY_SETTINGS };
  }

  try {
    const raw = window.localStorage.getItem(SANITY_SETTINGS_STORAGE_KEY);
    if (!raw) {
      return { ...DEFAULT_SANITY_SETTINGS };
    }
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return { ...DEFAULT_SANITY_SETTINGS };
    }
    const candidate = parsed as Partial<SanitySettings>;
    return {
      lmd: isFiniteNonNegative(candidate.lmd)
        ? candidate.lmd
        : DEFAULT_SANITY_SETTINGS.lmd,
      goldExperienceRatio: isFiniteNonNegative(candidate.goldExperienceRatio)
        ? candidate.goldExperienceRatio
        : DEFAULT_SANITY_SETTINGS.goldExperienceRatio,
      orundum: isFiniteNonNegative(candidate.orundum)
        ? candidate.orundum
        : DEFAULT_SANITY_SETTINGS.orundum,
      credit: isFiniteNonNegative(candidate.credit)
        ? candidate.credit
        : DEFAULT_SANITY_SETTINGS.credit,
      recruitRefresh: isFiniteNonNegative(candidate.recruitRefresh)
        ? candidate.recruitRefresh
        : DEFAULT_SANITY_SETTINGS.recruitRefresh,
      solidRock: isFiniteNonNegative(candidate.solidRock)
        ? candidate.solidRock
        : null,
      device: isFiniteNonNegative(candidate.device) ? candidate.device : null,
    };
  } catch {
    return { ...DEFAULT_SANITY_SETTINGS };
  }
}

function persistSanitySettings(): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      SANITY_SETTINGS_STORAGE_KEY,
      JSON.stringify(sanitySettings.value),
    );
  } catch {}
}

function setSanitySetting(
  key: keyof SanitySettings,
  value: number | null,
): void {
  if (value === null && key !== "solidRock" && key !== "device") {
    return;
  }
  if (value !== null && !isFiniteNonNegative(value)) {
    return;
  }
  sanitySettings.value = { ...sanitySettings.value, [key]: value };
  persistSanitySettings();
}

function resetSanitySettings(): void {
  sanitySettings.value = { ...DEFAULT_SANITY_SETTINGS };
  persistSanitySettings();
}

export function useSanitySettings() {
  const sanityValues = computed(() =>
    calculateSanityValues(sanitySettings.value),
  );

  return {
    sanitySettings,
    sanityValues,
    setSanitySetting,
    resetSanitySettings,
  };
}
