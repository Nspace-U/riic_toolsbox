import { computed, ref, type Ref } from "vue";

import {
  calculateSanityValues,
  DEFAULT_SANITY_SETTINGS,
  type SanitySettings,
} from "@/utils/sanity";
import {
  loadSanityMaterialDefaults,
  sanityMaterialItems,
} from "@/utils/sanityMaterials";
import type { TorappuItemTable } from "@/types/torappu";
import type { RecycleRules } from "@arknights/riic-efficiency";
import { recycleOutputItemSanity } from "@arknights/riic-efficiency";

export const SANITY_SETTINGS_STORAGE_KEY = "riic-tools:sanity-settings:v1";

interface StoredSanitySettings extends SanitySettings {
  materialSanityOverrides: Record<string, number | null>;
}

const legacyMaterialSanityValues = ref<Record<string, number | null>>();
const materialSanityDefaults = ref<Record<string, number>>({});
const materialSanityDefaultsLoaded = ref(false);
const sanitySettings = ref<StoredSanitySettings>(readSanitySettings());
let materialSanityDefaultsPromise: Promise<void> | undefined;

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function validMaterialSanityValues(
  value: unknown,
): Record<string, number | null> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter(
      ([itemId, sanity]) =>
        /^\d+$/.test(itemId) &&
        (sanity === null || isFiniteNonNegative(sanity)),
    ),
  ) as Record<string, number | null>;
}

function defaultSanitySettings(): StoredSanitySettings {
  return {
    ...DEFAULT_SANITY_SETTINGS,
    materialSanityOverrides: {},
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
      materialSanityOverrides?: unknown;
      materialSanityValues?: unknown;
      solidRock?: unknown;
      device?: unknown;
    };
    const materialSanityOverrides = validMaterialSanityValues(
      candidate.materialSanityOverrides,
    );
    const legacyValues = validMaterialSanityValues(
      candidate.materialSanityValues,
    );
    if (
      !Object.hasOwn(legacyValues, "30012") &&
      isFiniteNonNegative(candidate.solidRock)
    ) {
      legacyValues["30012"] = candidate.solidRock;
    }
    if (
      !Object.hasOwn(legacyValues, "30062") &&
      isFiniteNonNegative(candidate.device)
    ) {
      legacyValues["30062"] = candidate.device;
    }
    const pendingLegacyValues = Object.fromEntries(
      Object.entries(legacyValues).filter(
        ([itemId]) => !Object.hasOwn(materialSanityOverrides, itemId),
      ),
    ) as Record<string, number | null>;
    if (Object.keys(pendingLegacyValues).length > 0) {
      legacyMaterialSanityValues.value = pendingLegacyValues;
    }
    return {
      ...DEFAULT_SANITY_SETTINGS,
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
      recycleItemSanity: isFiniteNonNegative(candidate.recycleItemSanity)
        ? candidate.recycleItemSanity
        : undefined,
      materialSanityOverrides,
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
      JSON.stringify({
        ...sanitySettings.value,
        ...(legacyMaterialSanityValues.value
          ? { materialSanityValues: legacyMaterialSanityValues.value }
          : {}),
      }),
    );
  } catch {}
}

function migrateLegacyMaterialSanityValues(
  defaults: Record<string, number>,
): void {
  const legacyValues = legacyMaterialSanityValues.value;
  if (!legacyValues) {
    return;
  }

  const overrides = { ...sanitySettings.value.materialSanityOverrides };
  Object.entries(legacyValues).forEach(([itemId, value]) => {
    if (
      !Object.hasOwn(overrides, itemId) &&
      value !== (defaults[itemId] ?? null)
    ) {
      overrides[itemId] = value;
    }
  });
  legacyMaterialSanityValues.value = undefined;
  sanitySettings.value = {
    ...sanitySettings.value,
    materialSanityOverrides: overrides,
  };
  persistSanitySettings();
}

function ensureSanityMaterialDefaults(): void {
  if (materialSanityDefaultsPromise) {
    return;
  }
  materialSanityDefaultsPromise = loadSanityMaterialDefaults()
    .then((defaults) => {
      materialSanityDefaults.value = defaults;
      materialSanityDefaultsLoaded.value = true;
      migrateLegacyMaterialSanityValues(defaults);
    })
    .catch(() => {
      materialSanityDefaultsPromise = undefined;
    });
}

function sanityMaterialValue(itemId: string): number | null {
  if (Object.hasOwn(sanitySettings.value.materialSanityOverrides, itemId)) {
    return sanitySettings.value.materialSanityOverrides[itemId] ?? null;
  }
  if (Object.hasOwn(legacyMaterialSanityValues.value ?? {}, itemId)) {
    return legacyMaterialSanityValues.value?.[itemId] ?? null;
  }
  return materialSanityDefaults.value[itemId] ?? null;
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
  const overrides = { ...sanitySettings.value.materialSanityOverrides };
  if (
    materialSanityDefaultsLoaded.value &&
    value === (materialSanityDefaults.value[itemId] ?? null)
  ) {
    delete overrides[itemId];
  } else {
    overrides[itemId] = value;
  }
  const legacyValues = { ...legacyMaterialSanityValues.value };
  delete legacyValues[itemId];
  legacyMaterialSanityValues.value =
    Object.keys(legacyValues).length > 0 ? legacyValues : undefined;
  sanitySettings.value = {
    ...sanitySettings.value,
    materialSanityOverrides: overrides,
  };
  persistSanitySettings();
}

function resetSanityMaterialSetting(itemId: string): void {
  const overrides = { ...sanitySettings.value.materialSanityOverrides };
  delete overrides[itemId];
  const legacyValues = { ...legacyMaterialSanityValues.value };
  delete legacyValues[itemId];
  legacyMaterialSanityValues.value =
    Object.keys(legacyValues).length > 0 ? legacyValues : undefined;
  sanitySettings.value = {
    ...sanitySettings.value,
    materialSanityOverrides: overrides,
  };
  persistSanitySettings();
}

export function useSanitySettings(
  itemTable: Readonly<Ref<TorappuItemTable | undefined>>,
  recycleRules: Readonly<Ref<RecycleRules | undefined>>,
) {
  ensureSanityMaterialDefaults();
  const materialItems = computed(() => sanityMaterialItems(itemTable.value));
  const sanityValues = computed(() => {
    const materialValuesById = Object.fromEntries(
      materialItems.value.map((item) => [
        item.itemId,
        sanityMaterialValue(item.itemId),
      ]),
    );
    const materials = Object.fromEntries(
      materialItems.value.map((item) => [
        item.name,
        sanityMaterialValue(item.itemId),
      ]),
    );
    const recycleItemSanity =
      sanitySettings.value.recycleItemSanity ??
      recycleOutputItemSanity(recycleRules.value, materialValuesById);
    return {
      ...calculateSanityValues(sanitySettings.value),
      recycleItemSanity,
      materials,
    };
  });

  return {
    materialItems,
    sanitySettings,
    sanityValues,
    sanityMaterialValue,
    setSanitySetting,
    resetSanitySetting,
    setSanityMaterialSetting,
    resetSanityMaterialSetting,
  };
}
