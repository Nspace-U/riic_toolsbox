import { computed, ref, type Ref } from "vue";

import {
  calculateSanityValues,
  DEFAULT_SANITY_SETTINGS,
  type SanitySettings,
} from "@/utils/sanity";
import {
  SANITY_MATERIAL_DEFAULT_VALUES,
  sanityMaterialItems,
} from "@/utils/sanityMaterials";
import type { TorappuItemTable } from "@/types/torappu";

export const SANITY_SETTINGS_STORAGE_KEY = "riic-tools:sanity-settings:v1";

interface StoredSanitySettings extends SanitySettings {
  materialSanityValues: Record<string, number | null>;
}

const sanitySettings = ref<StoredSanitySettings>(readSanitySettings());

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function defaultMaterialSanityValues(): Record<string, number | null> {
  return { ...SANITY_MATERIAL_DEFAULT_VALUES };
}

function defaultSanitySettings(): StoredSanitySettings {
  return {
    ...DEFAULT_SANITY_SETTINGS,
    materialSanityValues: defaultMaterialSanityValues(),
  };
}

function readSanitySettings(): StoredSanitySettings {
  if (typeof window === "undefined") {
    return defaultSanitySettings();
  }

  try {
    const raw = window.localStorage.getItem(SANITY_SETTINGS_STORAGE_KEY);
    if (!raw) {
      return defaultSanitySettings();
    }
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return defaultSanitySettings();
    }
    const candidate = parsed as Partial<SanitySettings> & {
      materialSanityValues?: unknown;
    };
    const materialSanityValues = defaultMaterialSanityValues();
    const storedMaterialValues =
      typeof candidate.materialSanityValues === "object" &&
      candidate.materialSanityValues !== null &&
      !Array.isArray(candidate.materialSanityValues)
        ? candidate.materialSanityValues
        : undefined;
    if (storedMaterialValues !== undefined) {
      Object.entries(storedMaterialValues).forEach(([itemId, value]) => {
        if (value === null || isFiniteNonNegative(value)) {
          materialSanityValues[itemId] = value;
        }
      });
    }
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
      materialSanityValues,
    };
  } catch {
    return defaultSanitySettings();
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
  if (value === null) {
    return;
  }
  if (value !== null && !isFiniteNonNegative(value)) {
    return;
  }
  sanitySettings.value = { ...sanitySettings.value, [key]: value };
  persistSanitySettings();
}

function resetSanitySetting(key: keyof SanitySettings): void {
  sanitySettings.value = {
    ...sanitySettings.value,
    [key]: DEFAULT_SANITY_SETTINGS[key],
  };
  persistSanitySettings();
}

function setSanityMaterialSetting(itemId: string, value: number | null): void {
  if (value !== null && !isFiniteNonNegative(value)) {
    return;
  }
  sanitySettings.value = {
    ...sanitySettings.value,
    materialSanityValues: {
      ...sanitySettings.value.materialSanityValues,
      [itemId]: value,
    },
  };
  persistSanitySettings();
}

function resetSanityMaterialSetting(itemId: string): void {
  const value = SANITY_MATERIAL_DEFAULT_VALUES[itemId] ?? null;
  setSanityMaterialSetting(itemId, value);
}

export function useSanitySettings(
  itemTable: Readonly<Ref<TorappuItemTable | undefined>>,
) {
  const materialItems = computed(() => sanityMaterialItems(itemTable.value));
  const sanityValues = computed(() => ({
    ...calculateSanityValues(sanitySettings.value),
    materials: Object.fromEntries(
      materialItems.value.map((item) => [
        item.name,
        sanitySettings.value.materialSanityValues[item.itemId] ?? null,
      ]),
    ),
  }));

  return {
    materialItems,
    sanitySettings,
    sanityValues,
    setSanitySetting,
    resetSanitySetting,
    setSanityMaterialSetting,
    resetSanityMaterialSetting,
  };
}
