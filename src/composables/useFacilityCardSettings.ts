import { ref } from "vue";

export type FacilityCardIconStyleKey = "corner" | "watermark";

export interface FacilityCardIconStyleOption {
  label: string;
  description: string;
  scale: number;
}

export const FACILITY_CARD_ICON_STYLE_OPTIONS: Record<
  FacilityCardIconStyleKey,
  FacilityCardIconStyleOption
> = {
  corner: {
    label: "右下角小图标",
    description: "右下角显示产物图标，尺寸为槽位的 0.8 倍，透明度 15%",
    scale: 0.8,
  },
  watermark: {
    label: "居中水印",
    description: "居中显示产物图标水印，尺寸为槽位的 2 倍，透明度 8%",
    scale: 2,
  },
};

export const FACILITY_CARD_ICON_STYLE_KEYS: FacilityCardIconStyleKey[] = [
  "corner",
  "watermark",
];

export interface FacilityCardSettings {
  iconStyle: FacilityCardIconStyleKey;
}

export const FACILITY_CARD_SETTINGS_STORAGE_KEY =
  "riic-tools:facility-card-settings:v1";

const DEFAULT_FACILITY_CARD_SETTINGS: FacilityCardSettings = {
  iconStyle: "corner",
};

function isIconStyleKey(value: unknown): value is FacilityCardIconStyleKey {
  return (
    typeof value === "string" &&
    FACILITY_CARD_ICON_STYLE_KEYS.includes(value as FacilityCardIconStyleKey)
  );
}

function readFacilityCardSettings(): FacilityCardSettings {
  if (typeof window === "undefined") {
    return { ...DEFAULT_FACILITY_CARD_SETTINGS };
  }

  try {
    const storedValue = window.localStorage.getItem(
      FACILITY_CARD_SETTINGS_STORAGE_KEY,
    );
    if (!storedValue) {
      return { ...DEFAULT_FACILITY_CARD_SETTINGS };
    }
    const parsedValue: unknown = JSON.parse(storedValue);
    if (typeof parsedValue !== "object" || parsedValue === null) {
      return { ...DEFAULT_FACILITY_CARD_SETTINGS };
    }
    const candidate = parsedValue as Partial<FacilityCardSettings>;
    return {
      iconStyle: isIconStyleKey(candidate.iconStyle)
        ? candidate.iconStyle
        : DEFAULT_FACILITY_CARD_SETTINGS.iconStyle,
    };
  } catch {
    return { ...DEFAULT_FACILITY_CARD_SETTINGS };
  }
}

const facilityCardSettings = ref<FacilityCardSettings>(
  readFacilityCardSettings(),
);

function persistFacilityCardSettings(): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      FACILITY_CARD_SETTINGS_STORAGE_KEY,
      JSON.stringify(facilityCardSettings.value),
    );
  } catch {}
}

function setFacilityCardIconStyle(value: unknown): void {
  if (!isIconStyleKey(value)) {
    return;
  }
  facilityCardSettings.value = { iconStyle: value };
  persistFacilityCardSettings();
}

function resetFacilityCardSettings(): void {
  facilityCardSettings.value = { ...DEFAULT_FACILITY_CARD_SETTINGS };
  persistFacilityCardSettings();
}

function facilityCardIconScale(key: FacilityCardIconStyleKey): number {
  return FACILITY_CARD_ICON_STYLE_OPTIONS[key].scale;
}

export function useFacilityCardSettings() {
  return {
    facilityCardSettings,
    facilityCardIconScale,
    facilityCardIconStyleKeys: FACILITY_CARD_ICON_STYLE_KEYS,
    facilityCardIconStyleOptions: FACILITY_CARD_ICON_STYLE_OPTIONS,
    setFacilityCardIconStyle,
    resetFacilityCardSettings,
  };
}
