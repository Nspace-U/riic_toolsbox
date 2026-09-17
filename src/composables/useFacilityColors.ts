import { ref } from "vue";

import {
  ROOM_LABELS,
  ROOM_REPRESENTATIVE_COLORS,
  PRODUCT_LABELS,
  PRODUCT_REPRESENTATIVE_COLORS,
} from "@/utils/schedule";
import type { RoomKey } from "@/types/schedule";

const FACILITY_COLORS_STORAGE_KEY = "riic-tools:facility-colors:v1";
const PRODUCT_COLORS_STORAGE_KEY = "riic-tools:product-colors:v1";
const FIAMMETTA_COLOR_STORAGE_KEY = "riic-tools:fiammetta-color:v1";
const LEGACY_FACILITY_COLORS_STORAGE_KEY = "riic-tools:maa-facility-colors:v1";
const LEGACY_PRODUCT_COLORS_STORAGE_KEY = "riic-tools:maa-product-colors:v1";
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
const DEFAULT_FIAMMETTA_COLOR = "#A03030";

const PRODUCT_COLOR_KEYS = ["赤金", "合成玉", "源石碎片"] as const;
export type ProductColorKey = (typeof PRODUCT_COLOR_KEYS)[number];

function readStoredColors(key: string, legacyKey: string): string | null {
  try {
    return (
      window.localStorage.getItem(key) ?? window.localStorage.getItem(legacyKey)
    );
  } catch {
    return null;
  }
}

export function isProductColorKey(product: string): product is ProductColorKey {
  return PRODUCT_COLOR_KEYS.includes(product as ProductColorKey);
}

function cloneDefaultColors(): Record<RoomKey, string> {
  return { ...ROOM_REPRESENTATIVE_COLORS };
}

function loadFacilityColors(): Record<RoomKey, string> {
  const defaults = cloneDefaultColors();

  try {
    const stored = readStoredColors(
      FACILITY_COLORS_STORAGE_KEY,
      LEGACY_FACILITY_COLORS_STORAGE_KEY,
    );
    if (!stored) {
      return defaults;
    }

    const parsed: unknown = JSON.parse(stored);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return defaults;
    }

    Object.entries(parsed).forEach(([key, value]) => {
      if (
        key in defaults &&
        typeof value === "string" &&
        HEX_COLOR_PATTERN.test(value)
      ) {
        defaults[key as RoomKey] = value.toUpperCase();
      }
    });
  } catch {
    return defaults;
  }

  return defaults;
}

function cloneDefaultProductColors(): Record<ProductColorKey, string> {
  return {
    赤金: PRODUCT_REPRESENTATIVE_COLORS.赤金 ?? "#B87321",
    合成玉: PRODUCT_REPRESENTATIVE_COLORS.合成玉 ?? "#B52D2D",
    源石碎片: PRODUCT_REPRESENTATIVE_COLORS.源石碎片 ?? "#B52D2D",
  };
}

function loadProductColors(): Record<ProductColorKey, string> {
  const defaults = cloneDefaultProductColors();

  try {
    const stored = readStoredColors(
      PRODUCT_COLORS_STORAGE_KEY,
      LEGACY_PRODUCT_COLORS_STORAGE_KEY,
    );
    if (!stored) {
      return defaults;
    }

    const parsed: unknown = JSON.parse(stored);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return defaults;
    }

    Object.entries(parsed).forEach(([key, value]) => {
      if (
        key in defaults &&
        typeof value === "string" &&
        HEX_COLOR_PATTERN.test(value)
      ) {
        defaults[key as ProductColorKey] = value.toUpperCase();
      }
    });
  } catch {
    return defaults;
  }

  return defaults;
}

function loadFiammettaColor(): string {
  try {
    const stored = window.localStorage.getItem(FIAMMETTA_COLOR_STORAGE_KEY);
    return stored && HEX_COLOR_PATTERN.test(stored)
      ? stored.toUpperCase()
      : DEFAULT_FIAMMETTA_COLOR;
  } catch {
    return DEFAULT_FIAMMETTA_COLOR;
  }
}

const facilityColors = ref<Record<RoomKey, string>>(loadFacilityColors());
const productColors = ref<Record<ProductColorKey, string>>(loadProductColors());
const fiammettaColor = ref<string>(loadFiammettaColor());

function persistFacilityColors(): void {
  try {
    window.localStorage.setItem(
      FACILITY_COLORS_STORAGE_KEY,
      JSON.stringify(facilityColors.value),
    );
  } catch {}
}

function setFacilityColor(type: RoomKey, color: string): void {
  if (!HEX_COLOR_PATTERN.test(color)) {
    return;
  }
  facilityColors.value[type] = color.toUpperCase();
  persistFacilityColors();
}

function resetFacilityColor(type: RoomKey): void {
  facilityColors.value = {
    ...facilityColors.value,
    [type]: ROOM_REPRESENTATIVE_COLORS[type],
  };
  persistFacilityColors();
}

function persistProductColors(): void {
  try {
    window.localStorage.setItem(
      PRODUCT_COLORS_STORAGE_KEY,
      JSON.stringify(productColors.value),
    );
  } catch {}
}

function setProductColor(product: ProductColorKey, color: string): void {
  if (!HEX_COLOR_PATTERN.test(color)) {
    return;
  }
  productColors.value[product] = color.toUpperCase();
  persistProductColors();
}

function resetProductColor(product: ProductColorKey): void {
  productColors.value = {
    ...productColors.value,
    [product]: cloneDefaultProductColors()[product],
  };
  persistProductColors();
}

function persistFiammettaColor(): void {
  try {
    window.localStorage.setItem(
      FIAMMETTA_COLOR_STORAGE_KEY,
      fiammettaColor.value,
    );
  } catch {}
}

function setFiammettaColor(color: string): void {
  if (!HEX_COLOR_PATTERN.test(color)) {
    return;
  }
  fiammettaColor.value = color.toUpperCase();
  persistFiammettaColor();
}

function resetFiammettaColor(): void {
  fiammettaColor.value = DEFAULT_FIAMMETTA_COLOR;
  persistFiammettaColor();
}

export function useFacilityColors() {
  return {
    facilityColors,
    facilityLabels: ROOM_LABELS,
    productColors,
    fiammettaColor,
    productLabels: {
      赤金: PRODUCT_LABELS.赤金 ?? "赤金",
      合成玉: PRODUCT_LABELS.合成玉 ?? "合成玉",
      源石碎片: PRODUCT_LABELS.源石碎片 ?? "源石碎片",
    } satisfies Record<ProductColorKey, string>,
    setFacilityColor,
    resetFacilityColor,
    setProductColor,
    resetProductColor,
    setFiammettaColor,
    resetFiammettaColor,
  };
}
