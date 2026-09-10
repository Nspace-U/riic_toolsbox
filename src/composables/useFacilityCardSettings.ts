import { ref } from "vue";

export type FacilityCardPaddingKey = "wide" | "tight";

export interface FacilityCardPaddingOption {
  label: string;
  description: string;
  padding: number;
  queuesPadding: number;
}

export const FACILITY_CARD_PADDING_OPTIONS: Record<
  FacilityCardPaddingKey,
  FacilityCardPaddingOption
> = {
  wide: {
    label: "宽松",
    description:
      "卡片宽度 = 干员槽位总宽 + 40px，队列卡片内边距 8px，内容与卡片边缘留有余量",
    padding: 40,
    queuesPadding: 8,
  },
  tight: {
    label: "紧凑",
    description:
      "卡片宽度 = 干员槽位总宽 + 24px，队列卡片内边距收到 2px，卡片更窄、更贴近干员槽位",
    padding: 24,
    queuesPadding: 2,
  },
};

export const FACILITY_CARD_PADDING_KEYS: FacilityCardPaddingKey[] = [
  "wide",
  "tight",
];

export type FacilityCardIconStyleKey = "corner" | "watermark" | "compact";

export interface FacilityCardIconStyleOption {
  label: string;
  description: string;
  scale?: number;
  fixedSize?: number;
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
  compact: {
    label: "左上角图标",
    description: "左上角显示固定 24px 的产物图标，透明度 30%",
    fixedSize: 24,
  },
};

export const FACILITY_CARD_ICON_STYLE_KEYS: FacilityCardIconStyleKey[] = [
  "corner",
  "watermark",
  "compact",
];

export interface FacilityCardSettings {
  paddingKey: FacilityCardPaddingKey;
  iconStyle: FacilityCardIconStyleKey;
}

export const FACILITY_CARD_SETTINGS_STORAGE_KEY =
  "riic-tools:facility-card-settings:v1";

const DEFAULT_FACILITY_CARD_SETTINGS: FacilityCardSettings = {
  paddingKey: "wide",
  iconStyle: "corner",
};

function isPaddingKey(value: unknown): value is FacilityCardPaddingKey {
  return (
    typeof value === "string" &&
    FACILITY_CARD_PADDING_KEYS.includes(value as FacilityCardPaddingKey)
  );
}

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
      paddingKey: isPaddingKey(candidate.paddingKey)
        ? candidate.paddingKey
        : DEFAULT_FACILITY_CARD_SETTINGS.paddingKey,
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
  } catch {
    // localStorage 不可用时保留内存中的设置。
  }
}

function setFacilityCardPadding(value: unknown): void {
  if (!isPaddingKey(value)) {
    return;
  }
  facilityCardSettings.value = {
    ...facilityCardSettings.value,
    paddingKey: value,
  };
  persistFacilityCardSettings();
}

function setFacilityCardIconStyle(value: unknown): void {
  if (!isIconStyleKey(value)) {
    return;
  }
  facilityCardSettings.value = {
    ...facilityCardSettings.value,
    iconStyle: value,
  };
  persistFacilityCardSettings();
}

function resetFacilityCardSettings(): void {
  facilityCardSettings.value = { ...DEFAULT_FACILITY_CARD_SETTINGS };
  persistFacilityCardSettings();
}

function facilityCardPadding(key: FacilityCardPaddingKey): number {
  return FACILITY_CARD_PADDING_OPTIONS[key].padding;
}

function facilityCardQueuesPadding(key: FacilityCardPaddingKey): number {
  return FACILITY_CARD_PADDING_OPTIONS[key].queuesPadding;
}

export function useFacilityCardSettings() {
  return {
    facilityCardSettings,
    facilityCardPadding,
    facilityCardQueuesPadding,
    facilityCardPaddingKeys: FACILITY_CARD_PADDING_KEYS,
    facilityCardPaddingOptions: FACILITY_CARD_PADDING_OPTIONS,
    facilityCardIconStyleKeys: FACILITY_CARD_ICON_STYLE_KEYS,
    facilityCardIconStyleOptions: FACILITY_CARD_ICON_STYLE_OPTIONS,
    setFacilityCardPadding,
    setFacilityCardIconStyle,
    resetFacilityCardSettings,
  };
}
